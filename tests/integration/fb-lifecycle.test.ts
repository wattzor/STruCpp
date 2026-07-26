// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS FB_Init / FB_Exit lifecycle methods.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("FB lifecycle methods", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-fb-lifecycle-"));
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("calls FB_Init on instance creation", () => {
    const result = compile(`
      FUNCTION_BLOCK Counter
      VAR
        count : INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        count := 42;
        FB_Init := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        c : Counter;
        result : INT;
      END_VAR
        result := c.count;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fb_init",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("42");
  });

  it("calls FB_Exit on instance destruction", () => {
    const result = compile(`
      FUNCTION_BLOCK Logger
      VAR_EXTERNAL
        gVal : INT;
      END_VAR

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        gVal := 77;
        FB_Exit := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        gVal : INT;
      END_VAR
      VAR
        p : POINTER TO Logger;
        result : INT;
      END_VAR
        p := __NEW(Logger);
        __DELETE(p);
        result := gVal;
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        gVal : INT;
      END_VAR
      RESOURCE MyResource ON PLC
        TASK MainTask(INTERVAL := T#100ms, PRIORITY := 1);
        PROGRAM MainTask WITH MainTask : Main;
      END_RESOURCE
      END_CONFIGURATION
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fb_exit",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::GVAL);
    prog.run();
    std::cout << static_cast<int>(strucpp::GVAL.read()) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("77");
  });

  it("supports explicit FB_Reinit calls", () => {
    const result = compile(`
      FUNCTION_BLOCK Counter
      VAR
        count : INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        count := 42;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Reinit : BOOL
        count := 100;
        FB_Reinit := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        c : Counter;
        afterInit : INT;
        afterReinit : INT;
      END_VAR
        afterInit := c.count;
        c.FB_Reinit();
        afterReinit := c.count;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fb_reinit",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.AFTERINIT) << "," << static_cast<int>(prog.AFTERREINIT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("42,100");
  });
});
