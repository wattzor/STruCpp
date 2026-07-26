// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * __QUERYINTERFACE failure and null interface pointer behaviour.
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

describe.skipIf(!hasGpp)("__QUERYINTERFACE null and failure cases", () => {
  let tempDir: string;
  let pchPath: string;
  beforeAll(() => {
    tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "strucpp-interface-null-"),
    );
    pchPath = createPCH(tempDir);
  });
  afterAll(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const buildAndRun = (name: string, sourceST: string, mainCode: string) => {
    const result = compile(sourceST);
    expect(result.success).toBe(true);
    return compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: name,
      mainCode,
    });
  };

  it("sets the target to null and returns FALSE on a failed query", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      INTERFACE IOther
        METHOD Other : INT
        END_METHOD
      END_INTERFACE

      FUNCTION_BLOCK FB IMPLEMENTS IBase
        METHOD PUBLIC GetValue : INT
          GetValue := 42;
        END_METHOD
      END_FUNCTION_BLOCK

      PROGRAM Main
      VAR
        fb : FB;
        other : IOther;
        ok : BOOL;
      END_VAR
        ok := __QUERYINTERFACE(fb, other);
      END_PROGRAM
    `;

    const stdout = buildAndRun(
      "query_fail_null",
      sourceST,
      `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.OK ? "TRUE" : "FALSE") << "," << (prog.OTHER == nullptr ? "NULL" : "NONNULL") << std::endl;
    return 0;
}
`,
    );
    expect(stdout).toBe("FALSE,NULL");
  });

  it("returns FALSE when the source interface pointer itself is null", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      PROGRAM Main
      VAR
        src : IBase;
        tgt : IBase;
        ok : BOOL;
      END_VAR
        ok := __QUERYINTERFACE(src, tgt);
      END_PROGRAM
    `;

    const stdout = buildAndRun(
      "query_null_src",
      sourceST,
      `
#include <iostream>
int main() {
    strucpp::Program_MAIN prog;
    prog.run();
    std::cout << (prog.OK ? "TRUE" : "FALSE") << "," << (prog.TGT == nullptr ? "NULL" : "NONNULL") << std::endl;
    return 0;
}
`,
    );
    expect(stdout).toBe("FALSE,NULL");
  });

  it("raises a defined fault when calling a method on a null interface pointer", () => {
    const sourceST = `
      INTERFACE IBase
        METHOD GetValue : INT
        END_METHOD
      END_INTERFACE

      PROGRAM Main
      VAR
        itf : IBase;
        value : INT;
      END_VAR
        value := itf.GetValue();
      END_PROGRAM
    `;

    const stdout = buildAndRun(
      "null_itf_method",
      sourceST,
      `
#include <iostream>
#include <stdexcept>
int main() {
    strucpp::Program_MAIN prog;
    try {
        prog.run();
    } catch (const std::exception&) {
        std::cout << "FAULT" << std::endl;
        return 0;
    }
    std::cout << "NOFAULT" << std::endl;
    return 0;
}
`,
    );
    expect(stdout).toBe("FAULT");
  });
});
