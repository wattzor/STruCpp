// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * TRUNC / ROUND return DINT and round away from zero at half values.
 *
 * CODESYS V3 (and IEC 61131-3) defines TRUNC and ROUND as real-to-integer
 * conversions returning a DINT.  This was previously registered as
 * ANY_REAL -> ANY_REAL, which is a live defect.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("TRUNC and ROUND semantics", () => {
  it("TRUNC returns DINT toward zero", () => {
    const sourceST = `
PROGRAM TruncTest
VAR
  r1 : REAL := 1.9;
  r2 : REAL := -1.4;
  lr : LREAL := 2.7;
  i1 : DINT;
  i2 : DINT;
  i3 : DINT;
END_VAR
i1 := TRUNC(r1);
i2 := TRUNC(r2);
i3 := TRUNC(lr);
END_PROGRAM
`;

    const testST = `
TEST 'TRUNC returns DINT'
VAR uut : TruncTest; END_VAR
uut();
ASSERT_EQ(uut.i1, 1);
ASSERT_EQ(uut.i2, -1);
ASSERT_EQ(uut.i3, 2);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_trunc.st",
      tempDirPrefix: "strucpp-trunc-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("ROUND returns DINT and rounds half away from zero", () => {
    const sourceST = `
PROGRAM RoundTest
VAR
  a : REAL := 1.4;
  b : REAL := 1.6;
  c : REAL := 1.5;
  d : REAL := -1.5;
  e : LREAL := -2.5;
  ra : DINT;
  rb : DINT;
  rc : DINT;
  rd : DINT;
  re : DINT;
END_VAR
ra := ROUND(a);
rb := ROUND(b);
rc := ROUND(c);
rd := ROUND(d);
re := ROUND(e);
END_PROGRAM
`;

    const testST = `
TEST 'ROUND returns DINT'
VAR uut : RoundTest; END_VAR
uut();
ASSERT_EQ(uut.ra, 1);
ASSERT_EQ(uut.rb, 2);
ASSERT_EQ(uut.rc, 2);
ASSERT_EQ(uut.rd, -2);
ASSERT_EQ(uut.re, -3);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_round.st",
      tempDirPrefix: "strucpp-round-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("INT_TO_BYTE accepts TRUNC output", () => {
    const sourceST = `
FUNCTION range_to_byte : BYTE
VAR_INPUT
  x : REAL;
  low : REAL;
  high : REAL;
END_VAR
range_to_byte := INT_TO_BYTE(TRUNC((LIMIT(low, x, high) - low) * 255.0 / (high - low)));
END_FUNCTION

PROGRAM TruncIntToByte
VAR
  b : BYTE;
END_VAR
b := range_to_byte(0.5, 0.0, 1.0);
END_PROGRAM
`;

    const testST = `
TEST 'TRUNC INT_TO_BYTE pipeline'
VAR uut : TruncIntToByte; END_VAR
uut();
ASSERT_EQ(uut.b, 127);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_trunc_int_to_byte.st",
      tempDirPrefix: "strucpp-trunc-byte-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("ROUND / TRUNC accept untyped real literals without overload ambiguity", () => {
    const sourceST = `
PROGRAM LiteralRoundTrunc
VAR
  a : DINT;
  b : DINT;
  c : DINT;
END_VAR
a := ROUND(1.5);
b := TRUNC(1.9);
c := TRUNC_INT(1.9);
END_PROGRAM
`;

    const testST = `
TEST 'ROUND/TRUNC literal overload resolution'
VAR uut : LiteralRoundTrunc; END_VAR
uut();
ASSERT_EQ(uut.a, 2);
ASSERT_EQ(uut.b, 1);
ASSERT_EQ(uut.c, 1);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_literal_round_trunc.st",
      tempDirPrefix: "strucpp-literal-round-trunc-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("TRUNC_INT returns INT toward zero", () => {
    const sourceST = `
PROGRAM TruncIntTest
VAR
  r1 : REAL := 1.9;
  r2 : REAL := -1.4;
  lr : LREAL := 2.7;
  i1 : INT;
  i2 : INT;
  i3 : INT;
END_VAR
i1 := TRUNC_INT(r1);
i2 := TRUNC_INT(r2);
i3 := TRUNC_INT(lr);
END_PROGRAM
`;

    const testST = `
TEST 'TRUNC_INT returns INT'
VAR uut : TruncIntTest; END_VAR
uut();
ASSERT_EQ(uut.i1, 1);
ASSERT_EQ(uut.i2, -1);
ASSERT_EQ(uut.i3, 2);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_trunc_int.st",
      tempDirPrefix: "strucpp-trunc-int-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
