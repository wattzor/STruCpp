// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E CODESYS numeric / bit / shift / division semantics.
 *
 * Covers the C1-C8 SIT items that protocol and crypto FBs depend on:
 *   C1/C2/C3: unsigned and signed integer wraparound
 *   C4/C5:     SHL/SHR/ROL/ROR edge counts
 *   C6:        bitwise NOT/AND/OR/XOR on all widths
 *   C7:        signed DIV/MOD
 *   C8:        division by zero raises a catchable fault
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("CODESYS numeric and bit semantics", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-codesys-semantics-"));
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("C1/C2/C3: integer wraparound for unsigned and signed types", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        b  : BYTE;
        w  : WORD;
        dw : DWORD;
        lw : LWORD;
        u8  : USINT;
        u16 : UINT;
        u32 : UDINT;
        u64 : ULINT;
        si : SINT;
        i  : INT;
        di : DINT;
        li : LINT;
      END_VAR
        b  := BYTE#255 + BYTE#1;
        w  := WORD#65535 + WORD#1;
        dw := DWORD#16#FFFFFFFF + DWORD#1;
        lw := LWORD#16#FFFFFFFFFFFFFFFF + LWORD#1;

        u8  := USINT#0 - USINT#1;
        u16 := UINT#0 - UINT#1;
        u32 := UDINT#0 - UDINT#1;
        u64 := ULINT#0 - ULINT#1;

        si := SINT#127 + SINT#1;
        i  := INT#32767 + INT#1;
        di := DINT#2147483647 + DINT#1;
        li := LINT#16#7FFFFFFFFFFFFFFF + LINT#1;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "wraparound",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.B) << ','
              << static_cast<int>(prog.W) << ','
              << static_cast<unsigned long>(prog.DW) << ','
              << static_cast<unsigned long long>(prog.LW) << '\\n'
              << static_cast<int>(prog.U8) << ','
              << static_cast<int>(prog.U16) << ','
              << static_cast<unsigned long>(prog.U32) << ','
              << static_cast<unsigned long long>(prog.U64) << '\\n'
              << static_cast<int>(prog.SI) << ','
              << static_cast<int>(prog.I) << ','
              << static_cast<long>(prog.DI) << ','
              << static_cast<long long>(prog.LI) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe(
      ["0,0,0,0", "255,65535,4294967295,18446744073709551615", "-128,-32768,-2147483648,-9223372036854775808"].join("\n"),
    );
  });

  it("C4/C5: SHL/SHR/ROL/ROR edge counts and no UB", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        shl0 : BYTE;
        shl8 : BYTE;
        shl9 : BYTE;
        shr0 : BYTE;
        shr8 : BYTE;
        shr9 : BYTE;
        shr7 : BYTE;
        shlneg : BYTE;

        shl15  : INT;
        shl16  : INT;
        shr15n : INT;
        shr16n : INT;
        negmin : INT;

        rol0  : BYTE;
        rol8  : BYTE;
        rol1  : BYTE;
        ror1  : BYTE;
      END_VAR
        shl0  := SHL(BYTE#1, 0);
        shl8  := SHL(BYTE#1, 8);
        shl9  := SHL(BYTE#1, 9);
        shr0  := SHR(BYTE#255, 0);
        shr8  := SHR(BYTE#255, 8);
        shr9  := SHR(BYTE#255, 9);
        shr7  := SHR(BYTE#128, 7);
        shlneg := SHL(BYTE#1, -1);

        shl15  := SHL(INT#1, 15);
        shl16  := SHL(INT#1, 16);
        negmin := INT#0 - INT#32767 - INT#1;
        shr15n := SHR(negmin, 15);
        shr16n := SHR(negmin, 16);

        rol0 := ROL(BYTE#16#81, 0);
        rol8 := ROL(BYTE#16#81, 8);
        rol1 := ROL(BYTE#16#81, 1);
        ror1 := ROR(BYTE#16#81, 1);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "shifts",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.SHL0) << ','
              << static_cast<int>(prog.SHL8) << ','
              << static_cast<int>(prog.SHL9) << ','
              << static_cast<int>(prog.SHR0) << ','
              << static_cast<int>(prog.SHR8) << ','
              << static_cast<int>(prog.SHR9) << ','
              << static_cast<int>(prog.SHR7) << ','
              << static_cast<int>(prog.SHLNEG) << '\\n'
              << static_cast<int>(prog.SHL15) << ','
              << static_cast<int>(prog.SHL16) << ','
              << static_cast<int>(prog.SHR15N) << ','
              << static_cast<int>(prog.SHR16N) << '\\n'
              << static_cast<int>(prog.ROL0) << ','
              << static_cast<int>(prog.ROL8) << ','
              << static_cast<int>(prog.ROL1) << ','
              << static_cast<int>(prog.ROR1) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe(
      ["1,0,0,255,0,0,1,0", "-32768,0,-1,-1", "129,129,3,192"].join("\n"),
    );
  });

  it("C6: bitwise NOT/AND/OR/XOR on BYTE/WORD/DWORD/LWORD", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        ab : BYTE;
        ob : BYTE;
        xb : BYTE;
        nb : BYTE;
        nw  : WORD;
        ndw : DWORD;
        nlw : LWORD;
      END_VAR
        ab := BYTE#16#0F AND BYTE#16#F0;
        ob := BYTE#16#0F OR  BYTE#16#F0;
        xb := BYTE#16#FF XOR BYTE#16#0F;
        nb := NOT BYTE#16#0F;
        nw  := NOT WORD#16#000F;
        ndw := NOT DWORD#16#0000000F;
        nlw := NOT LWORD#16#000000000000000F;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "bitwise",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.AB) << ','
              << static_cast<int>(prog.OB) << ','
              << static_cast<int>(prog.XB) << ','
              << static_cast<int>(prog.NB) << ','
              << static_cast<int>(prog.NW) << ','
              << static_cast<unsigned long>(prog.NDW) << ','
              << static_cast<unsigned long long>(prog.NLW) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("0,255,240,240,65520,4294967280,18446744073709551600");
  });

  it("C7: signed integer division and MOD truncate toward zero", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        d1 : INT;
        m1 : INT;
        d2 : INT;
        m2 : INT;
      END_VAR
        d1 := (INT#0 - INT#7) / INT#2;
        m1 := (INT#0 - INT#7) MOD INT#2;
        d2 := INT#7 / (INT#0 - INT#2);
        m2 := INT#7 MOD (INT#0 - INT#2);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "divmod",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.D1) << ','
              << static_cast<int>(prog.M1) << ','
              << static_cast<int>(prog.D2) << ','
              << static_cast<int>(prog.M2) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("-3,-1,-3,1");
  });

  it("C8: division by zero raises a defined runtime fault, not UB", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        q : INT;
      END_VAR
        q := INT#10 / INT#0;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    expect(() =>
      compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: result.headerCode!,
        cppCode: result.cppCode!,
        testName: "divzero",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    return 0;
}
`,
      }),
    ).toThrow();
  });

  it("C9: in-bounds array access succeeds and out-of-bounds write raises a fault", () => {
    const inBounds = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[0..3] OF BYTE;
      END_VAR
        arr[3] := BYTE#42;
      END_PROGRAM
    `);
    expect(inBounds.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: inBounds.headerCode!,
      cppCode: inBounds.cppCode!,
      testName: "array_in_bounds",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.ARR.at(3)) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("42");

    const oobWrite = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[0..3] OF BYTE;
      END_VAR
        arr[4] := BYTE#42;
      END_PROGRAM
    `);
    expect(oobWrite.success).toBe(true);
    expect(() =>
      compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: oobWrite.headerCode!,
        cppCode: oobWrite.cppCode!,
        testName: "array_oob_write",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    return 0;
}
`,
      }),
    ).toThrow();
  });

  it("C10: negative or runtime-computed out-of-bounds array read raises a fault", () => {
    const negativeIdx = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[0..3] OF BYTE;
        b : BYTE;
      END_VAR
        b := arr[-1];
      END_PROGRAM
    `);
    expect(negativeIdx.success).toBe(true);
    expect(() =>
      compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: negativeIdx.headerCode!,
        cppCode: negativeIdx.cppCode!,
        testName: "array_neg_idx",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    return 0;
}
`,
      }),
    ).toThrow();

    const runtimeIdx = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[0..3] OF BYTE;
        i : INT;
        b : BYTE;
      END_VAR
        i := 5;
        b := arr[i];
      END_PROGRAM
    `);
    expect(runtimeIdx.success).toBe(true);
    expect(() =>
      compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: runtimeIdx.headerCode!,
        cppCode: runtimeIdx.cppCode!,
        testName: "array_runtime_idx",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    return 0;
}
`,
      }),
    ).toThrow();
  });

  it("C11/C12: VAR_IN_OUT of ARRAY[*] OF BYTE is by-reference through nested calls", () => {
    const result = compile(`
      FUNCTION_BLOCK ByteWriter
      VAR_IN_OUT
        buf : ARRAY[0..3] OF BYTE;
      END_VAR
        METHOD PUBLIC Write
          buf[0] := BYTE#1;
          buf[1] := BYTE#2;
          buf[2] := BYTE#3;
          buf[3] := BYTE#4;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK OuterWriter
      VAR_IN_OUT
        buf : ARRAY[0..3] OF BYTE;
      END_VAR
      VAR
        inner : ByteWriter;
      END_VAR
        METHOD PUBLIC Relay
          inner(buf := buf);
          inner.Write();
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        b : ARRAY[0..3] OF BYTE;
        o : OuterWriter;
        r0, r1, r2, r3 : BYTE;
      END_VAR
        o(buf := b);
        o.Relay();
        r0 := b[0];
        r1 := b[1];
        r2 := b[2];
        r3 := b[3];
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "var_in_out_scalar_array",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.R0) << ','
              << static_cast<int>(prog.R1) << ','
              << static_cast<int>(prog.R2) << ','
              << static_cast<int>(prog.R3) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1,2,3,4");
  });

  it("C13: endian-independent pack/unpack of DWORD from ARRAY[0..3] OF BYTE", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        buf : ARRAY[0..3] OF BYTE;
        dw : DWORD;
        r0, r1, r2, r3 : BYTE;
        i : INT;
      END_VAR
        buf[0] := BYTE#1;
        buf[1] := BYTE#2;
        buf[2] := BYTE#3;
        buf[3] := BYTE#4;

        dw := DWORD#0;
        FOR i := 0 TO 3 DO
          dw := dw OR SHL(TO_DWORD(buf[i]), i * 8);
        END_FOR;

        FOR i := 0 TO 3 DO
          buf[i] := TO_BYTE(SHR(dw, i * 8));
        END_FOR;

        r0 := buf[0];
        r1 := buf[1];
        r2 := buf[2];
        r3 := buf[3];
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "pack_unpack",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned long>(prog.DW) << '\\n'
              << static_cast<int>(prog.R0) << ','
              << static_cast<int>(prog.R1) << ','
              << static_cast<int>(prog.R2) << ','
              << static_cast<int>(prog.R3) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe(["67305985", "1,2,3,4"].join("\n"));
  });

  it("D6: a representative CODESYS semantics program runs clean under ASan/UBSan", () => {
    const result = compile(`
      FUNCTION_BLOCK ByteWriter
      VAR_IN_OUT
        buf : ARRAY[0..3] OF BYTE;
      END_VAR
        METHOD PUBLIC Write
          buf[0] := BYTE#1;
          buf[1] := BYTE#2;
          buf[2] := BYTE#3;
          buf[3] := BYTE#4;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        b : ARRAY[0..3] OF BYTE;
        w : ByteWriter;
        dw : DWORD;
        i : INT;
        r0, r1, r2, r3 : BYTE;
      END_VAR
        w(buf := b);
        w.Write();

        dw := DWORD#0;
        FOR i := 0 TO 3 DO
          dw := dw OR SHL(TO_DWORD(b[i]), i * 8);
        END_FOR;

        FOR i := 0 TO 3 DO
          b[i] := TO_BYTE(SHR(dw, i * 8));
        END_FOR;

        r0 := b[0];
        r1 := b[1];
        r2 := b[2];
        r3 := b[3];
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "codesys_semantics_sanitized",
      extraFlags: ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"],
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned long>(prog.DW) << '\\n'
              << static_cast<int>(prog.R0) << ','
              << static_cast<int>(prog.R1) << ','
              << static_cast<int>(prog.R2) << ','
              << static_cast<int>(prog.R3) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe(["67305985", "1,2,3,4"].join("\n"));
  });

  it("B4/B5: CODESYS bit access %Xn reads and writes on BYTE/WORD/DWORD/LWORD boundaries", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        b : BYTE;
        w : WORD;
        dw : DWORD;
        lw : LWORD;
        fb, fw, fdw, flw : BOOL;
      END_VAR
        b.%X0 := TRUE;
        b.%X7 := TRUE;
        w.%X0 := TRUE;
        w.%X15 := TRUE;
        dw.%X0 := TRUE;
        dw.%X31 := TRUE;
        lw.%X0 := TRUE;
        lw.%X63 := TRUE;

        fb := b.%X0;
        fw := w.%X15;
        fdw := dw.%X31;
        flw := lw.%X63;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "bit_access",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.B) << ','
              << static_cast<int>(prog.FB) << ','
              << static_cast<unsigned int>(prog.W) << ','
              << static_cast<int>(prog.FW) << ','
              << static_cast<unsigned long>(prog.DW) << ','
              << static_cast<int>(prog.FDW) << ','
              << static_cast<unsigned long long>(prog.LW) << ','
              << static_cast<int>(prog.FLW) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("129,1,32769,1,2147483649,1,9223372036854775809,1");
  });

  // CODESYS Operators reference examples
  // https://content.helpme-codesys.com/en/CODESYS%20Development%20System/_cds_struct_reference_operators.html
  // These are the published worked examples for overflow/underflow handling.
  it("doc example 1: WORD + 1 assigned to DWORD is not truncated @oracle: codesys-doc", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        wVar  : WORD;
        dwVar : DWORD;
      END_VAR
        wVar  := 65535;
        dwVar := wVar + 1;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "doc_ex1",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned int>(prog.DWVAR) << ','
              << static_cast<int>(prog.WVAR) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("65536,65535");
  });

  it("doc example 2: (WORD +/- 1) = WORD is FALSE without truncation @oracle: codesys-doc", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        wVar1 : WORD;
        wVar2 : WORD;
        bVar1 : BOOL;
        bVar2 : BOOL;
      END_VAR
        wVar1 := 65535;
        wVar2 := 0;
        bVar1 := (wVar1 + 1) = wVar2;
        bVar2 := (wVar2 - 1) = wVar1;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "doc_ex2",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.BVAR1) << ','
              << static_cast<int>(prog.BVAR2) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("0,0");
  });

  it("doc example 3: assignment truncates the temporary to the target type @oracle: codesys-doc", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        wVar1 : WORD;
        wVar2 : WORD;
        wVar3 : WORD;
        bVar1 : BOOL;
      END_VAR
        wVar1 := 65535;
        wVar2 := 0;
        wVar3 := (wVar1 + 1);
        bVar1 := wVar3 = wVar2;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "doc_ex3",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.WVAR3) << ','
              << static_cast<int>(prog.BVAR1) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("0,1");
  });

  it("doc example 4: explicit TO_WORD forces 16-bit truncation @oracle: codesys-doc", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        wVar1 : WORD;
        wVar2 : WORD;
        bVar1 : BOOL;
        bVar2 : BOOL;
      END_VAR
        wVar1 := 65535;
        wVar2 := 0;
        bVar1 := TO_WORD(wVar1 + 1) = wVar2;
        bVar2 := TO_WORD(wVar2 - 1) = wVar1;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "doc_ex4",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.BVAR1) << ','
              << static_cast<int>(prog.BVAR2) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1,1");
  });
});
