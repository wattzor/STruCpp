// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Mixed signed/unsigned comparison regression tests.
 *
 * C++ usual arithmetic conversions silently convert the signed operand to
 * unsigned when the unsigned operand has equal-or-greater rank, so
 * `INT#-1 < UDINT#1` used to be FALSE. These tests pin the sign-aware
 * behaviour: comparisons use the original mathematical values.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("mixed sign comparisons", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-mixed-sign-cmp-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  // INT#-1 < UDINT#1 is TRUE; INT#-1 = UDINT#1 is FALSE. Same for DINT/UDINT,
  // LINT/ULINT, at both 32-bit and 64-bit target widths.
  it("mixed signed/unsigned comparisons are sign-aware at both target widths", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        lt_sint, lt_int, lt_dint, lt_lint : BOOL;
        eq_sint, eq_int, eq_dint, eq_lint : BOOL;
        gt_sint, gt_int, gt_dint, gt_lint : BOOL;
        mixed_add : DINT;
      END_VAR
        lt_sint := (-SINT#1 < USINT#1);
        lt_int  := (-INT#1 < UINT#1);
        lt_dint := (-DINT#1 < UDINT#1);
        lt_lint := (-LINT#1 < ULINT#1);

        eq_sint := (-SINT#1 = USINT#1);
        eq_int  := (-INT#1 = UINT#1);
        eq_dint := (-DINT#1 = UDINT#1);
        eq_lint := (-LINT#1 = ULINT#1);

        gt_sint := (-SINT#1 > USINT#1);
        gt_int  := (-INT#1 > UINT#1);
        gt_dint := (-DINT#1 > UDINT#1);
        gt_lint := (-LINT#1 > ULINT#1);

        mixed_add := -INT#1 + UDINT#10;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout
      << (prog.LT_SINT ? 1 : 0) << (prog.LT_INT ? 1 : 0)
      << (prog.LT_DINT ? 1 : 0) << (prog.LT_LINT ? 1 : 0) << '\\n'
      << (prog.EQ_SINT ? 1 : 0) << (prog.EQ_INT ? 1 : 0)
      << (prog.EQ_DINT ? 1 : 0) << (prog.EQ_LINT ? 1 : 0) << '\\n'
      << (prog.GT_SINT ? 1 : 0) << (prog.GT_INT ? 1 : 0)
      << (prog.GT_DINT ? 1 : 0) << (prog.GT_LINT ? 1 : 0) << '\\n'
      << static_cast<long long>(prog.MIXED_ADD) << std::endl;
    return 0;
}
`;
    const expected = ["1111", "0000", "0000", "9"].join("\n");

    const stdout64 = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "mixed_cmp_64",
      mainCode,
    });
    expect(stdout64).toBe(expected);

    const target32Dir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-mixed-cmp-32-"));
    try {
      const target32Pch = createPCH(target32Dir, ["-DSTRUCPP_TARGET_WIDTH=32"]);
      const stdout32 = compileAndRunStandalone({
        tempDir: target32Dir,
        pchPath: target32Pch,
        extraFlags: ["-DSTRUCPP_TARGET_WIDTH=32"],
        headerCode: result.headerCode!,
        cppCode: result.cppCode!,
        testName: "mixed_cmp_32",
        mainCode,
      });
      expect(stdout32).toBe(expected);
    } finally {
      fs.rmSync(target32Dir, { recursive: true, force: true });
    }
  });
});
