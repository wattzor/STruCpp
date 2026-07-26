/**
 * CODESYS __VARINFO and __SYSTEM.VAR_INFO integration tests.
 */

import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

function compileVarInfoSource(sourceST: string) {
  const result = compile(sourceST, { isTestBuild: true });
  if (!result.success) {
    throw new Error(
      `Source compilation failed: ${result.errors.map((e) => e.message).join(", ")}`,
    );
  }
  return result.cppCode;
}

function compileExpectFailure(sourceST: string): string[] {
  const result = compile(sourceST, { isTestBuild: true });
  if (result.success) {
    throw new Error("Expected compile to fail but it succeeded");
  }
  return result.errors.map((e) => e.message);
}

describe("__VARINFO codegen metadata", () => {
  it("emits the actual type name, not the TYPE_CLASS enum name", () => {
    const cpp = compileVarInfoSource(`
PROGRAM VarInfoTest
  VAR
    iCounter : INT;
    info : __SYSTEM.VAR_INFO;
  END_VAR
  info := __VARINFO(iCounter);
END_PROGRAM
`);
    expect(cpp).toContain('TYPENAME=*/ strucpp::IECString<79>("INT")');
    expect(cpp).not.toContain('TYPENAME=*/ strucpp::IECString<79>("TYPE_INT")');
  });

  it("rejects bare TYPE_CLASS and TYPE_BOOL as unqualified", () => {
    const typeErrors = compileExpectFailure(`
PROGRAM RejectBareTypeClass
  VAR
    x : TYPE_CLASS;
  END_VAR
END_PROGRAM
`);
    expect(typeErrors.some((m) => m.includes("Undefined type"))).toBe(true);

    const valueErrors = compileExpectFailure(`
PROGRAM RejectBareTypeBool
  VAR
    x : INT;
  END_VAR
  x := TYPE_BOOL;
END_PROGRAM
`);
    expect(valueErrors.some((m) => m.includes("Undeclared variable"))).toBe(true);
  });

  it("emits the correct memory area for local and global variables", () => {
    const cpp = compileVarInfoSource(`
CONFIGURATION GlobalCfg
  VAR_GLOBAL
    globalCounter : INT;
  END_VAR
  RESOURCE MainResource ON PLC
    TASK MainTask(INTERVAL := T#10ms);
    PROGRAM MainInstance WITH MainTask : Main;
  END_RESOURCE
END_CONFIGURATION

PROGRAM Main
  VAR_EXTERNAL
    globalCounter : INT;
  END_VAR
  VAR
    localInfo : __SYSTEM.VAR_INFO;
    globalInfo : __SYSTEM.VAR_INFO;
  END_VAR
  localInfo := __VARINFO(localInfo);
  globalInfo := __VARINFO(globalCounter);
END_PROGRAM
`);
    expect(cpp).toContain("MEMORYAREA=*/ IEC_MEMORY_AREA(strucpp::__SYSTEM::MEMORY_AREA::MEM_LOCAL)");
    expect(cpp).toContain("MEMORYAREA=*/ IEC_MEMORY_AREA(strucpp::__SYSTEM::MEMORY_AREA::MEM_GLOBAL)");
  });

  it("emits array element metadata", () => {
    const cpp = compileVarInfoSource(`
PROGRAM VarInfoArrayTest
  VAR
    arrA : ARRAY [1..2, 1..2, 1..2] OF INT;
    info : __SYSTEM.VAR_INFO;
  END_VAR
  info := __VARINFO(arrA);
END_PROGRAM
`);
    expect(cpp).toContain('TYPENAME=*/ strucpp::IECString<79>("ARRAY")');
    expect(cpp).toContain("NUMELEMENTS=*/ IEC_UDINT(8u)");
    expect(cpp).toContain("BASETYPECLASS=*/ IEC_TYPE_CLASS(strucpp::__SYSTEM::TYPE_CLASS::TYPE_INT)");
    expect(cpp).toContain("ELEMBITSIZE=*/ IEC_UDINT(16u)");
  });

  it("reuses the same descriptor for two __VARINFO calls on the same variable", () => {
    const cpp = compileVarInfoSource(`
PROGRAM VarInfoStableTest
  VAR
    iCounter : INT;
    info1 : __SYSTEM.VAR_INFO;
    info2 : __SYSTEM.VAR_INFO;
  END_VAR
  info1 := __VARINFO(iCounter);
  info2 := __VARINFO(iCounter);
END_PROGRAM
`);
    const matches = cpp.match(/__strucpp_varinfo_\d+/g);
    expect(new Set(matches).size).toBe(1);
  });
});

