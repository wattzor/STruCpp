// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E edge cases for CODESYS VAR_IN_OUT semantics.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("VAR_IN_OUT edge cases", () => {
  it("mutates a VAR_IN_OUT FB instance through field assignment", () => {
    const sourceST = `
      FUNCTION_BLOCK Counter
      VAR
        count : INT;
      END_VAR
        METHOD PUBLIC GetCount : INT
          GetCount := count;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK ResetWrapper
      VAR_IN_OUT
        c : Counter;
      END_VAR
        METHOD PUBLIC DoReset
          c.count := 0;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT field assignment'
      VAR
        c : Counter;
        w : ResetWrapper;
        got : INT;
      END_VAR
      c.count := 5;
      w(c := c);
      w.DoReset();
      got := c.GetCount();
      ASSERT_EQ(got, 0);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_field_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries an interface from a VAR_IN_OUT FB instance", () => {
    const sourceST = `
      INTERFACE ICounter
        METHOD GetCount : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Counter IMPLEMENTS ICounter
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

      FUNCTION_BLOCK ItfWrapper
      VAR_IN_OUT
        c : Counter;
        itf : ICounter;
      END_VAR
        METHOD PUBLIC Bind
          VAR
            ok : BOOL;
          END_VAR
          ok := __QUERYINTERFACE(c, itf);
        END_METHOD
        METHOD PUBLIC BumpViaItf
          itf.GetCount();
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT interface query'
      VAR
        c : Counter;
        w : ItfWrapper;
        itf : ICounter;
        ok : BOOL;
        got : INT;
      END_VAR
      c.Inc();
      ok := __QUERYINTERFACE(c, itf);
      w(c := c, itf := itf);
      w.BumpViaItf();
      got := c.GetCount();
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(got, 1);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_itf_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("calls a method on a VAR_IN_OUT interface pointer", () => {
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

      FUNCTION_BLOCK ItfCaller
      VAR_IN_OUT
        itf : ICounter;
      END_VAR
        METHOD PUBLIC ReadItf : INT
          ReadItf := itf.GetCount();
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'VAR_IN_OUT interface pointer method call'
      VAR
        c : Counter;
        w : ItfCaller;
        got : INT;
      END_VAR
      c.count := 7;
      w(itf := c);
      got := w.ReadItf();
      ASSERT_EQ(got, 7);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "var_in_out_itf_call_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
