// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * F1–F5 and F8: assumed CODESYS semantics.
 *
 * These tests exercise language features where a naive ST→C++ mapping is
 * likely to silently diverge from CODESYS. The expected values below are
 * NOT confirmed by a real CODESYS run; they are best-guess IEC/CODESYS
 * assumptions. Each test is wrapped in `it.fails` and prints the actual
 * STruC++ result, then throws "CONFIRM_WITH_CODESYS".
 *
 * Once a CODESYS oracle is available, replace the `throw` with an actual
 * `expect(...).toBe(...)` and remove `.fails`.
 */

import { describe, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { compile } from "../../src/index.js";
import { hasGpp, createPCH, compileAndRunStandalone } from "./test-helpers.js";

describe.skipIf(!hasGpp)("CODESYS semantics — assumed (needs oracle)", () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "strucpp-assumed-"));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it.fails("F1: BYTE * BYTE assigned to WORD wraps to 144 for 200*2", () => {
    const result = compile(`
      FUNCTION F1_TEST : WORD
      VAR_INPUT byA : BYTE; byB : BYTE; END_VAR
        F1_TEST := byA * byB;
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f1_byte_mul",
      mainCode: `#include <iostream>\nint main() { std::cout << strucpp::F1_TEST(strucpp::IEC_BYTE(200), strucpp::IEC_BYTE(2)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F1 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });

  it.fails("F2: BYTE + BYTE and BYTE - BYTE keep BYTE width", () => {
    const result = compile(`
      FUNCTION F2_TEST : BYTE
      VAR_INPUT byA : BYTE; byB : BYTE; END_VAR
        F2_TEST := (byA + byB) - 50;
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f2_byte_add_sub",
      mainCode: `#include <iostream>\nint main() { std::cout << +strucpp::F2_TEST(strucpp::IEC_BYTE(200), strucpp::IEC_BYTE(50)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F2 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });

  it.fails("F3: WORD intermediate in (a*b)+c does not widen", () => {
    const result = compile(`
      FUNCTION F3_TEST : WORD
      VAR_INPUT wA : WORD; wB : WORD; wC : WORD; END_VAR
        F3_TEST := (wA * wB) + wC;
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f3_word_intermediate",
      mainCode: `#include <iostream>\nint main() { std::cout << strucpp::F3_TEST(strucpp::IEC_WORD(300), strucpp::IEC_WORD(200), strucpp::IEC_WORD(100)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F3 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });

  it.fails("F4: BYTE + WORD result type per CODESYS", () => {
    const result = compile(`
      FUNCTION F4_TEST : WORD
      VAR_INPUT byA : BYTE; wB : WORD; END_VAR
        F4_TEST := byA + wB;
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f4_byte_word",
      mainCode: `#include <iostream>\nint main() { std::cout << strucpp::F4_TEST(strucpp::IEC_BYTE(200), strucpp::IEC_WORD(1000)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F4 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });

  it.fails("F5: INT + UINT result type per CODESYS", () => {
    const result = compile(`
      FUNCTION F5_TEST : DINT
      VAR_INPUT iA : INT; uiB : UINT; END_VAR
        F5_TEST := iA + uiB;
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f5_int_uint",
      mainCode: `#include <iostream>\nint main() { std::cout << strucpp::F5_TEST(strucpp::IEC_INT(-1), strucpp::IEC_UINT(1)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F5 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });

  it.fails("F8: TO_INT(1.5), TO_INT(2.5), TO_INT(-1.5) rounding", () => {
    const result = compile(`
      FUNCTION F8_TEST : DINT
      VAR_INPUT r : REAL; END_VAR
        F8_TEST := TO_INT(r);
      END_FUNCTION
    `);
    if (!result.success) throw new Error(`compile failed: ${result.errors.map((e) => e.message).join("\n")}`);

    const stdout = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode!,
      cppCode: result.cppCode!,
      testName: "f8_to_int_round",
      mainCode: `#include <iostream>\nint main() { std::cout << strucpp::F8_TEST(strucpp::IEC_REAL(1.5)).get() << "," << strucpp::F8_TEST(strucpp::IEC_REAL(2.5)).get() << "," << strucpp::F8_TEST(strucpp::IEC_REAL(-1.5)).get() << std::endl; return 0; }\n`,
    });
    console.log(`F8 actual result: ${stdout}`);
    throw new Error("CONFIRM_WITH_CODESYS");
  });
});
