/**
 * ANY / AnyType generic parameter semantic validation.
 */

import { describe, it, expect } from "vitest";
import { parse } from "../../src/frontend/parser.js";
import { buildAST } from "../../src/frontend/ast-builder.js";
import { analyze } from "../../src/semantic/analyzer.js";

function analyzeSource(source: string) {
  const parseResult = parse(source);
  expect(parseResult.errors).toHaveLength(0);
  const ast = buildAST(parseResult.cst!);
  return analyze(ast);
}

describe("ANY generic parameter validation", () => {
  it("allows ANY in a function VAR_INPUT parameter", () => {
    const result = analyzeSource(`
      FUNCTION funGeneric : BOOL
        VAR_INPUT any1 : ANY; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Generic type") }),
    );
  });

  it("rejects ANY as a function return type", () => {
    const result = analyzeSource(`
      FUNCTION funGeneric : ANY
        VAR_INPUT any1 : INT; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Generic type");
  });

  it("rejects ANY as a local variable", () => {
    const result = analyzeSource(`
      FUNCTION funGeneric : BOOL
        VAR any1 : ANY; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Generic type");
  });

  it("rejects ANY as a VAR_OUTPUT parameter", () => {
    const result = analyzeSource(`
      FUNCTION funGeneric : BOOL
        VAR_OUTPUT any1 : ANY; END_VAR
      END_FUNCTION
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Generic type");
  });

  it("rejects ANY as a STRUCT field", () => {
    const result = analyzeSource(`
      TYPE MyStruct : STRUCT
        field : ANY;
      END_STRUCT END_TYPE
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Generic type");
  });

  it("rejects ANY as a global variable", () => {
    const result = analyzeSource(`
      VAR_GLOBAL
        gAny : ANY;
      END_VAR
      PROGRAM Main END_PROGRAM
    `);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("Generic type");
  });

  it("allows ANY_DATE as a function parameter type", () => {
    const result = analyzeSource(`
      FUNCTION funDate : BOOL
        VAR_INPUT x : ANY_DATE; END_VAR
      END_FUNCTION

      PROGRAM Main END_PROGRAM
    `);
    // ANY_DATE is a known generic group name and is allowed in VAR_INPUT
    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("Undefined type") }),
    );
  });
});
