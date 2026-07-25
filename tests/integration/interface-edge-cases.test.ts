// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E edge-case tests for CODESYS interface support and __QUERYINTERFACE.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("interface edge cases", () => {
  it("queries an interface inherited from a base function block", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Base IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 10;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Derived EXTENDS Base
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'FB inheritance with IMPLEMENTS'
      VAR
        d : Derived;
        itf : IBase;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(d, itf);
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(itf.GetValue(), 10);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_fb_inherit_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries an interface when a derived FB adds an additional interface", () => {
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
      TEST 'Derived FB adds interface'
      VAR
        c : Child;
        b : IBase;
        d : IDerived;
        ok1, ok2 : BOOL;
      END_VAR
      ok1 := __QUERYINTERFACE(c, b);
      ok2 := __QUERYINTERFACE(c, d);
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(b.A(), 1);
      ASSERT_EQ(d.B(), 2);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_derived_adds_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("returns an interface pointer from a method using THIS", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 99;
        END_METHOD
        METHOD PUBLIC GetAsBase : IBase
          GetAsBase := THIS^;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Interface pointer method return'
      VAR
        c : Comp;
        itf : IBase;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(c.GetAsBase(), itf);
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(itf.GetValue(), 99);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_this_query_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("initializes an interface variable from a function block instance", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 55;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Interface init from FB instance'
      VAR
        c : Comp;
        itf : IBase := c;
      END_VAR
      ASSERT_EQ(itf.GetValue(), 55);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_init_from_fb_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("assigns a function block instance to an interface variable", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 66;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Interface assignment from FB instance'
      VAR
        c : Comp;
        itf : IBase;
      END_VAR
      itf := c;
      ASSERT_EQ(itf.GetValue(), 66);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_assign_from_fb_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("returns FALSE when querying an unimplemented interface", () => {
    const sourceST = `
      INTERFACE IFast
      END_INTERFACE

      INTERFACE IMarker
      END_INTERFACE

      FUNCTION_BLOCK Dummy IMPLEMENTS IMarker
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'QueryInterface unimplemented'
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
      testFileName: "interface_unimplemented_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("chains through a multi-level interface inheritance hierarchy", () => {
    const sourceST = `
      INTERFACE IA
        METHOD A : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IB EXTENDS IA
        METHOD B : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IC EXTENDS IB
        METHOD C : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IC
        METHOD PUBLIC A : INT
          A := 1;
        END_METHOD
        METHOD PUBLIC B : INT
          B := 2;
        END_METHOD
        METHOD PUBLIC C : INT
          C := 3;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Multi-level interface inheritance'
      VAR
        c : Comp;
        a : IA;
        b : IB;
        cc : IC;
        ok1, ok2, ok3 : BOOL;
      END_VAR
      ok1 := __QUERYINTERFACE(c, a);
      ok2 := __QUERYINTERFACE(a, b);
      ok3 := __QUERYINTERFACE(b, cc);
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(ok3, TRUE);
      ASSERT_EQ(a.A(), 1);
      ASSERT_EQ(b.B(), 2);
      ASSERT_EQ(cc.C(), 3);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "interface_multi_level_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
