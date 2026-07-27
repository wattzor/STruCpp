// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS SIZEOF semantics (logical IEC byte size).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("SIZEOF operator", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-sizeof-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("returns logical IEC byte sizes for elementary, array, struct, string, and type names", () => {
    const result = compile(`
      TYPE Point :
      STRUCT
        X : INT;
        Y : INT;
      END_STRUCT
      END_TYPE

      PROGRAM Main
      VAR
        arr : ARRAY[0..9] OF INT;
        p : Point;
        s : STRING(80);
        i : INT;
        sizeArr : UDINT;
        sizePoint : UDINT;
        sizeString : UDINT;
        sizeInt : UDINT;
        sizeIntType : UDINT;
        sizePointType : UDINT;
      END_VAR
      sizeArr := SIZEOF(arr);
      sizePoint := SIZEOF(p);
      sizeString := SIZEOF(s);
      sizeInt := SIZEOF(i);
      sizeIntType := SIZEOF(INT);
      sizePointType := SIZEOF(Point);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "sizeof",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned>(prog.SIZEARR) << ","
              << static_cast<unsigned>(prog.SIZEPOINT) << ","
              << static_cast<unsigned>(prog.SIZESTRING) << ","
              << static_cast<unsigned>(prog.SIZEINT) << ","
              << static_cast<unsigned>(prog.SIZEINTTYPE) << ","
              << static_cast<unsigned>(prog.SIZEPOINTTYPE) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("20,4,81,2,2,4");
  });

  it("returns logical IEC byte size for a function block instance and its type name", () => {
    const result = compile(`
      FUNCTION_BLOCK MyFB
      VAR
        a : INT;
        b : BOOL;
        c : DINT;
      END_VAR
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        fb : MyFB;
        sizeFb : UDINT;
        sizeFbType : UDINT;
      END_VAR
      sizeFb := SIZEOF(fb);
      sizeFbType := SIZEOF(MyFB);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "sizeof-fb",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned>(prog.SIZEFB) << ","
              << static_cast<unsigned>(prog.SIZEFBTYPE) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("7,7");
  });

  it("includes alignment padding for mixed-width struct members", () => {
    const result = compile(`
      TYPE Padded :
      STRUCT
        b : BYTE;
        d : DWORD;
      END_STRUCT
      END_TYPE

      PROGRAM Main
      VAR
        p : Padded;
        sizeVar : UDINT;
        sizeType : UDINT;
      END_VAR
      sizeVar := SIZEOF(p);
      sizeType := SIZEOF(Padded);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "sizeof-padded",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned>(prog.SIZEVAR) << ","
              << static_cast<unsigned>(prog.SIZETYPE) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("8,8");
  });
});
