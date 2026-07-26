// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for method chaining and method calls on array elements and nested fields.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("method chaining on arrays and nested fields", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-chain-arrays-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("chains methods returned from an array element", () => {
    const result = compile(`
      FUNCTION_BLOCK Counter
      VAR
        count : INT := 0;
      END_VAR
        METHOD PUBLIC GetSelf : REFERENCE TO Counter
          GetSelf ref= THIS^;
        END_METHOD
        METHOD PUBLIC Inc : INT
          count := count + 1;
          Inc := count;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        arr : ARRAY[1..2] OF Counter;
        result : INT;
      END_VAR
        result := arr[1].GetSelf().Inc();
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "chain_array_element",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << "," << static_cast<int>(prog.ARR.at(1).COUNT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1,1");
  });

  it("chains methods returned from a pointer stored in an array element", () => {
    const result = compile(`
      FUNCTION_BLOCK Counter
      VAR
        count : INT := 0;
      END_VAR
        METHOD PUBLIC GetSelf : REFERENCE TO Counter
          GetSelf ref= THIS^;
        END_METHOD
        METHOD PUBLIC Inc : INT
          count := count + 1;
          Inc := count;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        arr : ARRAY[1..2] OF POINTER TO Counter;
        p : POINTER TO Counter;
        c : Counter;
        result : INT;
      END_VAR
        p := ADR(c);
        arr[1] := p;
        result := arr[1]^.GetSelf().Inc();
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "chain_array_pointer_element",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << "," << static_cast<int>(prog.C.COUNT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1,1");
  });

  it("chains methods through nested field references", () => {
    const result = compile(`
      FUNCTION_BLOCK Inner
        METHOD PUBLIC GetValue : INT
          GetValue := 42;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer
      VAR
        inner : Inner;
      END_VAR
        METHOD PUBLIC GetInner : REFERENCE TO Inner
          GetInner ref= THIS^.inner;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer2
      VAR
        outer : Outer;
      END_VAR
        METHOD PUBLIC GetOuter : REFERENCE TO Outer
          GetOuter ref= THIS^.outer;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        o2 : Outer2;
        result : INT;
      END_VAR
        result := o2.GetOuter().GetInner().GetValue();
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "chain_nested_fields",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("42");
  });

  it("calls a method on a nested field of an array element", () => {
    const result = compile(`
      FUNCTION_BLOCK Inner
        METHOD PUBLIC GetValue : INT
          GetValue := 42;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer
      VAR
        inner : Inner;
      END_VAR
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        arr : ARRAY[1..2] OF Outer;
        result : INT;
      END_VAR
        result := arr[1].inner.GetValue();
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "method_on_nested_field_of_array",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("42");
  });
});
