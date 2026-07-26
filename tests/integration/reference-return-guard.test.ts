// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ must not let a METHOD returning REFERENCE TO exit unbound.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import {
  hasGpp,
  createPCH,
  compileAndRunStandalone,
} from "./test-helpers.js";

describe.skipIf(!hasGpp)("REFERENCE TO return guard", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "strucpp-ref-return-guard-"),
    );
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("faults instead of dereferencing an unbound REFERENCE TO return", () => {
    const result = compile(`
      FUNCTION_BLOCK Box
      METHOD PUBLIC GetRef : REFERENCE TO Box
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        b : Box;
      END_VAR
        b.GetRef();
      END_PROGRAM
    `);

    expect(result.success).toBe(true);
    expect(
      result.warnings.some((w) => w.message.includes("GETREF ref= ...")),
    ).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "ref_return_guard",
      mainCode: `
#include <iostream>
#include <stdexcept>
int main() {
    strucpp::Program_MAIN prog;
    try {
        prog.run();
    } catch (const std::exception&) {
        std::cout << "FAULT" << std::endl;
    }
    return 0;
}
`,
    });
    expect(stdout).toBe("FAULT");
  });
});
