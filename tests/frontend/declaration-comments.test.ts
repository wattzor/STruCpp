// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project

import { describe, it, expect } from "vitest";
import { parse } from "../../src/frontend/parser.js";
import { buildAST } from "../../src/frontend/ast-builder.js";
import type { CompilationUnit } from "../../src/frontend/ast.js";

function compileUnit(source: string): CompilationUnit {
  const result = parse(source);
  expect(result.errors).toHaveLength(0);
  expect(result.cst).toBeDefined();
  return buildAST(result.cst!, undefined, undefined, result.comments);
}

function firstVarDecl(ast: CompilationUnit) {
  const fb = ast.functionBlocks[0] ?? ast.programs[0];
  expect(fb).toBeDefined();
  const block = fb!.varBlocks[0];
  expect(block).toBeDefined();
  expect(block.declarations).toHaveLength(1);
  return block.declarations[0]!;
}

describe("Declaration comment binding", () => {
  it("binds a trailing line comment to the declaration", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        x : INT; // trailing comment
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["X"]);
    expect(decl.comment).toBe("trailing comment");
  });

  it("binds a preceding line comment to the declaration", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        // preceding comment
        y : BOOL;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["Y"]);
    expect(decl.comment).toBe("preceding comment");
  });

  it("binds a preceding block comment to the declaration", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        (* block comment *)
        z : REAL;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["Z"]);
    expect(decl.comment).toBe("block comment");
  });

  it("preserves nested block comment delimiters", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        (* outer (* inner *) outer *)
        w : BYTE;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.comment).toBe("outer (* inner *) outer");
  });

  it("discards comments that are not trailing or immediately preceding", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        (* unrelated *)

        a : INT;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["A"]);
    expect(decl.comment).toBeUndefined();
  });

  it("binds comments independently per declaration", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR
        // first
        b : INT;
        c : BOOL; // second
      END_VAR
      END_PROGRAM
    `);
    const fb = ast.programs[0] ?? ast.functionBlocks[0];
    const decls = fb!.varBlocks[0]!.declarations;
    expect(decls).toHaveLength(2);
    expect(decls[0]!.comment).toBe("first");
    expect(decls[1]!.comment).toBe("second");
  });

  it("does not bind a comment separated by a blank line from a declaration", () => {
    const ast = compileUnit(`
      PROGRAM Main
      VAR // var comment

        d : INT;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["D"]);
    expect(decl.comment).toBeUndefined();
  });

  it("does not bind a comment that appears before the VAR block", () => {
    const ast = compileUnit(`
      PROGRAM Main
      (* before var *)
      VAR
        e : INT;
      END_VAR
      END_PROGRAM
    `);
    const decl = firstVarDecl(ast);
    expect(decl.names).toEqual(["E"]);
    expect(decl.comment).toBeUndefined();
  });
});
