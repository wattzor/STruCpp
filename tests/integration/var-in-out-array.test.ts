// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS VAR_IN_OUT arrays of FB instances and interface pointers.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("VAR_IN_OUT arrays", () => {
  it("passes an array of FB instances by reference and mutates elements", () => {
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

      FUNCTION_BLOCK ArrayWrapper
      VAR_IN_OUT
        arr : ARRAY[1..2] OF Counter;
      END_VAR
        METHOD PUBLIC BumpAll
          arr[1].Inc();
          arr[2].Inc();
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT array of FB'
      VAR
        c : ARRAY[1..2] OF Counter;
        w : ArrayWrapper;
        got1, got2 : INT;
      END_VAR
      w(arr := c);
      w.BumpAll();
      got1 := c[1].GetCount();
      got2 := c[2].GetCount();
      ASSERT_EQ(got1, 1);
      ASSERT_EQ(got2, 1);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_array_fb_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("passes an array of interface pointers through VAR_IN_OUT", () => {
    const sourceST = `
      INTERFACE ICounter
        METHOD GetCount : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Counter IMPLEMENTS ICounter
      VAR
        count : INT;
      END_VAR
        METHOD PUBLIC GetCount : INT
          GetCount := count;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK ItfArrayWrapper
      VAR_IN_OUT
        arr : ARRAY[1..2] OF ICounter;
      END_VAR
        METHOD PUBLIC Sum : INT
          Sum := arr[1].GetCount() + arr[2].GetCount();
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT array of interface pointers'
      VAR
        c1, c2 : Counter;
        arr : ARRAY[1..2] OF ICounter;
        ok1, ok2 : BOOL;
        got : INT;
        w : ItfArrayWrapper;
      END_VAR
      c1.count := 3;
      c2.count := 5;
      ok1 := __QUERYINTERFACE(c1, arr[1]);
      ok2 := __QUERYINTERFACE(c2, arr[2]);
      w(arr := arr);
      got := w.Sum();
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(got, 8);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_array_itf_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
