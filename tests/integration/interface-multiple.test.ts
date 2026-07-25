// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for function blocks implementing multiple interfaces and querying them.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("multiple interface implementation", () => {
  it("supports IMPLEMENTS with several interfaces and queries each", () => {
    const sourceST = `
      INTERFACE IDrive
        METHOD Move : BOOL
        END_METHOD
      END_INTERFACE

      INTERFACE ISensor
        METHOD Read : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Robot IMPLEMENTS IDrive, ISensor
        METHOD PUBLIC Move : BOOL
          Move := TRUE;
        END_METHOD
        METHOD PUBLIC Read : INT
          Read := 42;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Multiple interface queries'
      VAR
        r : Robot;
        d : IDrive;
        s : ISensor;
        ok1 : BOOL;
        ok2 : BOOL;
      END_VAR
      ok1 := __QUERYINTERFACE(r, d);
      ok2 := __QUERYINTERFACE(r, s);
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(d.Move(), TRUE);
      ASSERT_EQ(s.Read(), 42);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_multiple_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("returns FALSE when the requested interface is not implemented", () => {
    const sourceST = `
      INTERFACE IFast
      END_INTERFACE

      INTERFACE IMarker
      END_INTERFACE

      FUNCTION_BLOCK Dummy IMPLEMENTS IMarker
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Failed query interface'
      VAR
        d : Dummy;
        f : IFast;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(d, f);
      ASSERT_EQ(ok, FALSE);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_fail_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries from an interface variable that was assigned from an FB instance", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IDerived EXTENDS IBase
        METHOD GetExtra : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IDerived
        METHOD PUBLIC GetValue : INT
          GetValue := 10;
        END_METHOD
        METHOD PUBLIC GetExtra : INT
          GetExtra := 20;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Query from interface variable'
      VAR
        c : Comp;
        base : IBase := c;
        derived : IDerived;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(base, derived);
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(derived.GetValue(), 10);
      ASSERT_EQ(derived.GetExtra(), 20);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_var_query_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("returns FALSE when the source interface pointer is null", () => {
    const sourceST = `
      INTERFACE IBase
      END_INTERFACE

      INTERFACE IDerived EXTENDS IBase
      END_INTERFACE
    `;

    const testST = `
      TEST 'Query null interface pointer'
      VAR
        base : IBase := 0;
        derived : IDerived;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(base, derived);
      ASSERT_EQ(ok, FALSE);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_null_query_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("supports FB inheritance where the base implements one interface and the derived adds another", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD A : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IDerived
        METHOD B : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Base IMPLEMENTS IBase
        METHOD PUBLIC A : INT
          A := 1;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Child EXTENDS Base IMPLEMENTS IDerived
        METHOD PUBLIC B : INT
          B := 2;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'FB inheritance adds interface'
      VAR
        ch : Child;
        b : IBase;
        d : IDerived;
        ok1, ok2 : BOOL;
      END_VAR
      ok1 := __QUERYINTERFACE(ch, b);
      ok2 := __QUERYINTERFACE(ch, d);
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(b.A(), 1);
      ASSERT_EQ(d.B(), 2);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_inherit_adds_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
