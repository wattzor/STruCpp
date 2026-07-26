// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS Boolean operator evaluation order.
 *
 * Plain `AND` and `OR` evaluate all operands (no short-circuit).  The
 * short-circuit forms are `AND_THEN` and `OR_ELSE` (CODESYS extensions).
 *
 * Sources:
 * - CODESYS: "In contrast, CODESYS always evaluates all operands when using
 *   the `AND` IEC operator." (Operator: AND_THEN)
 * - CODESYS: `AND_THEN` executes other operands only if the first operand is
 *   TRUE; `OR_ELSE` only if the first operand is FALSE.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("Boolean operator short-circuit evaluation", () => {
  it("plain AND evaluates the right operand even when left is FALSE", () => {
    const sourceST = `
FUNCTION sideEffect : BOOL
VAR_IN_OUT
  counter : DINT;
END_VAR
counter := counter + 1;
sideEffect := TRUE;
END_FUNCTION

PROGRAM AndNoShortCircuit
VAR
  counter : DINT := 0;
  result : BOOL;
END_VAR
result := FALSE AND sideEffect(counter);
END_PROGRAM
`;

    const testST = `
TEST 'AND does not short-circuit'
VAR uut : AndNoShortCircuit; END_VAR
uut();
ASSERT_EQ(uut.counter, 1);
ASSERT_EQ(uut.result, FALSE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_and_no_shortcircuit.st",
      tempDirPrefix: "strucpp-and-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("plain OR evaluates the right operand even when left is TRUE", () => {
    const sourceST = `
FUNCTION sideEffect : BOOL
VAR_IN_OUT
  counter : DINT;
END_VAR
counter := counter + 1;
sideEffect := TRUE;
END_FUNCTION

PROGRAM OrNoShortCircuit
VAR
  counter : DINT := 0;
  result : BOOL;
END_VAR
result := TRUE OR sideEffect(counter);
END_PROGRAM
`;

    const testST = `
TEST 'OR does not short-circuit'
VAR uut : OrNoShortCircuit; END_VAR
uut();
ASSERT_EQ(uut.counter, 1);
ASSERT_EQ(uut.result, TRUE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_or_no_shortcircuit.st",
      tempDirPrefix: "strucpp-or-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("AND_THEN short-circuits when the left operand is FALSE", () => {
    const sourceST = `
FUNCTION sideEffect : BOOL
VAR_IN_OUT
  counter : DINT;
END_VAR
counter := counter + 1;
sideEffect := TRUE;
END_FUNCTION

PROGRAM AndThenShortCircuit
VAR
  counter : DINT := 0;
  result : BOOL;
END_VAR
result := FALSE AND_THEN sideEffect(counter);
END_PROGRAM
`;

    const testST = `
TEST 'AND_THEN short-circuits'
VAR uut : AndThenShortCircuit; END_VAR
uut();
ASSERT_EQ(uut.counter, 0);
ASSERT_EQ(uut.result, FALSE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_and_then.st",
      tempDirPrefix: "strucpp-and-then-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("OR_ELSE short-circuits when the left operand is TRUE", () => {
    const sourceST = `
FUNCTION sideEffect : BOOL
VAR_IN_OUT
  counter : DINT;
END_VAR
counter := counter + 1;
sideEffect := TRUE;
END_FUNCTION

PROGRAM OrElseShortCircuit
VAR
  counter : DINT := 0;
  result : BOOL;
END_VAR
result := TRUE OR_ELSE sideEffect(counter);
END_PROGRAM
`;

    const testST = `
TEST 'OR_ELSE short-circuits'
VAR uut : OrElseShortCircuit; END_VAR
uut();
ASSERT_EQ(uut.counter, 0);
ASSERT_EQ(uut.result, TRUE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_or_else.st",
      tempDirPrefix: "strucpp-or-else-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
