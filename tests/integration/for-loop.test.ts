// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * FOR loop runtime semantics — especially step direction handling.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("FOR loop semantics", () => {
  it("runs a descending loop when BY is a negative variable", () => {
    const sourceST = `
PROGRAM ForNegativeVar
VAR
  i : INT;
  n : INT := -1;
  c : INT;
END_VAR
FOR i := 3 TO 1 BY n DO
  c := c + 1;
END_FOR
END_PROGRAM
`;

    const testST = `
TEST 'FOR negative variable step'
VAR uut : ForNegativeVar; END_VAR
uut();
ASSERT_EQ(uut.c, 3);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_for_negative_var.st",
      tempDirPrefix: "strucpp-for-negative-var-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("evaluates the end value once at loop entry", () => {
    const sourceST = `
PROGRAM ForEndOnce
VAR
  i : INT;
  endVal : INT := 5;
  c : INT;
END_VAR
FOR i := 1 TO endVal BY 1 DO
  c := c + 1;
  endVal := 1;
END_FOR
END_PROGRAM
`;

    const testST = `
TEST 'FOR end evaluated once'
VAR uut : ForEndOnce; END_VAR
uut();
ASSERT_EQ(uut.c, 5);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_for_end_once.st",
      tempDirPrefix: "strucpp-for-end-once-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("evaluates the BY step once at loop entry", () => {
    const sourceST = `
PROGRAM ForStepOnce
VAR
  i : INT;
  stepVal : INT := 2;
  c : INT;
END_VAR
FOR i := 0 TO 6 BY stepVal DO
  c := c + 1;
  stepVal := 10;
END_FOR
END_PROGRAM
`;

    const testST = `
TEST 'FOR step evaluated once'
VAR uut : ForStepOnce; END_VAR
uut();
ASSERT_EQ(uut.c, 4);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_for_step_once.st",
      tempDirPrefix: "strucpp-for-step-once-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("runs an ascending loop when BY is a positive variable", () => {
    const sourceST = `
PROGRAM ForPositiveVar
VAR
  i : INT;
  n : INT := 2;
  c : INT;
END_VAR
FOR i := 1 TO 7 BY n DO
  c := c + 1;
END_FOR
END_PROGRAM
`;

    const testST = `
TEST 'FOR positive variable step'
VAR uut : ForPositiveVar; END_VAR
uut();
ASSERT_EQ(uut.c, 4);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_for_positive_var.st",
      tempDirPrefix: "strucpp-for-positive-var-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
