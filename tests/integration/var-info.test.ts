/**
 * CODESYS __VARINFO and __SYSTEM.VAR_INFO integration tests.
 */

import { describe, it, expect } from "vitest";
import { hasGpp, runE2ETestPipeline } from "./test-helpers.js";

describe.skipIf(!hasGpp)("__VARINFO", () => {
  it("returns a VAR_INFO descriptor with the correct type class and bit size", () => {
    const sourceST = `
PROGRAM VarInfoTest
  VAR
    iCounter : INT;
    bFlag : BOOL;
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
  ASSERT_EQ(uut.info.BitSize, 16);
  ASSERT_EQ(uut.info.TypeName, 'TYPE_INT');
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_var_info_int.st",
      tempDirPrefix: "strucpp-varinfo-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });

  it("reports the correct TYPE_CLASS for BOOL variables", () => {
    const sourceST = `
PROGRAM VarInfoBoolTest
  VAR
    bFlag : BOOL;
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
  ASSERT_EQ(uut.info.BitSize, 1);
  ASSERT_EQ(uut.info.TypeName, 'TYPE_BOOL');
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
});
