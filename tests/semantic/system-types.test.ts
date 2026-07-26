// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project

import { describe, it, expect } from "vitest";
import {
  TYPE_CLASS,
  MEMORY_AREA,
  TYPE_CLASS_NAME,
  MEMORY_AREA_NAME,
  resolveTypeClass,
} from "../../src/semantic/system-types.js";
import { lookupBaseType } from "../../src/semantic/iec-types-data.js";
import type {
  ElementaryType,
  ArrayType,
  StructType,
  EnumType,
  FunctionBlockType,
  ReferenceType,
} from "../../src/frontend/ast.js";

describe("system-types", () => {
  it("exposes TYPE_CLASS constants with documented numeric values", () => {
    expect(TYPE_CLASS.TYPE_BOOL).toBe(0);
    expect(TYPE_CLASS.TYPE_BYTE).toBe(2);
    expect(TYPE_CLASS.TYPE_INT).toBe(7);
    expect(TYPE_CLASS.TYPE_REAL).toBe(14);
    expect(TYPE_CLASS.TYPE_STRING).toBe(16);
    expect(TYPE_CLASS.TYPE_ARRAY).toBe(26);
    expect(TYPE_CLASS.TYPE_USERDEF).toBe(28);
    expect(TYPE_CLASS.TYPE_BITCONST).toBe(38);
    // Values beyond 38 are not in the documented CODESYS enum and are not exposed.
    expect((TYPE_CLASS as Record<string, number>).TYPE_XWORD).toBeUndefined();
  });

  it("exposes MEMORY_AREA constants with documented numeric values", () => {
    expect(MEMORY_AREA.MEM_UNKNOWN).toBe(-1);
    expect(MEMORY_AREA.MEM_MEMORY).toBe(0);
    expect(MEMORY_AREA.MEM_INPUT).toBe(1);
    expect(MEMORY_AREA.MEM_OUTPUT).toBe(2);
    expect(MEMORY_AREA.MEM_RETAIN).toBe(3);
    expect(MEMORY_AREA.MEM_GLOBAL).toBe(4);
    expect(MEMORY_AREA.MEM_LOCAL).toBe(5);
  });

  it("reverse maps type-class numbers to names", () => {
    expect(TYPE_CLASS_NAME.get(0)).toBe("TYPE_BOOL");
    expect(TYPE_CLASS_NAME.get(7)).toBe("TYPE_INT");
    expect(TYPE_CLASS_NAME.get(28)).toBe("TYPE_USERDEF");
    expect(TYPE_CLASS_NAME.get(40)).toBeUndefined();
  });

  it("reverse maps memory-area numbers to names", () => {
    expect(MEMORY_AREA_NAME.get(-1)).toBe("MEM_UNKNOWN");
    expect(MEMORY_AREA_NAME.get(0)).toBe("MEM_MEMORY");
    expect(MEMORY_AREA_NAME.get(5)).toBe("MEM_LOCAL");
  });

  it("resolveTypeClass maps elementary types to their type class", () => {
    const intType: ElementaryType = {
      typeKind: "elementary",
      name: "INT",
      sizeBits: 16,
    };
    expect(resolveTypeClass(intType)).toBe(lookupBaseType("INT")?.typeClass);
  });

  it("resolveTypeClass maps arrays to TYPE_ARRAY", () => {
    const intType: ElementaryType = {
      typeKind: "elementary",
      name: "INT",
      sizeBits: 16,
    };
    const arrType: ArrayType = {
      typeKind: "array",
      elementType: intType,
      dimensions: [{ start: 0, end: 9 }],
    };
    expect(resolveTypeClass(arrType)).toBe(TYPE_CLASS.TYPE_ARRAY);
  });

  it("resolveTypeClass maps structs and FBs to TYPE_USERDEF", () => {
    const structType: StructType = {
      typeKind: "struct",
      name: "Point",
      fields: new Map(),
    };
    const fbType: FunctionBlockType = {
      typeKind: "functionBlock",
      name: "MyFB",
      inputVars: new Map(),
      outputVars: new Map(),
      inoutVars: new Map(),
    };
    expect(resolveTypeClass(structType)).toBe(TYPE_CLASS.TYPE_USERDEF);
    expect(resolveTypeClass(fbType)).toBe(TYPE_CLASS.TYPE_USERDEF);
  });

  it("resolveTypeClass maps enums to TYPE_ENUM", () => {
    const enumType: EnumType = {
      typeKind: "enum",
      name: "Color",
      values: ["RED", "GREEN", "BLUE"],
    };
    expect(resolveTypeClass(enumType)).toBe(TYPE_CLASS.TYPE_ENUM);
  });

  it("resolveTypeClass maps references to POINTER or REFERENCE", () => {
    const intType: ElementaryType = {
      typeKind: "elementary",
      name: "INT",
      sizeBits: 16,
    };
    const refTo: ReferenceType = {
      typeKind: "reference",
      referencedType: intType,
      isImplicitDeref: false,
    };
    const referenceTo: ReferenceType = {
      typeKind: "reference",
      referencedType: intType,
      isImplicitDeref: true,
    };
    expect(resolveTypeClass(refTo)).toBe(TYPE_CLASS.TYPE_POINTER);
    expect(resolveTypeClass(referenceTo)).toBe(TYPE_CLASS.TYPE_REFERENCE);
  });

  it("resolveTypeClass falls back to TYPE_SUBRANGE when flagged", () => {
    const unknown: ElementaryType = {
      typeKind: "elementary",
      name: "UNKNOWN",
      sizeBits: 8,
    };
    expect(
      resolveTypeClass(unknown, { typeName: "Foo", isSubrange: true }),
    ).toBe(TYPE_CLASS.TYPE_SUBRANGE);
  });
});
