import { describe, it, expect } from "vitest";
import { compile } from "../../src/index.js";

function compileOk(source: string): { cpp: string; header: string } {
  const result = compile(source);
  expect(result.errors.map((e) => e.message)).toEqual([]);
  expect(result.success).toBe(true);
  return { cpp: result.cppCode, header: result.headerCode };
}

describe("CASE labels referencing VAR_GLOBAL CONSTANT", () => {
  it("lowers constant labels to integer literals in the generated switch", () => {
    const { cpp } = compileOk(`
FUNCTION_BLOCK Stepper
VAR_INPUT
    ssMethodType : SINT;
END_VAR
VAR_OUTPUT
    y : INT;
END_VAR
CASE ssMethodType OF
    MODE_INIT:
        y := 0;
    MODE_STEP:
        y := y + 1;
END_CASE;
END_FUNCTION_BLOCK

PROGRAM Main
VAR
    s : Stepper;
END_VAR
    s(ssMethodType := MODE_STEP);
END_PROGRAM

VAR_GLOBAL CONSTANT
    MODE_INIT : SINT := 0;
    MODE_STEP : SINT := 1;
END_VAR
`);
    const switchBody = cpp.slice(
      cpp.indexOf("switch (SSMETHODTYPE)"),
      cpp.indexOf("}", cpp.indexOf("switch (SSMETHODTYPE)")) + 1,
    );
    expect(switchBody).toContain("case 0:");
    expect(switchBody).toContain("case 1:");
    expect(switchBody).not.toContain("case MODE_INIT:");
    expect(switchBody).not.toContain("case MODE_STEP:");
  });

  it("resolves constant expressions built from other constants", () => {
    const { cpp } = compileOk(`
FUNCTION_BLOCK F
VAR_INPUT
    x : SINT;
END_VAR
CASE x OF
    MODE_A + 1:
        x := 0;
END_CASE;
END_FUNCTION_BLOCK

VAR_GLOBAL CONSTANT
    MODE_A : SINT := 2;
END_VAR
`);
    const switchBody = cpp.slice(
      cpp.indexOf("switch (X)"),
      cpp.indexOf("}", cpp.indexOf("switch (X)")) + 1,
    );
    expect(switchBody).toContain("case 3:");
  });
});
