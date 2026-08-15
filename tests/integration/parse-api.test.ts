// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect } from "vitest";
import { parse } from "../../src/index.js";

describe("parse() API", () => {
  it("returns an AST for valid source", () => {
    const result = parse("PROGRAM Main END_PROGRAM");
    expect(result.errors).toHaveLength(0);
    expect(result.ast).toBeDefined();
    expect(result.ast!.kind).toBe("CompilationUnit");
  });

  it("returns errors for invalid source", () => {
    const result = parse("PROGRAM");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.ast).toBeUndefined();
  });
});
