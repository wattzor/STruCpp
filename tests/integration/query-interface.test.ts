// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS __QUERYINTERFACE runtime support.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("__QUERYINTERFACE runtime support", () => {
  it("returns FALSE when the source object does not implement the requested interface", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IOther
        METHOD GetOther : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 10;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'QueryInterface failure returns FALSE'
      VAR
        c : Comp;
        itf : IOther;
        ok : BOOL;
      END_VAR
      ok := __QUERYINTERFACE(c, itf);
      ASSERT_EQ(ok, FALSE);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "query_interface_fail_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries an interface from an FB and chains to a derived interface", () => {
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
      TEST 'QueryInterface chains'
      VAR
        c : Comp;
        itfBase : IBase;
        itfDerived : IDerived;
        okBase : BOOL;
        okDerived : BOOL;
        got : INT;
      END_VAR
      okBase := __QUERYINTERFACE(c, itfBase);
      okDerived := __QUERYINTERFACE(itfBase, itfDerived);
      got := itfBase.GetValue();
      ASSERT_EQ(got, 10);
      got := itfDerived.GetExtra();
      ASSERT_EQ(got, 20);
      ASSERT_EQ(okBase, TRUE);
      ASSERT_EQ(okDerived, TRUE);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "query_interface_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries an interface into a POINTER TO interface", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 10;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'QueryInterface into POINTER TO interface'
      VAR
        c : Comp;
        itfPtr : POINTER TO IBase;
        ok : BOOL;
        got : INT;
      END_VAR
      ok := __QUERYINTERFACE(c, itfPtr);
      got := itfPtr^.GetValue();
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(got, 10);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "query_interface_ptr_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });

  it("queries an interface into a POINTER TO interface field and calls through it", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Inner IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 42;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Container
        VAR
          inner : Inner;
          itfPtr : POINTER TO IBase;
        END_VAR
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Comp IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 10;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'QueryInterface into nested POINTER TO interface field'
      VAR
        c : Comp;
        cont : Container;
        ok : BOOL;
        got : INT;
      END_VAR
      ok := __QUERYINTERFACE(c, cont.itfPtr);
      got := cont.itfPtr^.GetValue();
      ASSERT_EQ(ok, TRUE);
      ASSERT_EQ(got, 10);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "query_interface_nested_ptr_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
