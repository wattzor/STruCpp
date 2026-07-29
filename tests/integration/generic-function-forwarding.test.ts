// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS-compliant ANY / ANY_* generic FUNCTION validation.
 *
 * CODESYS only permits ANY/ANY_* in VAR_INPUT parameters, passes them as an
 * AnyType descriptor, and rejects literals/expressions as actual arguments.
 * User-defined functions must return a concrete type and cannot forward generic
 * parameters directly to standard functions.
 */

import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";

describe("generic FUNCTION CODESYS validation", () => {
  it("rejects ANY_NUM as a function return type", () => {
    const result = compile(`
      FUNCTION MaxAny : ANY_NUM
        VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("only allowed in VAR_INPUT"),
      ),
    ).toBe(true);
  });

  it("rejects forwarding ANY_NUM parameters to a standard function", () => {
    const result = compile(`
      FUNCTION MaxAny : INT
        VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
        MaxAny := LIMIT(mn, val, mx);
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.success).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.message.toLowerCase().includes("generic type") &&
          e.message.includes("LIMIT"),
      ),
    ).toBe(true);
  });

  it("rejects literal arguments to ANY parameters", () => {
    const result = compile(`
      FUNCTION F : BOOL
        VAR_INPUT x : ANY; END_VAR
      END_FUNCTION

      PROGRAM Main
      VAR
        b : BOOL;
      END_VAR
        b := F(INT#5);
      END_PROGRAM
    `);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("requires a variable"),
      ),
    ).toBe(true);
  });

  it("rejects expression arguments to ANY parameters", () => {
    const result = compile(`
      FUNCTION F : BOOL
        VAR_INPUT x : ANY; END_VAR
      END_FUNCTION

      PROGRAM Main
      VAR
        a, b : INT;
        r : BOOL;
      END_VAR
        r := F(a + b);
      END_PROGRAM
    `);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("requires a variable"),
      ),
    ).toBe(true);
  });

  it("rejects ANY_ELEMENTARY as a parameter type", () => {
    const result = compile(`
      FUNCTION F : BOOL
        VAR_INPUT x : ANY_ELEMENTARY; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.success).toBe(false);
    expect(
      result.errors.some((e) =>
        e.message.includes("not a valid CODESYS generic parameter type"),
      ),
    ).toBe(true);
  });

  it("rejects ANY_MAGNITUDE as a parameter type", () => {
    const result = compile(`
      FUNCTION F : BOOL
        VAR_INPUT x : ANY_MAGNITUDE; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.success).toBe(false);
  });

  it("rejects ANY_DERIVED as a parameter type", () => {
    const result = compile(`
      FUNCTION F : BOOL
        VAR_INPUT x : ANY_DERIVED; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.success).toBe(false);
  });

  it("compiles an ANY generic function called with variables", () => {
    const result = compile(`
      FUNCTION SameType : BOOL
      VAR_INPUT
        any1 : ANY;
        any2 : ANY;
      END_VAR
      VAR
        iCount : DINT;
      END_VAR

      IF any1.typeclass <> any2.typeclass THEN
        RETURN;
      END_IF
      IF any1.diSize <> any2.diSize THEN
        RETURN;
      END_IF
      FOR iCount := 0 TO any1.diSize - 1 DO
        IF any1.pvalue[iCount] <> any2.pvalue[iCount] THEN
          RETURN;
        END_IF
      END_FOR
      SameType := TRUE;
      RETURN;
      END_FUNCTION

      PROGRAM Main
      VAR
        w1 : WORD := 16#00FF;
        w2 : WORD := 16#00FF;
        same : BOOL;
      END_VAR
        same := SameType(w1, w2);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);
    expect(result.cppFiles?.length).toBeGreaterThan(1);
  });
});
