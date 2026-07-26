import { describe, expect, it } from "vitest";
import { compile } from "../../src/index.js";

describe("NOT(SINT) semantic guard", () => {
  it("rejects NOT on a signed integer type at compile time", () => {
    const result = compile(`PROGRAM main
VAR
    x : SINT := 0;
    y : SINT;
END_VAR
y := NOT(x);
END_PROGRAM`);
    // CODESYS permits NOT only on BOOL, BYTE, WORD, DWORD, and LWORD.
    // SINT is not ANY_BIT and would be miscompiled to logical !.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toMatch(/NOT/);
  });
});
