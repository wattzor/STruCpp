// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS numeric type-promotion / rounding characterization tests.
 *
 * These are approval-style snapshot tests. The expected outputs are the
 * current STruC++ behaviour, not CODESYS doctrine. Test names are tagged
 * `@oracle: assumed`; when a CODESYS oracle is available, update the
 * snapshots to the confirmed values. A drift in the compiler's output will
 * then fail the build and force a deliberate review.
 */

import { describe, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("CODESYS semantics - @oracle: assumed", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-assumed-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function compileAndRun(source: string, testName: string, mainCode: string): string {
    const result = compile(source);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);
    return compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName,
      mainCode,
    });
  }

  it("F1: BYTE * BYTE assigned to WORD @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F1_TEST : WORD
        VAR_INPUT byA : BYTE; byB : BYTE; END_VAR
          F1_TEST := byA * byB;
        END_FUNCTION
      `,
      "f1_byte_mul",
      `#include <iostream>\nint main() { std::cout << strucpp::F1_TEST(strucpp::IEC_BYTE(200), strucpp::IEC_BYTE(2)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });

  it("F2: (BYTE + BYTE) / 2 assigned to WORD @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F2_TEST : WORD
        VAR_INPUT byA : BYTE; byB : BYTE; END_VAR
          F2_TEST := (byA + byB) / 2;
        END_FUNCTION
      `,
      "f2_byte_add_div",
      `#include <iostream>\nint main() { std::cout << strucpp::F2_TEST(strucpp::IEC_BYTE(200), strucpp::IEC_BYTE(100)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });

  it("F3: (WORD * WORD) + WORD assigned to DWORD @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F3_TEST : DWORD
        VAR_INPUT wA : WORD; wB : WORD; wC : WORD; END_VAR
          F3_TEST := (wA * wB) + wC;
        END_FUNCTION
      `,
      "f3_word_mul_add",
      `#include <iostream>\nint main() { std::cout << strucpp::F3_TEST(strucpp::IEC_WORD(300), strucpp::IEC_WORD(300), strucpp::IEC_WORD(100)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });

  it("F4: BYTE + WORD crossing 65535 assigned to DWORD @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F4_TEST : DWORD
        VAR_INPUT byA : BYTE; wB : WORD; END_VAR
          F4_TEST := byA + wB;
        END_FUNCTION
      `,
      "f4_byte_word_add",
      `#include <iostream>\nint main() { std::cout << strucpp::F4_TEST(strucpp::IEC_BYTE(100), strucpp::IEC_WORD(65500)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });

  it("F5: INT + UINT assigned to DINT @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F5_TEST : DINT
        VAR_INPUT iA : INT; uiB : UINT; END_VAR
          F5_TEST := iA + uiB;
        END_FUNCTION
      `,
      "f5_int_uint_add",
      `#include <iostream>\nint main() { std::cout << strucpp::F5_TEST(strucpp::IEC_INT(30000), strucpp::IEC_UINT(40000)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });

  it("F8: TO_INT rounding for 1.5, 2.5, -1.5 @oracle: assumed", () => {
    const stdout = compileAndRun(
      `
        FUNCTION F8_TEST : DINT
        VAR_INPUT r : REAL; END_VAR
          F8_TEST := TO_INT(r);
        END_FUNCTION
      `,
      "f8_to_int_round",
      `#include <iostream>\nint main() { std::cout << strucpp::F8_TEST(strucpp::IEC_REAL(1.5)).get() << "," << strucpp::F8_TEST(strucpp::IEC_REAL(2.5)).get() << "," << strucpp::F8_TEST(strucpp::IEC_REAL(-1.5)).get() << std::endl; return 0; }\n`,
    );
    expect(stdout).toMatchSnapshot();
  });
});
