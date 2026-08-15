// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";

describe("compile() option handling", () => {
  it("rejects invalid pouIncludes entries", () => {
    expect(() =>
      compile("PROGRAM Main END_PROGRAM", {
        pouIncludes: ["foo;bar"],
      }),
    ).toThrow(/is not a valid include filename/);
  });

  it("includes line directive file name when requested", () => {
    const result = compile("PROGRAM Main END_PROGRAM", {
      lineDirectives: true,
      lineDirectiveFileName: "main.st",
    });
    expect(result.success).toBe(true);
    expect(result.cppCode).toContain('#line 1 "main.st"');
  });

  it("passes chunk marker option through to codegen", () => {
    const result = compile("PROGRAM Main END_PROGRAM", {
      emitChunkMarkers: true,
    });
    expect(result.success).toBe(true);
    // Chunk markers are wrapped in comments so they are harmless in C++
    expect(result.cppCode).toContain("//@chunk:begin");
  });

  it("tags parse errors with the supplied file name", () => {
    const result = compile("PROGRAM", { fileName: "main.st" });
    expect(result.success).toBe(false);
    expect(result.errors[0]?.file).toBe("main.st");
  });

  it("skips additional source files that fail to parse", () => {
    const result = compile(
      "PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM",
      {
        additionalSources: [
          {
            fileName: "broken.st",
            source: "PROGRAM Other VAR x : END_VAR END_PROGRAM",
          },
        ],
      },
    );

    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.file === "broken.st")).toBe(true);
  });

  it("includes the MD5 in the debug map when supplied", () => {
    const result = compile("PROGRAM Main END_PROGRAM", {
      md5: "deadbeef",
    });
    expect(result.success).toBe(true);
    expect(result.debugMap?.md5).toBe("deadbeef");
  });
});
