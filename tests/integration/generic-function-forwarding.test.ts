// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * Generic FUNCTION forwarding regression tests.
 *
 * User-defined FUNCTIONs with ANY/ANY_* parameter and return types must be
 * able to call standard functions (LIMIT, ADD, etc.) and produce concrete C++
 * that compiles and runs with the caller's actual argument types.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import { compile } from "../../src/index.js";
import {
  hasGpp,
  createPCH,
  compileAndRunStandalone,
  RUNTIME_INCLUDE_PATH,
} from "./test-helpers.js";

describe.skipIf(!hasGpp)("generic FUNCTION forwarding", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-generic-fwd-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  it("forwards ANY_NUM parameters to LIMIT", () => {
    const result = compile(`
      FUNCTION MaxAny : ANY_NUM
      VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
        MaxAny := LIMIT(mn, val, mx);
      END_FUNCTION

      PROGRAM Main
      VAR
        i : INT;
        r : REAL;
      END_VAR
        i := MaxAny(INT#1, INT#2, INT#3);
        r := MaxAny(REAL#1.0, REAL#5.0, REAL#10.0);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << prog.I.get() << '\\n'
              << prog.R.get() << std::endl;
    return 0;
}
`;
    const expected = ["2", "5"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "generic_limit",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("forwards ANY_NUM parameters to ADD", () => {
    const result = compile(`
      FUNCTION AddAny : ANY_NUM
      VAR_INPUT a, b : ANY_NUM; END_VAR
        AddAny := ADD(a, b);
      END_FUNCTION

      PROGRAM Main
      VAR
        i : INT;
        r : REAL;
      END_VAR
        i := AddAny(INT#10, INT#20);
        r := AddAny(REAL#1.5, REAL#2.5);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const mainCode = `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << prog.I.get() << '\\n'
              << prog.R.get() << std::endl;
    return 0;
}
`;
    const expected = ["30", "4"].join("\n");

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "generic_add",
      mainCode,
    });
    expect(stdout).toBe(expected);
  });

  it("forwards ANY_NUM parameters to LIMIT across separate translation units", () => {
    const result = compile(`
      FUNCTION MaxAny : ANY_NUM
      VAR_INPUT mn, val, mx : ANY_NUM; END_VAR
        MaxAny := LIMIT(mn, val, mx);
      END_FUNCTION

      PROGRAM Main
      VAR
        i : INT;
        r : REAL;
      END_VAR
        i := MaxAny(INT#1, INT#2, INT#3);
        r := MaxAny(REAL#1.0, REAL#5.0, REAL#10.0);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const testName = "generic_limit_multifile";
    const outDir = path.join(tempDir, testName);
    fs.mkdirSync(outDir, { recursive: true });

    fs.writeFileSync(
      path.join(outDir, "generated.hpp"),
      result.headerCode!,
    );

    const objects: string[] = [];
    for (const cpp of result.cppFiles!) {
      const cppPath = path.join(outDir, cpp.name);
      fs.writeFileSync(cppPath, cpp.content);
      const objPath = cppPath.replace(/\.cpp$/, ".o");
      const compileCmd = [
        "g++",
        "-std=c++17",
        `-include "${pchPath}"`,
        `-I"${RUNTIME_INCLUDE_PATH}"`,
        `-I"${tempDir}"`,
        `-I"${outDir}"`,
        `-c "${cppPath}"`,
        `-o "${objPath}"`,
      ].join(" ");
      execSync(compileCmd, { encoding: "utf-8", env: process.env });
      objects.push(objPath);
    }

    const mainCode = `
#include "generated.hpp"
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << prog.I.get() << '\\n'
              << prog.R.get() << std::endl;
    return 0;
}
`;
    const mainPath = path.join(outDir, "main.cpp");
    fs.writeFileSync(mainPath, mainCode);
    const mainObj = path.join(outDir, "main.o");
    const mainCmd = [
      "g++",
      "-std=c++17",
      `-include "${pchPath}"`,
      `-I"${RUNTIME_INCLUDE_PATH}"`,
      `-I"${tempDir}"`,
      `-I"${outDir}"`,
      `-c "${mainPath}"`,
      `-o "${mainObj}"`,
    ].join(" ");
    execSync(mainCmd, { encoding: "utf-8", env: process.env });
    objects.push(mainObj);

    const binPath = path.join(outDir, testName);
    const linkCmd = [
      "g++",
      ...objects.map((o) => `"${o}"`),
      `-o "${binPath}"`,
    ].join(" ");
    execSync(linkCmd, { encoding: "utf-8", env: process.env });

    const stdout = execSync(`"${binPath}"`, {
      encoding: "utf-8",
      env: process.env,
    }).trim();

    expect(stdout).toBe(["2", "5"].join("\n"));
  });
});
