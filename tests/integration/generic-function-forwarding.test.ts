// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic FUNCTION forwarding regression tests.
 *
 * User-defined FUNCTIONs with ANY/ANY_* parameter and return types must be
 * able to call standard functions (LIMIT, ADD, etc.) and produce concrete C++
 * that compiles and runs with the caller's actual argument types.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("generic FUNCTION forwarding", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-generic-fwd-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("forwards ANY_NUM parameters to LIMIT", () => {
    const result = compile(`
      FUNCTION MaxAny : ANY_NUM
      VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
        MaxAny := LIMIT(mn, val, mx);
      END_FUNCTION

      PROGRAM Main
      VAR
        i : INT;
        r : REAL;
      END_VAR
        i := MaxAny(INT#1, INT#2, INT#3);
        r := MaxAny(REAL#1.0, REAL#5.0, REAL#10.0);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << prog.I.get() << '\\n'
              << prog.R.get() << std::endl;
    return 0;
}
`;
    const expected = ["2", "5"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "generic_limit",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("forwards ANY_NUM parameters to ADD", () => {
    const result = compile(`
      FUNCTION AddAny : ANY_NUM
      VAR_INPUT a, b : ANY_NUM; END_VAR
        AddAny := ADD(a, b);
      END_FUNCTION

      PROGRAM Main
      VAR
        i : INT;
        r : REAL;
      END_VAR
        i := AddAny(INT#10, INT#20);
        r := AddAny(REAL#1.5, REAL#2.5);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << prog.I.get() << '\\n'
              << prog.R.get() << std::endl;
    return 0;
}
`;
    const expected = ["30", "4"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "generic_add",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });
});
