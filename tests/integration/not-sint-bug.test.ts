import { describe, expect, it, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import {
  hasGpp,
  createPCH,
  compileWithGpp as compileWithGppHelper,
} from "./test-helpers.js";

describe("NOT(SINT) semantic guard", () => {
  it("rejects NOT on a signed integer type at compile time", () => {
    const result = compile(`PROGRAM main
VAR
    x : SINT := 0;
    y : SINT;
END_VAR
y := NOT(x);
END_PROGRAM`);
    // CODESYS permits NOT only on BOOL, BYTE, WORD, DWORD, and LWORD.
    // SINT is not ANY_BIT and would be miscompiled to logical !.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toMatch(/NOT/);
  });
});

const describeIfGpp = hasGpp ? describe : describe.skip;

describeIfGpp("NOT boolean expression codegen", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-not-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function compileWithGpp(
    headerCode: string,
    cppCode: string,
    testName: string,
  ): { success: boolean; error?: string } {
    return compileWithGppHelper({ tempDir, pchPath, headerCode, cppCode, testName });
  }

  it("compiles NOT on a boolean expression built from comparisons", () => {
    const result = compile(`PROGRAM PLC_PRG
VAR
    a : DINT;
    b : DINT;
    r : DINT;
END_VAR
    r := TO_DINT(NOT( (a = 0) OR (b = 0) ));
END_PROGRAM`);
    expect(result.success).toBe(true);
    const cppResult = compileWithGpp(
      result.headerCode,
      result.cppCode,
      "not_bool_expr",
    );
    expect(cppResult.success).toBe(true);
  });
});
