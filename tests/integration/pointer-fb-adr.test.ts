// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for POINTER TO FB assigned via ADR() and dereferenced for method/field access.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("POINTER TO FB via ADR", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-ptr-adr-"));
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("calls a method and reads a field through a POINTER TO assigned with ADR", () => {
    const result = compile(`
      FUNCTION_BLOCK Motor
      VAR
        running : BOOL;
      END_VAR
      METHOD Start
        running := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        m : Motor;
        p : POINTER TO Motor;
        out : BOOL;
      END_VAR
      p := ADR(m);
      p^.Start();
      out := p^.running;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "pointer_adr_fb",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.OUT ? "TRUE" : "FALSE") << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("TRUE");
  });
});
