// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS method chaining via REFERENCE TO return.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("method chaining", () => {
  it("chains methods that return a REFERENCE TO the function block", () => {
    const sourceST = `
      FUNCTION_BLOCK StringBuilder
      VAR
        buffer : STRING(255);
      END_VAR
        METHOD PUBLIC Append : REFERENCE TO StringBuilder
        VAR_INPUT
          s : STRING(20);
        END_VAR
          buffer := CONCAT(buffer, s);
          Append ref= THIS^;
        END_METHOD

        METHOD PUBLIC GetValue : STRING(255)
          GetValue := buffer;
        END_METHOD
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Method chaining via REFERENCE TO'
      VAR
        sb : StringBuilder;
        result : STRING(255);
      END_VAR
      sb.Append('Hello').Append(' ').Append('World');
      result := sb.GetValue();
      ASSERT_EQ(result, 'Hello World');
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "method_chaining_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
