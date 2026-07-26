// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for the CODESYS __ISVALIDREF operator.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("__ISVALIDREF operator", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-isvalidref-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("returns TRUE for bound REF_TO / REFERENCE_TO and FALSE for NULL", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        i : INT := 5;
        r_ref : REF_TO INT;
        r_ref2 : REFERENCE_TO INT;
        b1, b2, b3 : BOOL;
      END_VAR
      r_ref := REF(i);
      r_ref2 REF= i;
      b1 := __ISVALIDREF(r_ref);
      b2 := __ISVALIDREF(r_ref2);
      r_ref := NULL;
      b3 := __ISVALIDREF(r_ref);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "isvalidref",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.B1 ? "1" : "0")
              << (prog.B2 ? "1" : "0")
              << (prog.B3 ? "1" : "0") << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("110");
  });
});
