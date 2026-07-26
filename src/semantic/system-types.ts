// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * CODESYS __SYSTEM type metadata.
 *
 * Mirrors the TYPE_CLASS and MEMORY_AREA enumerations documented for the
 * CODESYS __VARINFO / ANY runtime descriptors. Values are fixed ABI constants;
 * do not change them without checking the CODESYS documentation.
 */

import type {
  EnumType,
  IECType,
  StructType,
  ElementaryType,
} from "../frontend/ast.js";
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
} as const;

/**
 * Types whose TYPE_CLASS is not documented fall back to TYPE_USERDEF (28).
 * This keeps the ABI honest rather than inventing plausible-looking values.
 */

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

/** Member lists for the two CODESYS __SYSTEM enums. */
export const SYSTEM_ENUM_MEMBERS: Readonly<Record<string, readonly string[]>> =
  {
    TYPE_CLASS: Object.keys(TYPE_CLASS),
    MEMORY_AREA: Object.keys(MEMORY_AREA),
  };

/** Map of "TYPE_CLASS.TYPE_BOOL" / "MEMORY_AREA.MEM_INPUT" to numeric value. */
export const SYSTEM_ENUM_MEMBER_VALUES: ReadonlyMap<string, number> =
  ((): ReadonlyMap<string, number> => {
    const m = new Map<string, number>();
    for (const enumName of ["TYPE_CLASS", "MEMORY_AREA"] as const) {
      const values = enumName === "TYPE_CLASS" ? TYPE_CLASS : MEMORY_AREA;
      for (const member of SYSTEM_ENUM_MEMBERS[enumName] ?? []) {
        m.set(
          `${enumName}.${member}`,
          (values as Record<string, number>)[member]!,
        );
      }
    }
    return m;
  })();

/** The set of names that live inside the synthetic __SYSTEM namespace. */
export const SYSTEM_ENUM_NAMES: ReadonlySet<string> = new Set<string>([
  "TYPE_CLASS",
  "MEMORY_AREA",
]);

/** The set of struct types exposed through the synthetic __SYSTEM namespace. */
export const SYSTEM_STRUCT_NAMES: ReadonlySet<string> = new Set<string>([
  "VAR_INFO",
]);

function elementaryType(name: string): ElementaryType {
  const meta = lookupBaseType(name);
  return {
    typeKind: "elementary",
    name,
    sizeBits: meta?.bits ?? 0,
  };
}

function systemEnumType(name: "TYPE_CLASS" | "MEMORY_AREA"): EnumType {
  return {
    typeKind: "enum",
    name,
    values: [...(SYSTEM_ENUM_MEMBERS[name] ?? [])],
  };
}

/**
 * The CODESYS __SYSTEM.VAR_INFO struct type as exposed to the compiler.
 * Field order and types follow the CODESYS Development System documentation.
 */
export const VAR_INFO_TYPE: StructType = {
  typeKind: "struct",
  name: "VAR_INFO",
  fields: new Map<string, IECType>([
    ["BYTEADDRESS", elementaryType("DWORD")],
    ["BYTEOFFSET", elementaryType("DINT")],
    ["AREA", elementaryType("INT")],
    ["BITNR", elementaryType("INT")],
    ["BITSIZE", elementaryType("UDINT")],
    ["BITADDRESS", elementaryType("UDINT")],
    ["TYPECLASS", systemEnumType("TYPE_CLASS")],
    ["TYPENAME", elementaryType("STRING")],
    ["NUMELEMENTS", elementaryType("UDINT")],
    ["BASETYPECLASS", systemEnumType("TYPE_CLASS")],
    ["ELEMBITSIZE", elementaryType("UDINT")],
    ["MEMORYAREA", systemEnumType("MEMORY_AREA")],
    ["SYMBOL", elementaryType("STRING")],
    ["COMMENT", elementaryType("STRING")],
  ]),
};

/**
 * True when `name` (any case) is the synthetic __SYSTEM namespace identifier.
 */
export function isSystemNamespaceName(name: string): boolean {
  return name.toUpperCase() === "__SYSTEM";
}

/**
 * Resolve a __SYSTEM qualified path to the enum type or member it denotes.
 * Returns undefined for anything that is not a recognized __SYSTEM identifier.
 */
export function resolveSystemAccess(
  path: string[],
):
  | { kind: "enumType"; enumType: EnumType }
  | { kind: "enumValue"; enumType: EnumType; value: number }
  | undefined {
  if (path.length < 1 || path.length > 2) return undefined;
  const enumName = path[0]!.toUpperCase();
  if (!SYSTEM_ENUM_NAMES.has(enumName)) return undefined;

  const values =
    enumName === "TYPE_CLASS"
      ? TYPE_CLASS
      : enumName === "MEMORY_AREA"
        ? MEMORY_AREA
        : undefined;
  if (values === undefined) return undefined;

  const enumType: EnumType = {
    typeKind: "enum",
    name: enumName,
    values: [...(SYSTEM_ENUM_MEMBERS[enumName] ?? [])],
  };

  if (path.length === 1) {
    return { kind: "enumType", enumType };
  }

  const memberName = path[1]!.toUpperCase();
  const key = `${enumName}.${memberName}`;
  const value = SYSTEM_ENUM_MEMBER_VALUES.get(key);
  if (value === undefined) return undefined;

  return { kind: "enumValue", enumType, value };
}

/**
 * Resolve an IEC type name to the corresponding __SYSTEM enum type, if any.
 * Requires the "__SYSTEM." prefix: TYPE_CLASS and MEMORY_AREA are
 * `{attribute 'qualified_only'}` and must be referenced as
 * `__SYSTEM.TYPE_CLASS` / `__SYSTEM.MEMORY_AREA`.
 */
export function getSystemEnumType(name: string): EnumType | undefined {
  const upper = name.toUpperCase();
  if (!upper.startsWith("__SYSTEM.")) return undefined;
  const n = upper.slice("__SYSTEM.".length);
  if (!SYSTEM_ENUM_NAMES.has(n)) return undefined;
  return {
    typeKind: "enum",
    name: n,
    values: [...(SYSTEM_ENUM_MEMBERS[n] ?? [])],
  };
}

/**
 * True when `name` refers to a __SYSTEM type through the qualified
 * namespace (e.g. "__SYSTEM.TYPE_CLASS" or "__SYSTEM.VAR_INFO").
 */
export function isSystemTypeReference(name: string): boolean {
  const upper = name.toUpperCase();
  if (!upper.startsWith("__SYSTEM.")) return false;
  const suffix = upper.slice("__SYSTEM.".length);
  return SYSTEM_ENUM_NAMES.has(suffix) || SYSTEM_STRUCT_NAMES.has(suffix);
}

/**
 * Resolve a __SYSTEM qualified type name to its IECType (enum or struct).
 * The "__SYSTEM." prefix is required (`qualified_only`).
 */
export function getSystemType(name: string): IECType | undefined {
  const upper = name.toUpperCase();
  if (!upper.startsWith("__SYSTEM.")) return undefined;
  const suffix = upper.slice("__SYSTEM.".length);
  if (suffix === "VAR_INFO") return VAR_INFO_TYPE;
  return getSystemEnumType(name);
}

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
      // Elementary types with no documented TYPE_CLASS (e.g. target-dependent
      // __XWORD) are reported as user-defined rather than NONE.
      return TYPE_CLASS.TYPE_USERDEF;
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
