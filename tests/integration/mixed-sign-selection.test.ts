// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Mixed signed/unsigned selection-function regression tests.
 *
 * MIN, MAX, LIMIT, SEL and MUX must not cast mixed-sign operands to an
 * unsigned common type before comparing/selecting; the same-width
 * DINT/UDINT and LINT/ULINT pairs are the pathological cases.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("mixed sign selection", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-mixed-sign-sel-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("MIN/MAX/LIMIT/SEL and comparison functions are sign-aware", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        max_v, min_v, limit_v, sel_true, sel_false : DINT;
        gt_v, lt_v, eq_v : BOOL;
      END_VAR
        max_v     := MAX(-DINT#1, UDINT#1);
        min_v     := MIN(-DINT#1, UDINT#1);
        limit_v   := LIMIT(-DINT#10, DINT#5, UDINT#100);
        sel_true  := SEL(TRUE,  -DINT#1, UDINT#1);
        sel_false := SEL(FALSE, -DINT#1, UDINT#1);

        gt_v := GT(-DINT#1, UDINT#1);
        lt_v := LT(-DINT#1, UDINT#1);
        eq_v := EQ(-DINT#1, UDINT#1);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << static_cast<long long>(prog.MAX_V) << '\\n'
      << static_cast<long long>(prog.MIN_V) << '\\n'
      << static_cast<long long>(prog.LIMIT_V) << '\\n'
      << static_cast<long long>(prog.SEL_TRUE) << '\\n'
      << static_cast<long long>(prog.SEL_FALSE) << '\\n'
      << (prog.GT_V ? 1 : 0) << (prog.LT_V ? 1 : 0) << (prog.EQ_V ? 1 : 0) << std::endl;
    return 0;
}
`;
    const expected = ["1", "-1", "5", "1", "-1", "010"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_minmax_cmp",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("variadic MAX/MIN with mixed signed/unsigned operands", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        max3, min3, max_mixed_first : DINT;
      END_VAR
        max3           := MAX(DINT#2, -DINT#5, UDINT#3);
        min3           := MIN(DINT#2, -DINT#5, UDINT#3);
        max_mixed_first := MAX(UDINT#3, DINT#2, DINT#1);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << static_cast<long long>(prog.MAX3) << '\\n'
      << static_cast<long long>(prog.MIN3) << '\\n'
      << static_cast<long long>(prog.MAX_MIXED_FIRST) << std::endl;
    return 0;
}
`;
    const expected = ["3", "-5", "3"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_variadic_sel",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("MUX with mixed signed/unsigned inputs", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        mux0, mux1 : DINT;
      END_VAR
        mux0 := MUX(0, -DINT#5, UDINT#3);
        mux1 := MUX(1, -DINT#5, UDINT#3);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << static_cast<long long>(prog.MUX0) << '\\n'
      << static_cast<long long>(prog.MUX1) << std::endl;
    return 0;
}
`;
    const expected = ["-5", "3"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_mux_sel",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  // Same-width LINT/ULINT cannot be widened further, so the compare must be
  // sign-aware on the original types. Result values used here are positive and
  // fit in the unsigned common result type.
  it("variadic MIN/MAX with LINT/ULINT returns the mathematically correct signed result", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        min_lu, max_lu : LINT;
      END_VAR
        min_lu := MIN(-LINT#5, ULINT#3, LINT#7);
        max_lu := MAX(-LINT#5, ULINT#3, LINT#7);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << static_cast<long long>(prog.MIN_LU) << '\\n'
      << static_cast<long long>(prog.MAX_LU) << std::endl;
    return 0;
}
`;
    const expected = ["-5", "7"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_lint_ulint_negative",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("MAX/MIN/LIMIT with LINT/ULINT same-width pairs are sign-aware", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        max_lu, min_lu, limit_lu, max_lu_first : ULINT;
      END_VAR
        max_lu      := MAX(-LINT#1, ULINT#1);
        max_lu_first := MAX(ULINT#1, -LINT#1);
        min_lu      := MIN(ULINT#3, LINT#2);
        limit_lu    := LIMIT(LINT#0, -LINT#1, ULINT#1);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << static_cast<unsigned long long>(prog.MAX_LU) << '\\n'
      << static_cast<unsigned long long>(prog.MAX_LU_FIRST) << '\\n'
      << static_cast<unsigned long long>(prog.MIN_LU) << '\\n'
      << static_cast<unsigned long long>(prog.LIMIT_LU) << std::endl;
    return 0;
}
`;
    const expected = ["1", "1", "2", "0"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_lint_ulint_sel",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });
});
