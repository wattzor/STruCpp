// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * POINTER TO indexing and dereference runtime tests.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("POINTER TO indexing", () => {
  it("indexes through a POINTER TO INT into an array", () => {
    const sourceST = `
PROGRAM PointerIndex
VAR
  arr : ARRAY[0..3] OF INT;
  p : POINTER TO INT;
  v : INT;
END_VAR
arr[0] := 10; arr[1] := 20; arr[2] := 30; arr[3] := 40;
p := ADR(arr);
v := p[1];
END_PROGRAM
`;

    const testST = `
TEST 'POINTER TO INT index access'
VAR uut : PointerIndex; END_VAR
uut();
ASSERT_EQ(uut.v, 20);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_pointer_index.st",
      tempDirPrefix: "strucpp-pointer-index-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
