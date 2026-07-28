/**
 * CASE statement label validation
 */

import { describe, it, expect } from "vitest";
import { SemanticAnalyzer } from "../../src/semantic/analyzer.js";
import { buildAST } from "../../src/frontend/ast-builder.js";
import { parse } from "../../src/frontend/parser.js";
import type { CompileError } from "../../src/types.js";

function analyzeSource(source: string): {
  errors: string[];
  warnings: string[];
  diagnostics: CompileError[];
} {
  const parseResult = parse(source);
  if (parseResult.errors.length > 0) {
    throw new Error(
      `Parse error: ${parseResult.errors.map((e: unknown) => (e as { message: string }).message).join(", ")}`,
    );
  }
  const ast = buildAST(parseResult.cst!, "test.st");
  const analyzer = new SemanticAnalyzer();
  const result = analyzer.analyze(ast);
  return {
    errors: result.errors.map((e) => e.message),
    warnings: result.warnings.map((e) => e.message),
    diagnostics: result.errors,
  };
}

describe("CASE label validation", () => {
  it("accepts unique constant integer labels", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; END_VAR
        CASE x OF
          1:
          2:
          3..5:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors).toHaveLength(0);
  });

  it("rejects duplicate integer labels", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; END_VAR
        CASE x OF
          1:
          1:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors.some((e) => e.includes("Duplicate CASE label value"))).toBe(true);
  });

  it("rejects overlapping range labels", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; END_VAR
        CASE x OF
          1..5:
          3:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors.some((e) => e.includes("Duplicate CASE label value"))).toBe(true);
  });

  it("rejects variable labels", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; y : INT := 2; END_VAR
        CASE x OF
          y:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors.some((e) => e.includes("CASE label must be a constant integer expression"))).toBe(true);
  });

  it("rejects variable range bounds", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; lo : INT := 1; hi : INT := 3; END_VAR
        CASE x OF
          lo..hi:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors.some((e) => e.includes("CASE label must be a constant integer expression"))).toBe(true);
  });

  it("accepts named VAR CONSTANT labels", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR CONSTANT MAX : INT := 5; END_VAR
        VAR x : INT; END_VAR
        CASE x OF
          MAX:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors).toHaveLength(0);
  });

  it("handles a large CASE range without expanding values", () => {
    const { errors } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; END_VAR
        CASE x OF
          0..1000000000:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors).toHaveLength(0);
  });

  it("disambiguates bare enum members by selector type", () => {
    const { errors } = analyzeSource(`
      TYPE Color : (RED, GREEN, BLUE) END_TYPE
      TYPE Status : (RED, YELLOW, GREEN) END_TYPE
      PROGRAM Main
        VAR c : Color; END_VAR
        CASE c OF
          GREEN:
        END_CASE;
      END_PROGRAM
    `);
    expect(errors).toHaveLength(0);
  });

  it("reports CASE label errors with the source file name", () => {
    const { diagnostics } = analyzeSource(`
      PROGRAM Main
        VAR x : INT; y : INT; END_VAR
        CASE x OF
          1:
          1:
          y:
        END_CASE;
      END_PROGRAM
    `);
    const dup = diagnostics.find((d) =>
      d.message.includes("Duplicate CASE label value"),
    );
    const nonConst = diagnostics.find((d) =>
      d.message.includes("CASE label must be a constant integer expression"),
    );
    expect(dup?.file).toBe("test.st");
    expect(nonConst?.file).toBe("test.st");
  });
});
