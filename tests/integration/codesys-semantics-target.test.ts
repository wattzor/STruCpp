// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS arithmetic semantics that are explicitly target-width dependent.
 *
 * The CODESYS Operators reference states that temporary results are computed
 * with the native width of the target device: at least 32-bit on x86/ARM and
 * 64-bit on x64. This file captures the same expressions under both widths so
 * the snapshots are an explicit record of the target-dependence.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

// Run the same three expressions under both 32-bit and 64-bit target widths.
// Each width gets its own PCH so the generated C++ runtime sees the matching
// STRUCPP_TARGET_WIDTH macro.
for (const width of ["32", "64"]) {
  describe.skipIf(!hasGpp)(`CODESYS semantics at target width ${width} bit`, () => {
    let tempDir: string;
    let pchPath: string;

    beforeAll(() => {
      process.env.STRUCPP_TARGET_WIDTH = width;
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-codesys-target-"));
      pchPath = createPCH(tempDir);
    });

    afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    it("DINT overflow temporary depends on target width @oracle: codesys-doc", () => {
      const result = compile(`
        PROGRAM Main
        VAR
          r : LINT;
        END_VAR
          r := DINT#2147483647 + DINT#1;
        END_PROGRAM
      `);
      expect(result.success).toBe(true);

      const stdout = compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: result.headerCode!,
        cppCode: result.cppCode!,
        testName: "dint_overflow",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<long long>(prog.R) << std::endl;
    return 0;
}
`,
      });
      expect(stdout).toMatchSnapshot();
    });

    it("UDINT overflow temporary depends on target width @oracle: codesys-doc", () => {
      const result = compile(`
        PROGRAM Main
        VAR
          r : ULINT;
        END_VAR
          r := UDINT#100000 * UDINT#100000;
        END_PROGRAM
      `);
      expect(result.success).toBe(true);

      const stdout = compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: result.headerCode!,
        cppCode: result.cppCode!,
        testName: "udint_overflow",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned long long>(prog.R) << std::endl;
    return 0;
}
`,
      });
      expect(stdout).toMatchSnapshot();
    });

    it("DINT overflow temporary sign test depends on target width @oracle: codesys-doc", () => {
      const result = compile(`
        PROGRAM Main
        VAR
          r : BOOL;
        END_VAR
          r := (DINT#2147483647 + DINT#1) < DINT#0;
        END_PROGRAM
      `);
      expect(result.success).toBe(true);

      const stdout = compileAndRunStandalone({
        tempDir,
        pchPath,
        headerCode: result.headerCode!,
        cppCode: result.cppCode!,
        testName: "dint_sign",
        mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.R) << std::endl;
    return 0;
}
`,
      });
      expect(stdout).toMatchSnapshot();
    });
  });
}
