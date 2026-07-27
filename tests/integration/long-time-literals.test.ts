import { describe, it, expect } from "vitest";
import { runE2ETestPipeline } from "./test-helpers.js";

describe("IEC 61131-3 v3 long time/date literals", () => {
  it("lowers LTIME, LDATE, LTOD and LDT literals to 64-bit values", () => {
    const sourceST = `
PROGRAM LongTimeTest
  VAR
    t   : LTIME;
    d   : LDATE;
    tod : LTOD;
    ldt : LDT;
    ok  : BOOL;
  END_VAR
  t   := LTIME#1s;
  d   := LDATE#2024-01-15;
  tod := LTOD#12:30:00;
  ldt := LDT#2024-01-15-12:30:00;
  ok  := (t = LTIME#1000ms) AND
         (d = LDATE#2024-01-15) AND
         (tod = LTOD#12:30:00) AND
         (ldt = LDT#2024-01-15-12:30:00);
END_PROGRAM
`;

    const testST = `
TEST 'long time/date literals'
  VAR uut : LongTimeTest; END_VAR
  uut();
  ASSERT_TRUE(uut.ok);
END_TEST
`;

    const { stdout, exitCode } = runE2ETestPipeline({
      sourceST,
      testST,
      testFileName: "test_long_time.st",
      tempDirPrefix: "strucpp-long-time-",
      isTestBuild: true,
    });

    expect(exitCode).toBe(0);
    expect(stdout).not.toContain("[FAIL]");
  });
});