describe.skipIf(!hasGpp)("__VARINFO runtime", () => {
  it("returns a VAR_INFO descriptor with type class, name and size", () => {
    const sourceST = `
PROGRAM VarInfoTest
  VAR
    iCounter : INT; (* Counts the calls *)
    info : __SYSTEM.VAR_INFO;
  END_VAR
  info := __VARINFO(iCounter);
END_PROGRAM
`;

    const testST = `
TEST '__VARINFO INT'
  VAR uut : VarInfoTest; END_VAR
  uut();
  ASSERT_EQ(uut.info.TypeClass, __SYSTEM.TYPE_CLASS.TYPE_INT);
  ASSERT_EQ(uut.info.TypeName, 'INT');
  ASSERT_EQ(uut.info.BitSize, 16);
  ASSERT_EQ(uut.info.NumElements, 0);
  ASSERT_EQ(uut.info.MemoryArea, __SYSTEM.MEMORY_AREA.MEM_LOCAL);
  ASSERT_EQ(uut.info.Symbol, 'ICOUNTER');
  ASSERT_EQ(uut.info.Comment, 'Counts the calls');
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_var_info_int.st",
      tempDirPrefix: "strucpp-varinfo-int-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("reports the correct metadata for BOOL variables", () => {
    const sourceST = `
PROGRAM VarInfoBoolTest
  VAR
    bFlag : BOOL; (* enable flag *)
    info : __SYSTEM.VAR_INFO;
  END_VAR
  info := __VARINFO(bFlag);
END_PROGRAM
`;

    const testST = `
TEST '__VARINFO BOOL'
  VAR uut : VarInfoBoolTest; END_VAR
  uut();
  ASSERT_EQ(uut.info.TypeClass, __SYSTEM.TYPE_CLASS.TYPE_BOOL);
  ASSERT_EQ(uut.info.TypeName, 'BOOL');
  ASSERT_EQ(uut.info.BitSize, 1);
  ASSERT_EQ(uut.info.MemoryArea, __SYSTEM.MEMORY_AREA.MEM_LOCAL);
  ASSERT_EQ(uut.info.Symbol, 'BFLAG');
  ASSERT_EQ(uut.info.Comment, 'enable flag');
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_var_info_bool.st",
      tempDirPrefix: "strucpp-varinfo-bool-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("reports array type name, element count and base type class", () => {
    const sourceST = `
PROGRAM VarInfoArrayTest
  VAR
    arrA : ARRAY [1..2, 1..2, 1..2] OF INT; (* Stores the A data *)
    info : __SYSTEM.VAR_INFO;
  END_VAR
  info := __VARINFO(arrA);
END_PROGRAM
`;

    const testST = `
TEST '__VARINFO ARRAY'
  VAR uut : VarInfoArrayTest; END_VAR
  uut();
  ASSERT_EQ(uut.info.TypeClass, __SYSTEM.TYPE_CLASS.TYPE_ARRAY);
  ASSERT_EQ(uut.info.TypeName, 'ARRAY');
  ASSERT_EQ(uut.info.BitSize, 128);
  ASSERT_EQ(uut.info.NumElements, 8);
  ASSERT_EQ(uut.info.BaseTypeClass, __SYSTEM.TYPE_CLASS.TYPE_INT);
  ASSERT_EQ(uut.info.ElemBitSize, 16);
  ASSERT_EQ(uut.info.MemoryArea, __SYSTEM.MEMORY_AREA.MEM_LOCAL);
  ASSERT_EQ(uut.info.Symbol, 'ARRA');
  ASSERT_EQ(uut.info.Comment, 'Stores the A data');
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_var_info_array.st",
      tempDirPrefix: "strucpp-varinfo-array-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
