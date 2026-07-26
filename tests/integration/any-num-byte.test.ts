import { describe, expect, it } from "vitest";
import { compile } from "../../src/index.js";

describe("ANY_NUM function widening", () => {
  it("rejects ADD with BYTE because BYTE is not ANY_NUM", () => {
    const result = compile(`PROGRAM main
VAR
    a,b,c : BYTE;
END_VAR
c := ADD(a, b);
END_PROGRAM`);
    // CODESYS/IEC: ADD expects ANY_NUM, BYTE is ANY_BIT but not ANY_NUM.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toMatch(/ANY_NUM|ADD/);
  });
});
