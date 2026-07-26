// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS VAR_IN_OUT FB-instance semantics.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("VAR_IN_OUT FB instance passing", () => {
  it("passes an FB instance by reference through VAR_IN_OUT", () => {
    const sourceST = `
      FUNCTION_BLOCK Counter
      VAR
        count : INT;
      END_VAR
        METHOD PUBLIC Inc : INT
          count := count + 1;
          Inc := count;
        END_METHOD
        METHOD PUBLIC GetCount : INT
          GetCount := count;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK BumpWrapper
      VAR_IN_OUT
        c : Counter;
      END_VAR
        METHOD PUBLIC DoBump
          c.Inc();
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT FB by reference'
      VAR
        c : Counter;
        w : BumpWrapper;
        got : INT;
      END_VAR
      w(c := c);
      w.DoBump();
      got := c.GetCount();
      ASSERT_EQ(got, 1);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_fb_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
