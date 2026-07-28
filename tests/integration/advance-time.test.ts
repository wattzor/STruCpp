// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * ADVANCE_TIME runtime semantics in program bodies.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("ADVANCE_TIME in program bodies", () => {
  it("advances the simulated clock so TIME() increases", () => {
    const sourceST = `
PROGRAM TimeAdvance
VAR
  delta : TIME;
END_VAR
  delta := TIME();
  ADVANCE_TIME(T#600ms);
  delta := TIME() - delta;
END_PROGRAM
`;

    const testST = `
TEST 'ADVANCE_TIME advances TIME()'
VAR uut : TimeAdvance; END_VAR
uut();
ASSERT_EQ(uut.delta, T#600ms);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_advance_time.st",
      tempDirPrefix: "strucpp-advance-time-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
