// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for method calls on non-trivial object expressions:
 * - array element:  arr[1].Method()
 * - pointer deref: p^.Method()
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("method calls on array elements and pointer derefs", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-method-expr-"));
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("calls a method on an array element", () => {
    const result = compile(`
      FUNCTION_BLOCK Observer
      VAR
        val : INT := 0;
      END_VAR
      METHOD Update
      VAR_INPUT
        v : INT;
      END_VAR
      val := v;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        observers : ARRAY[1..2] OF Observer;
        result : INT;
      END_VAR
      observers[1].Update(42);
      result := observers[1].val;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "array_element_method",
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

  it("calls a method through a pointer dereference", () => {
    const result = compile(`
      FUNCTION_BLOCK Motor
      VAR
        running : BOOL;
      END_VAR
      METHOD Start
      running := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        p : POINTER TO Motor;
        out : BOOL;
      END_VAR
      p := __NEW(Motor);
      p^.Start();
      out := p^.running;
      __DELETE(p);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "pointer_deref_method",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.OUT ? "TRUE" : "FALSE") << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("TRUE");
  });
});
