/**
 * CODESYS __SYSTEM namespace integration tests.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("__SYSTEM namespace", () => {
  it("compiles and runs __SYSTEM.TYPE_CLASS and __SYSTEM.MEMORY_AREA enum values", () => {
    const sourceST = `
PROGRAM SystemNamespaceTest
  VAR
    typeClassValue : __SYSTEM.TYPE_CLASS;
    memoryAreaValue : __SYSTEM.MEMORY_AREA;
  END_VAR
  typeClassValue := __SYSTEM.TYPE_CLASS.TYPE_BOOL;
  memoryAreaValue := __SYSTEM.MEMORY_AREA.MEM_INPUT;
END_PROGRAM
`;

    const testST = `
TEST '__SYSTEM enum values'
  VAR uut : SystemNamespaceTest; END_VAR
  uut();
  ASSERT_EQ(uut.typeClassValue, __SYSTEM.TYPE_CLASS.TYPE_BOOL);
  ASSERT_EQ(uut.memoryAreaValue, __SYSTEM.MEMORY_AREA.MEM_INPUT);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_system_namespace.st",
      tempDirPrefix: "strucpp-system-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
