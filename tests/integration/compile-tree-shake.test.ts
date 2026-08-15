// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";

describe("compile() library tree-shaking", () => {
  it("emits only chunks reachable from the user source", () => {
    const lib = {
      formatVersion: 1 as const,
      manifest: {
        name: "MyLib",
        version: "1.0.0",
        namespace: "MyLib",
        functions: [
          {
            name: "TRIPLE",
            returnType: "INT",
            parameters: [
              { name: "x", type: "INT", direction: "input" as const },
            ],
          },
        ],
        functionBlocks: [],
        types: [],
        globals: [],
        headers: [],
        isBuiltin: false,
      },
      chunks: [
        {
          name: "TRIPLE",
          kind: "function" as const,
          header: "// TRIPLE header chunk",
          cpp: "// TRIPLE body chunk",
          deps: [],
        },
        {
          name: "UNUSED",
          kind: "function" as const,
          header: "// UNUSED header chunk",
          cpp: "// UNUSED body chunk",
          deps: [],
        },
      ],
      dependencies: [],
    };

    const result = compile(
      "PROGRAM Main VAR x : INT; END_VAR x := TRIPLE(7); END_PROGRAM",
      { libraries: [lib] },
    );

    expect(result.success).toBe(true);
    expect(result.headerCode).toContain("// TRIPLE header chunk");
    expect(result.headerCode).not.toContain("// UNUSED header chunk");
    expect(result.cppCode).toContain("// TRIPLE body chunk");
    expect(result.cppCode).not.toContain("// UNUSED body chunk");
  });

  it("handles missing chunk targets in dependency BFS", () => {
    const lib = {
      formatVersion: 1 as const,
      manifest: {
        name: "DepLib",
        version: "1.0.0",
        namespace: "DepLib",
        functions: [
          {
            name: "CHUNK_A",
            returnType: "INT",
            parameters: [],
          },
        ],
        functionBlocks: [],
        types: [],
        globals: [],
        headers: [],
        isBuiltin: false,
      },
      chunks: [
        {
          name: "CHUNK_A",
          kind: "function" as const,
          header: "// CHUNK_A header",
          cpp: "// CHUNK_A body",
          deps: [{ library: "DepLib", name: "MISSING" }],
        },
      ],
      dependencies: [],
    };

    const result = compile(
      "PROGRAM Main VAR x : INT; END_VAR x := CHUNK_A(); END_PROGRAM",
      { libraries: [lib] },
    );

    expect(result.success).toBe(true);
    expect(result.headerCode).toContain("// CHUNK_A header");
  });

  it("handles archives without a chunks array in normal compiles", () => {
    const lib = {
      formatVersion: 1 as const,
      manifest: {
        name: "NoChunkLib",
        version: "1.0.0",
        namespace: "NoChunkLib",
        functions: [],
        functionBlocks: [],
        types: [],
        globals: [],
        headers: [],
        isBuiltin: false,
      },
      chunks: undefined as unknown as typeof lib["chunks"],
      dependencies: [],
    };

    const result = compile(
      "PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM",
      { libraries: [lib] },
    );

    expect(result.success).toBe(true);
  });

  it("handles archives without a chunks array in test builds", () => {
    const lib = {
      formatVersion: 1 as const,
      manifest: {
        name: "NoChunkLib",
        version: "1.0.0",
        namespace: "NoChunkLib",
        functions: [],
        functionBlocks: [],
        types: [],
        globals: [],
        headers: [],
        isBuiltin: false,
      },
      // Intentionally omit chunks to exercise the nullish-coalescing fallback.
      chunks: undefined as unknown as typeof lib["chunks"],
      dependencies: [],
    };

    const result = compile(
      "PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM",
      { libraries: [lib], isTestBuild: true },
    );

    expect(result.success).toBe(true);
  });
});
