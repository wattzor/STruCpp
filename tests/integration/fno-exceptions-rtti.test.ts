// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E3/E4: generated code and runtime headers must build and raise defined
 * faults under -fno-exceptions -fno-rtti (embedded target flags).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

const fnoFlags = ["-fno-exceptions", "-fno-rtti"];

const faultMain = `
#include <cstdlib>
namespace strucpp {
[[noreturn]] void iec_runtime_fault(IecFault, const char*) noexcept {
    std::exit(77);
}
}
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    return 0;
}
`;

describe.skipIf(!hasGpp)("Generated code under -fno-exceptions and -fno-rtti", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-fno-"));
    pchPath = createPCH(tempDir, fnoFlags);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("E3: compiles and runs a non-QUERYINTERFACE program with -fno-exceptions -fno-rtti", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[1..3] OF INT;
        x : INT;
      END_VAR
        x := arr[1];
      END_PROGRAM
    `);

    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fno_compile_only",
      mainCode: faultMain,
      extraFlags: fnoFlags,
    });

    expect(stdout).toBe("");
  });

  it("E4: division by zero faults through iec_runtime_fault under -fno-exceptions", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        a : INT;
        b : INT;
      END_VAR
        b := 0;
        a := 10 / b;
      END_PROGRAM
    `);

    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fno_div_zero",
      mainCode: faultMain,
      extraFlags: fnoFlags,
      expectedExitCode: 77,
    });

    expect(stdout).toBe("");
  });

  it("E4: array out-of-bounds read faults through iec_runtime_fault under -fno-exceptions", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[1..3] OF INT;
        x : INT;
      END_VAR
        x := arr[5];
      END_PROGRAM
    `);

    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fno_array_oob",
      mainCode: faultMain,
      extraFlags: fnoFlags,
      expectedExitCode: 77,
    });

    expect(stdout).toBe("");
  });

  it("E4: array negative-index read faults through iec_runtime_fault under -fno-exceptions", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        arr : ARRAY[1..3] OF INT;
        i : INT;
        x : INT;
      END_VAR
        i := -1;
        x := arr[i];
      END_PROGRAM
    `);

    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fno_array_neg",
      mainCode: faultMain,
      extraFlags: fnoFlags,
      expectedExitCode: 77,
    });

    expect(stdout).toBe("");
  });

  it("E3: __QUERYINTERFACE works under -fno-exceptions -fno-rtti", () => {
    const result = compile(`
      INTERFACE IValue
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Counter IMPLEMENTS IValue
        VAR count : INT; END_VAR
        METHOD PUBLIC GetValue : INT
          GetValue := count;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        c : Counter;
        iv : IValue;
        ok : BOOL;
        v : INT;
      END_VAR
        ok := __QUERYINTERFACE(c, iv);
        v := iv.GetValue();
      END_PROGRAM
    `);

    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fno_query_interface",
      mainCode: `
#include <iostream>
#include <cstdlib>
namespace strucpp {
[[noreturn]] void iec_runtime_fault(IecFault, const char*) noexcept {
    std::exit(1);
}
}
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.OK.get() ? "ok" : "no") << ":" << prog.V.get() << std::endl;
    return 0;
}
`,
      extraFlags: fnoFlags,
    });

    expect(stdout).toBe("ok:0");
  });
});
