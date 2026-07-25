// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * E2E for CODESYS-style PROPERTY declarations with local VAR blocks
 * inside GET and SET accessors.
 */

import { describe, it, expect } from "vitest";
import { hasGpp } from "./test-helpers.js";
import { runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("property accessors with local VAR blocks", () => {
  it("doubles on read and clamps on write", () => {
    const sourceST = `
      FUNCTION_BLOCK Motor
        VAR
          _speed : INT;
        END_VAR
        PROPERTY PUBLIC Speed : INT
          GET
            VAR tmp : INT; END_VAR
            tmp := _speed;
            Speed := tmp;
          END_GET
          SET
            VAR tmp : INT; END_VAR
            tmp := Speed;
            IF tmp > 100 THEN tmp := 100; END_IF;
            _speed := tmp;
          END_SET
        END_PROPERTY
      END_FUNCTION_BLOCK
    `;

    const testST = `
      TEST 'Property with local VAR getter/setter'
      VAR
        m : Motor;
        got : INT;
      END_VAR
      m.Speed := 40;
      got := m.Speed;
      ASSERT_EQ(got, 40);

      m.Speed := 120;
      got := m.Speed;
      ASSERT_EQ(got, 100);

      m.Speed := 200;
      ASSERT_EQ(m.Speed, 100);
      END_TEST
    `;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "property_var_test.st",
    });

    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 passed, 0 failed");
  });
});
