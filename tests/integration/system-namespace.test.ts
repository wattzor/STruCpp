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

  it("compiles arrays of __SYSTEM.TYPE_CLASS", () => {
    const sourceST = `
PROGRAM SystemNamespaceArrayTest
  VAR
    arr : ARRAY[1..3] OF __SYSTEM.TYPE_CLASS;
  END_VAR
  arr[1] := __SYSTEM.TYPE_CLASS.TYPE_BOOL;
  arr[2] := __SYSTEM.TYPE_CLASS.TYPE_INT;
  arr[3] := __SYSTEM.TYPE_CLASS.TYPE_REAL;
END_PROGRAM
`;

    const testST = `
TEST '__SYSTEM array of enum'
  VAR uut : SystemNamespaceArrayTest; END_VAR
  uut();
  ASSERT_EQ(uut.arr[1], __SYSTEM.TYPE_CLASS.TYPE_BOOL);
  ASSERT_EQ(uut.arr[2], __SYSTEM.TYPE_CLASS.TYPE_INT);
  ASSERT_EQ(uut.arr[3], __SYSTEM.TYPE_CLASS.TYPE_REAL);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_system_namespace_array.st",
      tempDirPrefix: "strucpp-system-array-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
