// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS XSIZEOF semantics (logical IEC byte size as target-width unsigned).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("XSIZEOF operator", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-xsizeof-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("returns logical IEC byte sizes as __XWORD for variables and type names", () => {
    const result = compile(`
      TYPE Point :
      STRUCT
        X : INT;
        Y : INT;
      END_STRUCT
      END_TYPE

      FUNCTION_BLOCK MyFB
      VAR
        a : INT;
        b : BOOL;
        c : DINT;
      END_VAR
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        arr : ARRAY[0..9] OF INT;
        p : Point;
        s : STRING(80);
        fb : MyFB;
        x1 : __XWORD;
        x2 : __XWORD;
        x3 : __XWORD;
        x4 : __XWORD;
        x5 : __XWORD;
        x6 : __XWORD;
        x7 : __XWORD;
      END_VAR
      x1 := XSIZEOF(arr);
      x2 := XSIZEOF(p);
      x3 := XSIZEOF(s);
      x4 := XSIZEOF(INT);
      x5 := XSIZEOF(Point);
      x6 := XSIZEOF(fb);
      x7 := XSIZEOF(MyFB);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "xsizeof",
      mainCode: `
#include <iostream>
#include <cstdint>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << static_cast<unsigned long long>(prog.X1.get()) << ","
              << static_cast<unsigned long long>(prog.X2.get()) << ","
              << static_cast<unsigned long long>(prog.X3.get()) << ","
              << static_cast<unsigned long long>(prog.X4.get()) << ","
              << static_cast<unsigned long long>(prog.X5.get()) << ","
              << static_cast<unsigned long long>(prog.X6.get()) << ","
              << static_cast<unsigned long long>(prog.X7.get()) << std::endl;
    return 0;
}
`,
    });
    expect(stdout).toBe("20,4,81,2,4,7,7");
  });
});
