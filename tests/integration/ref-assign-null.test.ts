// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * REF= 0 and REF= NULL should unbind a REF_TO / REFERENCE_TO variable.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("REF= NULL rebinding", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-ref-null-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("REF_TO can be unbound with REF= 0", () => {
    const result = compile(`
      PROGRAM Main
      VAR
        i : INT := 5;
        r : REF_TO INT;
        b1, b2 : BOOL;
      END_VAR
      r := REF(i);
      b1 := __ISVALIDREF(r);
      r REF= 0;
      b2 := __ISVALIDREF(r);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "ref_null",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.B1 ? "1" : "0")
              << (prog.B2 ? "1" : "0") << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("10");
  });
});
