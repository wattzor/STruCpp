import { describe, expect, it } from "vitest";
import { compile } from "../../src/index.js";

describe("ANY_NUM function widening", () => {
  it("accepts USINT for ADD (ANY_NUM)", () => {
    const result = compile(`PROGRAM main
VAR
    a,b,c : USINT;
END_VAR
c := ADD(a, b);
END_PROGRAM`);
    expect(result.errors).toHaveLength(0);
  });
});
