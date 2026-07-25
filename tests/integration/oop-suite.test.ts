// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * System Integration Test (SIT) combining all recent OOP features:
 *  - interfaces with inheritance
 *  - multiple IMPLEMENTS
 *  - FB inheritance and method override
 *  - __QUERYINTERFACE from FB, interface var, and method return value
 *  - interface pointer arrays and element method calls
 *  - interface VAR_IN_OUT parameters
 *  - properties with local VAR blocks
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("OOP feature integration suite", () => {
  it("combines interfaces, inheritance, properties, arrays, and VAR_IN_OUT", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetBaseValue : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IDerived EXTENDS IBase
        METHOD GetDerivedValue : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IExtra
        METHOD GetExtraValue : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK Base IMPLEMENTS IBase
        PROPERTY PUBLIC BaseProp : INT
          GET
            VAR tmp : INT; END_VAR
            tmp := 100;
            BaseProp := tmp;
          END_GET
        END_PROPERTY

        METHOD PUBLIC GetBaseValue : INT
          GetBaseValue := 1;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Child EXTENDS Base IMPLEMENTS IDerived, IExtra
        METHOD PUBLIC GetBaseValue : INT
          GetBaseValue := 10;
        END_METHOD
        METHOD PUBLIC GetDerivedValue : INT
          GetDerivedValue := 20;
        END_METHOD
        METHOD PUBLIC GetExtraValue : INT
          GetExtraValue := 30;
        END_METHOD
        METHOD PUBLIC GetAsDerived : IDerived
          GetAsDerived := THIS^;
        END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION SumItf : INT
      VAR_IN_OUT
        itf : IBase;
      END_VAR
      VAR
        derived : IDerived;
        ok : BOOL;
      END_VAR
        ok := __QUERYINTERFACE(itf, derived);
        IF ok THEN
          SumItf := derived.GetDerivedValue() + derived.GetBaseValue();
        ELSE
          SumItf := -1;
        END_IF;
      END_FUNCTION
    `;

    const testST = `
      TEST 'OOP SIT'
      VAR
        c : Child;
        base : IBase := c;
        d : IDerived;
        e : IExtra;
        arr : ARRAY[1..2] OF IExtra;
        ok1, ok2, ok3, ok4 : BOOL;
        v1, v2, prop, sum : INT;
      END_VAR
      ok1 := __QUERYINTERFACE(c, d);
      ok2 := __QUERYINTERFACE(base, e);
      ok3 := __QUERYINTERFACE(c.GetAsDerived(), arr[1]);
      ok4 := __QUERYINTERFACE(c, arr[2]);
      v1 := d.GetBaseValue();
      v2 := arr[1].GetExtraValue();
      prop := c.BaseProp;
      sum := SumItf(itf := base);
      ASSERT_EQ(ok1, TRUE);
      ASSERT_EQ(ok2, TRUE);
      ASSERT_EQ(ok3, TRUE);
      ASSERT_EQ(ok4, TRUE);
      ASSERT_EQ(v1, 10);
      ASSERT_EQ(v2, 30);
      ASSERT_EQ(arr[2].GetExtraValue(), 30);
      ASSERT_EQ(prop, 100);
      ASSERT_EQ(sum, 30);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "oop_sit_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
