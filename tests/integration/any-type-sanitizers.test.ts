// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * ANY / AnyType integration tests under AddressSanitizer and
 * UndefinedBehaviorSanitizer.
 *
 * These tests target V2-k: AnyType passes a raw pointer (PVALUE) to the
 * caller's storage, so literal arguments must keep their backing storage alive
 * for the duration of the call.  A dangling pointer here is invisible to
 * functional tests and only shows up under ASan/UBSan.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

const sanitizerFlags = ["-fsanitize=address,undefined", "-fno-omit-frame-pointer"];

describe.skipIf(!hasGpp)("ANY generic parameters under sanitizers", () => {
  it("funGenericCompare with literal arguments does not dangle", () => {
    const sourceST = `
FUNCTION funGenericCompare : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR
VAR
  iCount : DINT;
END_VAR

IF any1.typeclass <> any2.typeclass THEN
  RETURN;
END_IF
IF any1.diSize <> any2.diSize THEN
  RETURN;
END_IF
FOR iCount := 0 TO any1.diSize - 1 DO
  IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
    RETURN;
  END_IF
END_FOR
funGenericCompare := TRUE;
RETURN;
END_FUNCTION

PROGRAM AnyLiteralTest
VAR
  same : BOOL;
  diff : BOOL;
END_VAR
same := funGenericCompare(WORD#16#00FF, WORD#16#00FF);
diff := funGenericCompare(WORD#16#00FF, WORD#16#FF00);
END_PROGRAM
`;

    const testST = `
TEST 'ANY literal arguments under sanitizers'
VAR uut : AnyLiteralTest; END_VAR
uut();
ASSERT_EQ(uut.same, TRUE);
ASSERT_EQ(uut.diff, FALSE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_any_literals.st",
      tempDirPrefix: "strucpp-any-lit-",
      extraFlags: sanitizerFlags,
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("funGenericCompare with elementary variables does not dangle", () => {
    const sourceST = `
FUNCTION funGenericCompare : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR
VAR
  iCount : DINT;
END_VAR

IF any1.typeclass <> any2.typeclass THEN
  RETURN;
END_IF
IF any1.diSize <> any2.diSize THEN
  RETURN;
END_IF
FOR iCount := 0 TO any1.diSize - 1 DO
  IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
    RETURN;
  END_IF
END_FOR
funGenericCompare := TRUE;
RETURN;
END_FUNCTION

PROGRAM AnyVarTest
VAR
  a : DWORD := 16#12345678;
  b : DWORD := 16#12345678;
  c : DWORD := 16#87654321;
  same : BOOL;
  diff : BOOL;
END_VAR
same := funGenericCompare(a, b);
diff := funGenericCompare(a, c);
END_PROGRAM
`;

    const testST = `
TEST 'ANY variable arguments under sanitizers'
VAR uut : AnyVarTest; END_VAR
uut();
ASSERT_EQ(uut.same, TRUE);
ASSERT_EQ(uut.diff, FALSE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_any_vars.st",
      tempDirPrefix: "strucpp-any-var-",
      extraFlags: sanitizerFlags,
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
