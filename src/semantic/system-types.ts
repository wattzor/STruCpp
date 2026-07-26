// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS __SYSTEM type metadata.
 *
 * Mirrors the TYPE_CLASS and MEMORY_AREA enumerations documented for the
 * CODESYS __VARINFO / ANY runtime descriptors. Values are fixed ABI constants;
 * do not change them without checking the CODESYS documentation.
 */

import type { IECType } from "../frontend/ast.js";
import { lookupBaseType } from "./iec-types-data.js";

/**
 * CODESYS __SYSTEM.TYPE_CLASS enum values.
 *
 * Source: CODESYS Development System documentation for __VARINFO / TypeClass.
 * Underlying type is DWORD (unsigned 32-bit).
 */
export const TYPE_CLASS = {
  TYPE_BOOL: 0,
  TYPE_BIT: 1,
  TYPE_BYTE: 2,
  TYPE_WORD: 3,
  TYPE_DWORD: 4,
  TYPE_LWORD: 5,
  TYPE_SINT: 6,
  TYPE_INT: 7,
  TYPE_DINT: 8,
  TYPE_LINT: 9,
  TYPE_USINT: 10,
  TYPE_UINT: 11,
  TYPE_UDINT: 12,
  TYPE_ULINT: 13,
  TYPE_REAL: 14,
  TYPE_LREAL: 15,
  TYPE_STRING: 16,
  TYPE_WSTRING: 17,
  TYPE_TIME: 18,
  TYPE_DATE: 19,
  TYPE_DATEANDTIME: 20,
  TYPE_TIMEOFDAY: 21,
  TYPE_POINTER: 22,
  TYPE_REFERENCE: 23,
  TYPE_SUBRANGE: 24,
  TYPE_ENUM: 25,
  TYPE_ARRAY: 26,
  TYPE_PARAMS: 27,
  TYPE_USERDEF: 28,
  TYPE_NONE: 29,
  TYPE_ANY: 30,
  TYPE_ANYBIT: 31,
  TYPE_ANYDATE: 32,
  TYPE_ANYINT: 33,
  TYPE_ANYNUM: 34,
  TYPE_ANYREAL: 35,
  TYPE_LAZY: 36,
  TYPE_LTIME: 37,
  TYPE_BITCONST: 38,
  TYPE_UXINT: 39,
  TYPE_XWORD: 40,
  TYPE_XINT: 41,
  TYPE_XSTRING: 42,
  TYPE_VARLENARRAY: 43,
  TYPE_ANYSTRING: 44,
  TYPE_VECTOR: 45,
  TYPE_LDATE: 46,
  TYPE_LDATEANDTIME: 47,
  TYPE_LTIMEOFDAY: 48,
} as const;

/**
 * CODESYS __SYSTEM.MEMORY_AREA enum values.
 *
 * Source: CODESYS Development System documentation for __VARINFO / MemoryArea.
 * MEMORY_AREA is signed; MEM_UNKNOWN is -1.
 */
export const MEMORY_AREA = {
  MEM_UNKNOWN: -1,
  MEM_MEMORY: 0,
  MEM_INPUT: 1,
  MEM_OUTPUT: 2,
  MEM_RETAIN: 3,
  MEM_GLOBAL: 4,
  MEM_LOCAL: 5,
} as const;

/** Reverse lookup: type-class numeric value → canonical name. */
export const TYPE_CLASS_NAME: ReadonlyMap<number, string> = ((): ReadonlyMap<
  number,
  string
> => {
  const m = new Map<number, string>();
  for (const [k, v] of Object.entries(TYPE_CLASS)) {
    m.set(v as number, k);
  }
  return m;
})();

/** Reverse lookup: memory-area numeric value → canonical name. */
export const MEMORY_AREA_NAME: ReadonlyMap<number, string> = ((): ReadonlyMap<
  number,
  string
> => {
  const m = new Map<number, string>();
  for (const [k, v] of Object.entries(MEMORY_AREA)) {
    m.set(v as number, k);
  }
  return m;
})();

/**
 * Resolve an IEC type to its CODESYS __SYSTEM.TYPE_CLASS numeric id.
 *
 * Context may be provided for types whose class cannot be determined from the
 * IECType object alone (e.g. user-defined aliases, subrange types).
 */
export function resolveTypeClass(
  type: IECType,
  _ctx?: { typeName?: string; isSubrange?: boolean },
): number {
  switch (type.typeKind) {
    case "elementary": {
      const meta = lookupBaseType((type as unknown as { name: string }).name);
      if (meta?.typeClass !== undefined) {
        return meta.typeClass;
      }
      if (_ctx !== undefined && _ctx.isSubrange) {
        return TYPE_CLASS.TYPE_SUBRANGE;
      }
      return TYPE_CLASS.TYPE_NONE;
    }
    case "array":
      return TYPE_CLASS.TYPE_ARRAY;
    case "struct":
      return TYPE_CLASS.TYPE_USERDEF;
    case "enum":
      return TYPE_CLASS.TYPE_ENUM;
    case "functionBlock":
      return TYPE_CLASS.TYPE_USERDEF;
    case "reference": {
      const refType = type as unknown as {
        referencedType: IECType;
        isImplicitDeref: boolean;
      };
      return refType.isImplicitDeref
        ? TYPE_CLASS.TYPE_REFERENCE
        : TYPE_CLASS.TYPE_POINTER;
    }
    default:
      return _ctx !== undefined && _ctx.isSubrange
        ? TYPE_CLASS.TYPE_SUBRANGE
        : TYPE_CLASS.TYPE_USERDEF;
  }
}
