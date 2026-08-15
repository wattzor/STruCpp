// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect } from "vitest";
import {
  iecBaseToCppLiteral,
  formatIntegerLiteral,
  formatArrayType,
  formatArrayElementAccess,
  translateIECString,
} from "../../src/backend/codegen-utils.js";

describe("iecBaseToCppLiteral", () => {
  it("lowers 16# hex literals", () => {
    expect(iecBaseToCppLiteral("16#FF")).toBe("0xFF");
    expect(iecBaseToCppLiteral("16#A_B_C")).toBe("0xABC");
  });

  it("lowers 8# octal literals", () => {
    expect(iecBaseToCppLiteral("8#77")).toBe("077");
    expect(iecBaseToCppLiteral("8#1_2_3")).toBe("0123");
  });

  it("lowers 2# binary literals", () => {
    expect(iecBaseToCppLiteral("2#1010")).toBe("0b1010");
    expect(iecBaseToCppLiteral("2#1_0")).toBe("0b10");
  });

  it("strips underscores from plain decimals", () => {
    expect(iecBaseToCppLiteral("1_000_000")).toBe("1000000");
  });
});

describe("formatIntegerLiteral", () => {
  it("lowers based integer literals", () => {
    expect(formatIntegerLiteral("16#FF", 255)).toBe("0xFF");
    expect(formatIntegerLiteral("8#77", 63)).toBe("077");
    expect(formatIntegerLiteral("2#1010", 10)).toBe("0b1010");
  });

  it("falls back to the parsed value for non-integer raw text", () => {
    expect(formatIntegerLiteral("not-a-number", 42)).toBe("42");
  });

  it("appends ULL for literals above the signed 64-bit max", () => {
    // ULINT max is larger than CPP_SIGNED_LITERAL_MAX
    expect(formatIntegerLiteral("18446744073709551615", 0)).toBe(
      "18446744073709551615ULL",
    );
  });

  it("emits a plain decimal for values that fit in a signed literal", () => {
    expect(formatIntegerLiteral("9223372036854775807", 0)).toBe(
      "9223372036854775807",
    );
  });
});

describe("formatArrayType", () => {
  it("formats 1D, 2D and 3D array types directly", () => {
    expect(formatArrayType("INT", [{ start: 0, end: 9 }])).toBe(
      "Array1D<INT, 0, 9>",
    );
    expect(
      formatArrayType("INT", [
        { start: 0, end: 1 },
        { start: 0, end: 2 },
      ]),
    ).toBe("Array2D<INT, 0, 1, 0, 2>");
    expect(
      formatArrayType("INT", [
        { start: 0, end: 1 },
        { start: 0, end: 2 },
        { start: 0, end: 3 },
      ]),
    ).toBe("Array3D<INT, 0, 1, 0, 2, 0, 3>");
  });

  it("nests Array1D for 4+ dimensions", () => {
    expect(
      formatArrayType("INT", [
        { start: 0, end: 1 },
        { start: 0, end: 2 },
        { start: 0, end: 3 },
        { start: 0, end: 4 },
      ]),
    ).toBe(
      "Array1D<Array1D<Array1D<Array1D<INT, 0, 4>, 0, 3>, 0, 2>, 0, 1>",
    );
  });
});

describe("formatArrayElementAccess", () => {
  it("uses operator() for 2D and 3D indices", () => {
    expect(formatArrayElementAccess("arr", [0, 1])).toBe("arr(0, 1)");
    expect(formatArrayElementAccess("arr", [0, 1, 2])).toBe("arr(0, 1, 2)");
  });

  it("uses operator[] for 1D and 4D+ indices", () => {
    expect(formatArrayElementAccess("arr", [0])).toBe("arr[0]");
    expect(formatArrayElementAccess("arr", [0, 1, 2, 3])).toBe(
      "arr[0][1][2][3]",
    );
  });
});

describe("translateIECString", () => {
  it("translates escape sequences", () => {
    expect(translateIECString("$N$n$L$l")).toBe("\\n\\n\\n\\n");
    expect(translateIECString("$R$r")).toBe("\\r\\r");
    expect(translateIECString("$T$t")).toBe("\\t\\t");
    expect(translateIECString("$P$p")).toBe("\\f\\f");
    expect(translateIECString("$$")).toBe("$");
    expect(translateIECString("$'")).toBe("'");
  });

  it("translates $XX hex escapes", () => {
    expect(translateIECString("$41$42")).toBe("\\x41\\x42");
  });

  it("passes through unknown $-escapes escaped", () => {
    // $1G is not a hex escape, so the $ is emitted escaped and 1G follows
    expect(translateIECString("$1G")).toBe("\\\\$1G");
  });

  it("collapses doubled single quotes", () => {
    expect(translateIECString("it''s")).toBe("it's");
  });

  it("escapes C++ special characters", () => {
    expect(translateIECString("a\\b")).toBe("a\\\\b");
    expect(translateIECString('say "hi"')).toBe('say \\"hi\\"');
  });

  it("leaves a trailing $ as a literal", () => {
    expect(translateIECString("end$")).toBe("end$");
  });
});
