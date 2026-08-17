import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";

function compileOk(source: string): { cpp: string; header: string } {
  const result = compile(source);
  expect(result.errors.map((e) => e.message)).toEqual([]);
  expect(result.success).toBe(true);
  return { cpp: result.cppCode, header: result.headerCode };
}

function taskInitLine(cpp: string): string {
  return (
    cpp
      .split("\n")
      .find((l) => l.includes("tasks_storage[0] = TaskInstance")) ?? ""
  );
}

describe("TASK INTERVAL fractional literal codegen", () => {
  it("rounds fractional milliseconds to an integer LL literal", () => {
    const { cpp } = compileOk(`
PROGRAM PLC_PRG
VAR
    x : INT;
END_VAR
    x := x + 1;
END_PROGRAM
CONFIGURATION MainConfig
    RESOURCE MainResource ON PLC
        TASK MainTask (INTERVAL := T#16.6667ms, PRIORITY := 0);
        PROGRAM MainInstance WITH MainTask : PLC_PRG;
    END_RESOURCE
END_CONFIGURATION
`);
    const line = taskInitLine(cpp);
    expect(line).toMatch(/TaskInstance\("MAINTASK", \d+LL,/);
    expect(line).not.toMatch(/\d+\.\d+LL/);
    expect(line).toContain("16666700LL");
  });

  it("rounds T#16.667ms to an integer LL literal", () => {
    const { cpp } = compileOk(`
PROGRAM PLC_PRG
VAR
    x : INT;
END_VAR
    x := x + 1;
END_PROGRAM
CONFIGURATION MainConfig
    RESOURCE MainResource ON PLC
        TASK MainTask (INTERVAL := T#16.667ms, PRIORITY := 0);
        PROGRAM MainInstance WITH MainTask : PLC_PRG;
    END_RESOURCE
END_CONFIGURATION
`);
    expect(taskInitLine(cpp)).toContain("16667000LL");
  });

  it("keeps exact whole-millisecond intervals unchanged", () => {
    const { cpp } = compileOk(`
PROGRAM PLC_PRG
VAR
    x : INT;
END_VAR
    x := x + 1;
END_PROGRAM
CONFIGURATION MainConfig
    RESOURCE MainResource ON PLC
        TASK MainTask (INTERVAL := T#10ms, PRIORITY := 0);
        PROGRAM MainInstance WITH MainTask : PLC_PRG;
    END_RESOURCE
END_CONFIGURATION
`);
    expect(taskInitLine(cpp)).toContain("10000000LL");
  });

  it("handles sub-second and second intervals exactly", () => {
    const { cpp } = compileOk(`
PROGRAM PLC_PRG
VAR
    x : INT;
END_VAR
    x := x + 1;
END_PROGRAM
CONFIGURATION MainConfig
    RESOURCE MainResource ON PLC
        TASK MainTask (INTERVAL := T#0.5s, PRIORITY := 0);
        PROGRAM MainInstance WITH MainTask : PLC_PRG;
    END_RESOURCE
END_CONFIGURATION
`);
    expect(taskInitLine(cpp)).toContain("500000000LL");
  });
});
