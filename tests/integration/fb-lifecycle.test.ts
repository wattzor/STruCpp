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

  it("calls FB_Init for every element in an array of FB instances", () => {
    const result = compile(`
      FUNCTION_BLOCK Counter
      VAR_EXTERNAL
        gInit : INT;
      END_VAR
      VAR
        count : INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        gInit := gInit + 1;
        count := 42;
        FB_Init := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        gInit : INT;
      END_VAR
      VAR
        arr : ARRAY[1..3] OF Counter;
        result : INT;
      END_VAR
        result := gInit;
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        gInit : INT;
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
      testName: "fb_init_array",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::GINIT);
    prog.run();
    std::cout << static_cast<int>(prog.RESULT) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("3");
  });

  it("calls FB_Init and FB_Exit on nested function blocks", () => {
    const result = compile(`
      FUNCTION_BLOCK Inner
      VAR_EXTERNAL
        gInit : INT;
        gExit : INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        gInit := gInit + 10;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        gExit := gExit + 10;
        FB_Exit := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer
      VAR
        inner : Inner;
      END_VAR
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        gInit : INT;
        gExit : INT;
      END_VAR
      VAR
        o : Outer;
        afterInit : INT;
      END_VAR
        afterInit := gInit;
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        gInit : INT;
        gExit : INT;
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
      testName: "fb_init_nested",
      mainCode: `
#include <iostream>
int main() {
    {
        strucpp::Program_MAIN prog(&strucpp::GINIT, &strucpp::GEXIT);
        prog.run();
        std::cout << static_cast<int>(strucpp::GINIT.read()) << "," << static_cast<int>(prog.AFTERINIT) << std::endl;
    }
    std::cout << static_cast<int>(strucpp::GEXIT.read()) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("10,10\n10");
  });

  it("applies user initial values after FB_Init", () => {
    const result = compile(`
      FUNCTION_BLOCK FB
      VAR
        x : INT := 5;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        x := 100;
        FB_Init := TRUE;
      END_METHOD

      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        fb : FB;
        y : INT;
      END_VAR
        y := fb.x;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "fb_init_user_init_after",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<int>(prog.Y.get()) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("5");
  });

  it("initializes and destroys nested FBs in CODESYS order", () => {
    const result = compile(`
      FUNCTION_BLOCK Inner
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..3] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 1;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 2;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..3] OF INT;
      END_VAR
      VAR
        in : Inner;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 3;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 4;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..3] OF INT;
      END_VAR
      VAR
        p : POINTER TO Outer;
      END_VAR
        p := __NEW(Outer);
        __DELETE(p);
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        pos : INT;
        hist : ARRAY[0..3] OF INT;
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
      testName: "fb_nested_lifecycle_order",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::POS, &strucpp::HIST);
    prog.run();
    strucpp::HIST.with_lock([](auto* arr) {
        for (int i = 0; i < 4; i++) {
            std::cout << static_cast<int>((*arr)[i].get());
            if (i < 3) std::cout << " ";
        }
    });
    std::cout << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("3 1 2 4");
  });

  it("orders FB_Init and FB_Exit through inheritance and nesting", () => {
    const result = compile(`
      FUNCTION_BLOCK Base
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 1;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 2;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Derived EXTENDS Base
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 3;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 4;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Outer
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR
      VAR
        d : Derived;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 5;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 6;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR
      VAR
        p : POINTER TO Outer;
      END_VAR
        p := __NEW(Outer);
        __DELETE(p);
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
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
      testName: "fb_inherited_nested_lifecycle",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::POS, &strucpp::HIST);
    prog.run();
    strucpp::HIST.with_lock([](auto* arr) {
        for (int i = 0; i < 6; i++) {
            std::cout << static_cast<int>((*arr)[i].get());
            if (i < 5) std::cout << " ";
        }
    });
    std::cout << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("5 1 3 4 2 6");
  });

  it("does not run base FB_Init twice for a top-level inherited FB", () => {
    const result = compile(`
      FUNCTION_BLOCK Base
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 1;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 2;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Derived EXTENDS Base
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 3;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 4;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR
      VAR
        p : POINTER TO Derived;
      END_VAR
        p := __NEW(Derived);
        __DELETE(p);
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
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
      testName: "fb_top_level_inherited_lifecycle",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::POS, &strucpp::HIST);
    prog.run();
    strucpp::HIST.with_lock([](auto* arr) {
        for (int i = 0; i < 4; i++) {
            std::cout << static_cast<int>((*arr)[i].get());
            if (i < 3) std::cout << " ";
        }
    });
    std::cout << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1 3 4 2");
  });

  it("calls base FB_Exit for a subclass that defines no teardown of its own", () => {
    const result = compile(`
      FUNCTION_BLOCK Base
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR

      METHOD FB_Init : BOOL
      VAR_INPUT
        bInitRetains : BOOL;
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 1;
        pos := pos + 1;
        FB_Init := TRUE;
      END_METHOD

      METHOD FB_Exit : BOOL
      VAR_INPUT
        bInCopyCode : BOOL;
      END_VAR
        hist[pos] := 2;
        pos := pos + 1;
        FB_Exit := TRUE;
      END_METHOD
      END_FUNCTION_BLOCK

      FUNCTION_BLOCK Derived EXTENDS Base
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR_EXTERNAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
      END_VAR
      VAR
        p : POINTER TO Derived;
      END_VAR
        p := __NEW(Derived);
        __DELETE(p);
      END_PROGRAM

      CONFIGURATION MyConfig
      VAR_GLOBAL
        pos : INT;
        hist : ARRAY[0..9] OF INT;
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
      testName: "fb_derived_no_exit_calls_base",
      mainCode: `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog(&strucpp::POS, &strucpp::HIST);
    prog.run();
    strucpp::HIST.with_lock([](auto* arr) {
        for (int i = 0; i < 2; i++) {
            std::cout << static_cast<int>((*arr)[i].get());
            if (i < 1) std::cout << " ";
        }
    });
    std::cout << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("1 2");
  });
});
