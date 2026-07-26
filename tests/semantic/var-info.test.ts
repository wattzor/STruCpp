/**
 * STruC++ Semantic Analyzer - __VARINFO negative tests.
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

describe("__VARINFO", () => {
  it("rejects a non-variable argument with a parse error", () => {
    const parseResult = parse(`
      PROGRAM Main
        VAR i : INT; END_VAR
        i := __VARINFO(123);
      END_PROGRAM
    `);

    expect(parseResult.errors.length).toBeGreaterThan(0);
    expect(parseResult.errors[0]!.message).toContain("Unexpected integer literal");
  });

  it("rejects an undeclared variable as the argument", () => {
    const result = analyzeSource(`
      PROGRAM Main
        VAR info : __SYSTEM.VAR_INFO; END_VAR
        info := __VARINFO(missingVar);
      END_PROGRAM
    `);

    const undeclared = result.errors.filter((e) =>
      e.message.includes("Undeclared variable"),
    );
    expect(undeclared).toHaveLength(1);
    expect(undeclared[0]!.message).toContain("MISSINGVAR");
  });
});
