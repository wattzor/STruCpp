/**
 * CODESYS ANY / AnyType generic parameter integration tests.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("ANY generic parameters", () => {
  it("compiles and runs the CODESYS funGenericCompare example", () => {
    const sourceST = `
FUNCTION funGenericCompare : BOOL
VAR_INPUT
  any1 : ANY;
  any2 : ANY;
END_VAR
VAR
  pTest : POINTER TO ARRAY [0..100] OF POINTER TO DWORD;
  iCount : DINT;
END_VAR

pTest := ADR(any1);
funGenericCompare := FALSE;
IF any1.typeclass <> any2.typeclass THEN
  RETURN;
END_IF
IF any1.diSize <> any2.diSize THEN
  RETURN;
END_IF
FOR iCount := 0 TO any1.diSize-1 DO
  IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
    RETURN;
  END_IF
END_FOR
funGenericCompare := TRUE;
RETURN;
END_FUNCTION

PROGRAM AnyTypeTest
VAR
  w1 : WORD := 16#FFFF;
  w2 : WORD := 16#0001;
  w3 : WORD := 16#FFFF;
  resultSame : BOOL;
  resultDiff : BOOL;
END_VAR
resultSame := funGenericCompare(w1, w3);
resultDiff := funGenericCompare(w1, w2);
END_PROGRAM
`;

    const testST = `
TEST 'funGenericCompare with ANY parameters'
VAR uut : AnyTypeTest; END_VAR
uut();
ASSERT_EQ(uut.resultSame, TRUE);
ASSERT_EQ(uut.resultDiff, FALSE);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_any_type.st",
      tempDirPrefix: "strucpp-any-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
