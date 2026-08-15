// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ Shared Type Utilities
 *
 * Single source of truth for IEC 61131-3 type data, compatibility logic,
 * and member resolution. Pure functions and constant data — no classes, no state.
 *
 * Consolidates type information previously duplicated across:
 * - type-checker.ts (ELEMENTARY_TYPES, TYPE_CATEGORIES, areTypesCompatible)
 * - analyzer.ts (IEC_TYPE_BITS, resolveStructFieldType, resolveArrayElementType)
 * - codegen.ts (IEC_TYPE_BITS, IEC_TYPE_CAT, canImplicitWiden, resolveMemberType)
 */

import type {
  Expression,
  IECType,
  ElementaryType,
  ArrayType,
  CompilationUnit,
  ReferenceType,
  StructType,
  EnumType,
  FunctionBlockType,
  TypeDefinition,
  StructDefinition,
  UnionDefinition,
} from "../frontend/ast.js";
import type {
  TypeConstraint,
  StdFunctionDescriptor,
} from "./std-function-registry.js";
import { IEC_BASE_TYPES, lookupBaseType } from "./iec-types-data.js";

/**
 * Map an IEC type name to its canonical spelling, collapsing aliases
 * (`TIME_OF_DAY` → `TOD`, `DATE_AND_TIME` → `DT`). Returns the input
 * unchanged for non-elementary names. Pure passthrough for upper-cased
 * canonical names (saves the registry lookup).
 *
 * Used by assignability / implicit-conversion checks so callers don't
 * have to remember to normalise on every comparison.
 */
export function canonicalElementaryName(name: string): string {
  return lookupBaseType(name)?.name ?? name.toUpperCase();
}

// =============================================================================
// Elementary Type Data
// =============================================================================

/**
 * Built-in elementary types as `ElementaryType` AST nodes, indexed by
 * canonical name AND every alias the parser accepts.
 *
 * Source of truth is `IEC_BASE_TYPES` in `iec-types-data.ts` (also
 * shipped as `libs/iec-types.json`). This map is just an AST-shaped
 * projection: each entry borrows the `bits` field as `sizeBits`
 * (the IEC logical width — `1` for BOOL, `8` for SINT, …, `0` for
 * variable-width strings).
 *
 * Each alias gets its own row pointing at an ElementaryType whose
 * name matches the alias spelling — so callers that read back
 * `.name` get the same string they looked up with.
 */
export const ELEMENTARY_TYPES: Record<string, ElementaryType> = (() => {
  const out: Record<string, ElementaryType> = {};
  for (const t of IEC_BASE_TYPES) {
    out[t.name] = { typeKind: "elementary", name: t.name, sizeBits: t.bits };
    for (const alias of t.aliases) {
      out[alias] = {
        typeKind: "elementary",
        name: alias,
        sizeBits: t.bits,
      };
    }
  }
  return out;
})();

// =============================================================================
// Type Categories
// =============================================================================

/**
 * Type category for IEC 61131-3 generic types.
 */
export type TypeCategory =
  | "ANY"
  | "ANY_DERIVED"
  | "ANY_ELEMENTARY"
  | "ANY_MAGNITUDE"
  | "ANY_NUM"
  | "ANY_REAL"
  | "ANY_INT"
  | "ANY_BIT"
  | "ANY_STRING"
  | "ANY_DATE";

/**
 * Map of type names to their categories.
 */
export const TYPE_CATEGORIES: Record<string, TypeCategory[]> = {
  BOOL: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  BYTE: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  WORD: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  DWORD: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  LWORD: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  __XWORD: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  SINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  INT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  DINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  LINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  __XINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  USINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  UINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  UDINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  ULINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  __UXINT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  REAL: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_REAL"],
  LREAL: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_REAL"],
  TIME: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_DATE"],
  DATE: ["ANY", "ANY_ELEMENTARY", "ANY_DATE"],
  TIME_OF_DAY: ["ANY", "ANY_ELEMENTARY", "ANY_DATE"],
  DATE_AND_TIME: ["ANY", "ANY_ELEMENTARY", "ANY_DATE"],
  STRING: ["ANY", "ANY_ELEMENTARY", "ANY_STRING"],
  WSTRING: ["ANY", "ANY_ELEMENTARY", "ANY_STRING"],
  // IEC 61131-3 generic type groups can also appear as declared parameter types.
  // They belong to the same categories as the concrete types they subsume.
  ANY: ["ANY"],
  ANY_DERIVED: ["ANY", "ANY_DERIVED"],
  ANY_ELEMENTARY: ["ANY", "ANY_ELEMENTARY"],
  ANY_MAGNITUDE: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE"],
  ANY_NUM: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM"],
  ANY_REAL: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_REAL"],
  ANY_INT: ["ANY", "ANY_ELEMENTARY", "ANY_MAGNITUDE", "ANY_NUM", "ANY_INT"],
  ANY_BIT: ["ANY", "ANY_ELEMENTARY", "ANY_BIT"],
  ANY_STRING: ["ANY", "ANY_ELEMENTARY", "ANY_STRING"],
  ANY_DATE: ["ANY", "ANY_ELEMENTARY", "ANY_DATE"],
};

/**
 * Widening category groups for implicit conversion checks.
 * Types in the same group can be widened to a wider type in the same group.
 */
const WIDENING_CATEGORY: Record<string, string> = {
  BOOL: "BIT",
  BYTE: "BIT",
  WORD: "BIT",
  DWORD: "BIT",
  LWORD: "BIT",
  // __XWORD is a platform-width address type. We model it as a 64-bit
  // bit-string for category purposes (its sizeBits is 64); the explicit
  // free-conversion rule in isImplicitlyConvertible keeps address round-trips
  // (ADR()/REF_LINK() into integers/pointers) warning-free.
  __XWORD: "BIT",
  SINT: "SINT",
  INT: "SINT",
  DINT: "SINT",
  LINT: "SINT",
  // __XINT is a target-width signed integer; like __XWORD its real width is
  // target-dependent, so the type-checker treats it as freely convertible
  // with other integer/bit types.
  __XINT: "SINT",
  USINT: "UINT",
  UINT: "UINT",
  UDINT: "UINT",
  ULINT: "UINT",
  // __UXINT is a target-width unsigned integer.
  __UXINT: "UINT",
  REAL: "REAL",
  LREAL: "REAL",
};

// =============================================================================
// Type Data Accessors
// =============================================================================

/**
 * Get the bit width of an IEC elementary type by name.
 * Returns undefined for non-elementary or unknown types.
 */
export function getTypeBits(name: string): number | undefined {
  return ELEMENTARY_TYPES[name.toUpperCase()]?.sizeBits;
}

/** Types that support bit access (integer and bit types only — not REAL/LREAL). */
const BIT_ACCESSIBLE_TYPES: Record<string, number> = {
  BOOL: 1,
  BYTE: 8,
  WORD: 16,
  DWORD: 32,
  LWORD: 64,
  SINT: 8,
  INT: 16,
  DINT: 32,
  LINT: 64,
  USINT: 8,
  UINT: 16,
  UDINT: 32,
  ULINT: 64,
};

/**
 * Get the bit width for bit access validation.
 * Returns undefined for types that don't support bit access (REAL, STRING, etc.).
 */
export function getBitAccessWidth(name: string): number | undefined {
  return BIT_ACCESSIBLE_TYPES[name.toUpperCase()];
}

/**
 * Get the primary widening category for an IEC type.
 * Returns "BIT", "SINT", "UINT", or "REAL" — or undefined for non-elementary types.
 */
export function getTypeCategory(name: string): string | undefined {
  return WIDENING_CATEGORY[name.toUpperCase()];
}

// =============================================================================
// Category Matching
// =============================================================================

/**
 * Check if a type belongs to a given IEC type category.
 */
export function isTypeInCategory(
  type: IECType,
  category: TypeCategory,
): boolean {
  if (type.typeKind !== "elementary") {
    return category === "ANY" || category === "ANY_DERIVED";
  }

  const elemType = type as ElementaryType;
  const categories = TYPE_CATEGORIES[elemType.name];
  return categories?.includes(category) ?? false;
}

/** The IEC generic type-group names (ANY, ANY_BIT, ANY_NUM, ...). */
const GENERIC_TYPE_NAMES: ReadonlySet<string> = new Set([
  "ANY",
  "ANY_DERIVED",
  "ANY_ELEMENTARY",
  "ANY_MAGNITUDE",
  "ANY_NUM",
  "ANY_REAL",
  "ANY_INT",
  "ANY_BIT",
  "ANY_STRING",
  "ANY_DATE",
]);

/**
 * Whether a resolved type is one of the IEC generic type groups rather than a
 * concrete type. Overloaded standard functions are published with one of these
 * as their declared return type (e.g. NOT -> ANY_BIT); such a result must be
 * refined to a concrete type at the call site before it can be used.
 */
export function isGenericGroupType(type: IECType): boolean {
  return (
    type.typeKind === "elementary" &&
    GENERIC_TYPE_NAMES.has((type as ElementaryType).name.toUpperCase())
  );
}

/**
 * Whether an IEC type name (uppercase) is one of the generic type groups.
 */
export function isGenericTypeName(typeName: string): boolean {
  return GENERIC_TYPE_NAMES.has(typeName.toUpperCase());
}

/**
 * The IEC generic type groups that are permitted as declared VAR_INPUT parameter
 * types according to CODESYS documentation.
 *
 * CODESYS allows: ANY, ANY_BIT, ANY_DATE, ANY_NUM, ANY_REAL, ANY_INT, ANY_STRING.
 * Supergroup names like ANY_ELEMENTARY, ANY_MAGNITUDE, and ANY_DERIVED are not
 * valid as formal parameter types.
 */
export const CODESYS_GENERIC_PARAMETER_TYPES: ReadonlySet<string> = new Set([
  "ANY",
  "ANY_BIT",
  "ANY_DATE",
  "ANY_NUM",
  "ANY_REAL",
  "ANY_INT",
  "ANY_STRING",
]);

/**
 * Whether an IEC generic type group name (uppercase) may be used as the type of a
 * VAR_INPUT parameter in a function, function block, or method.
 */
export function isValidGenericParameterType(typeName: string): boolean {
  return CODESYS_GENERIC_PARAMETER_TYPES.has(typeName.toUpperCase());
}

/**
 * Check if a type name matches a StdFunctionRegistry TypeConstraint.
 */
export function matchesConstraint(
  typeName: string,
  constraint: TypeConstraint,
): boolean {
  const upper = typeName.toUpperCase();

  // "specific" constraints are checked by the caller against specificType
  if (constraint === "specific") return true;

  // "BOOL" is a special single-type constraint
  if (constraint === "BOOL") return upper === "BOOL";

  // CODESYS extension: bit shifts accept both ANY_BIT and ANY_INT operands.
  if (constraint === "ANY_BIT_OR_INT") {
    const categories = TYPE_CATEGORIES[upper];
    return (
      !!categories &&
      (categories.includes("ANY_BIT") || categories.includes("ANY_INT"))
    );
  }

  // Map constraint to TypeCategory and check membership
  const elem = ELEMENTARY_TYPES[upper];
  if (!elem) {
    // Generic type group names (ANY, ANY_NUM, etc.) are not concrete elementary
    // types, but they still belong to IEC categories.
    const categories = TYPE_CATEGORIES[upper];
    if (categories) {
      return categories.includes(constraint as TypeCategory);
    }
    // Non-elementary types match ANY and ANY_DERIVED
    return constraint === "ANY" || (constraint as string) === "ANY_DERIVED";
  }

  const categories = TYPE_CATEGORIES[upper];
  if (!categories) return constraint === "ANY";

  // TypeConstraint values map directly to TypeCategory values
  return categories.includes(constraint as TypeCategory);
}

// =============================================================================
// Type Compatibility
// =============================================================================

/**
 * Check if a source type can be assigned to a target type.
 * Allows same type, widening conversions within numeric types,
 * and cross-category promotions (BIT→INT, INT→REAL).
 */
export function isAssignable(target: IECType, source: IECType): boolean {
  // IEC generic type groups (ANY, ANY_BIT, ANY_NUM, etc.) accept any concrete
  // type that belongs to the group.
  if (isGenericGroupType(target)) {
    return isTypeInCategory(
      source,
      (target as ElementaryType).name as TypeCategory,
    );
  }

  // Same typeKind check
  if (target.typeKind !== source.typeKind) {
    // Allow elementary-to-elementary only
    if (target.typeKind !== "elementary" || source.typeKind !== "elementary") {
      return false;
    }
  }

  if (target.typeKind === "elementary" && source.typeKind === "elementary") {
    const t = target as ElementaryType;
    const s = source as ElementaryType;

    // Resolve aliases (TIME_OF_DAY ↔ TOD, DATE_AND_TIME ↔ DT) before
    // comparison so the parser/AST tag form doesn't matter.
    const tCanon = canonicalElementaryName(t.name);
    const sCanon = canonicalElementaryName(s.name);

    // Same canonical type is always assignable
    if (tCanon === sCanon) return true;

    // Use implicit conversion check (includes widening + cross-category)
    return isImplicitlyConvertible(sCanon, tCanon);
  }

  // For reference types, check referenced type compatibility
  if (target.typeKind === "reference" && source.typeKind === "reference") {
    const tRef = target as ReferenceType;
    const sRef = source as ReferenceType;
    return isAssignable(tRef.referencedType, sRef.referencedType);
  }

  // For other types (struct, array, FB), require exact match
  return JSON.stringify(target) === JSON.stringify(source);
}

/**
 * Check if a source type name can be implicitly converted to a target type name.
 * Covers CODESYS rules:
 * - Same-category widening (BYTE→DWORD, INT→DINT, REAL→LREAL)
 * - BIT→INT crossover (BYTE→INT, WORD→DINT)
 * - Integer/BIT→REAL promotion (INT→REAL, BYTE→REAL)
 */
export function isImplicitlyConvertible(
  source: string,
  target: string,
): boolean {
  const s = source.toUpperCase();
  const t = target.toUpperCase();
  if (s === t) return true;

  // __XWORD is a platform-width address type (CODESYS __XWORD semantics).
  // It is freely convertible — in either direction, without a narrowing
  // warning — with any bit-string or integer type, since ADR()/REF_LINK()
  // produce __XWORD and that address is routinely stored into BYTE/DWORD/...
  // and back. POINTER/REF assignments are handled separately by the caller.
  if (s === "__XWORD" || t === "__XWORD") {
    const other = s === "__XWORD" ? t : s;
    const otherCat = WIDENING_CATEGORY[other];
    if (otherCat === "BIT" || otherCat === "SINT" || otherCat === "UINT")
      return true;
  }

  // __XINT / __UXINT are target-width signed/unsigned integers. Their real
  // width is selected by the C++ target-width macro, so the type checker treats
  // them as freely convertible with any integer or bit-string type.
  if (s === "__XINT" || s === "__UXINT" || t === "__XINT" || t === "__UXINT") {
    const other = s === "__XINT" || s === "__UXINT" ? t : s;
    const otherCat = WIDENING_CATEGORY[other];
    if (otherCat === "BIT" || otherCat === "SINT" || otherCat === "UINT")
      return true;
  }

  const sBits = ELEMENTARY_TYPES[s]?.sizeBits;
  const tBits = ELEMENTARY_TYPES[t]?.sizeBits;
  const sCat = WIDENING_CATEGORY[s];
  const tCat = WIDENING_CATEGORY[t];

  if (sBits === undefined || tBits === undefined || !sCat || !tCat)
    return false;

  // Same category, wider target
  if (sCat === tCat && tBits >= sBits) return true;

  // BIT → signed/unsigned integer (CODESYS: BYTE→INT)
  if (sCat === "BIT" && (tCat === "SINT" || tCat === "UINT") && tBits >= sBits)
    return true;

  // Integer/unsigned → BIT (CODESYS: INT→DWORD when target is wide enough)
  if ((sCat === "SINT" || sCat === "UINT") && tCat === "BIT" && tBits >= sBits)
    return true;

  // Integer/unsigned/BIT → REAL promotion
  if (
    (sCat === "SINT" || sCat === "UINT" || sCat === "BIT") &&
    tCat === "REAL" &&
    tBits >= sBits
  )
    return true;

  return false;
}

/**
 * Check if converting from source to target is a narrowing conversion.
 * A narrowing conversion loses precision or changes the value range.
 */
export function isNarrowingConversion(target: string, source: string): boolean {
  const s = source.toUpperCase();
  const t = target.toUpperCase();
  if (s === t) return false;

  // __XINT / __UXINT widths are target-dependent; do not emit narrowing
  // warnings to/from integer or bit types (the C++ type resolves correctly).
  if (
    (s === "__XINT" || s === "__UXINT" || t === "__XINT" || t === "__UXINT") &&
    ((WIDENING_CATEGORY[s] ?? "").match(/^(BIT|SINT|UINT)$/) ||
      (WIDENING_CATEGORY[t] ?? "").match(/^(BIT|SINT|UINT)$/))
  ) {
    return false;
  }

  const sBits = ELEMENTARY_TYPES[s]?.sizeBits;
  const tBits = ELEMENTARY_TYPES[t]?.sizeBits;
  const sCat = WIDENING_CATEGORY[s];
  const tCat = WIDENING_CATEGORY[t];

  if (sBits === undefined || tBits === undefined || !sCat || !tCat)
    return false;

  // Same category, narrower target
  if (sCat === tCat && tBits < sBits) return true;

  // REAL → INT is always narrowing
  if (sCat === "REAL" && (tCat === "SINT" || tCat === "UINT" || tCat === "BIT"))
    return true;

  // Signed ↔ Unsigned of same width is narrowing (different value range)
  if (
    ((sCat === "SINT" && tCat === "UINT") ||
      (sCat === "UINT" && tCat === "SINT")) &&
    tBits <= sBits
  )
    return true;

  // INT → BIT is narrowing when target is smaller
  if ((sCat === "SINT" || sCat === "UINT") && tCat === "BIT" && tBits <= sBits)
    return true;

  // BIT → INT narrowing when target is smaller
  if (sCat === "BIT" && (tCat === "SINT" || tCat === "UINT") && tBits < sBits)
    return true;

  // INT/UINT → REAL is narrowing when target bits < source bits (e.g., ULINT→REAL)
  if (
    (sCat === "SINT" || sCat === "UINT" || sCat === "BIT") &&
    tCat === "REAL" &&
    tBits < sBits
  )
    return true;

  return false;
}

/**
 * Get the common (wider) type for binary expressions.
 * Returns undefined if the types are incompatible for arithmetic.
 */
export function getCommonType(a: IECType, b: IECType): IECType | undefined {
  if (a.typeKind !== "elementary" || b.typeKind !== "elementary") {
    return undefined;
  }

  const aElem = a as ElementaryType;
  const bElem = b as ElementaryType;

  // Same type
  if (aElem.name === bElem.name) return a;

  const aCat = WIDENING_CATEGORY[aElem.name];
  const bCat = WIDENING_CATEGORY[bElem.name];
  if (!aCat || !bCat) return undefined;

  // REAL types are wider than INT types
  if (aElem.name === "LREAL" || bElem.name === "LREAL") {
    return ELEMENTARY_TYPES["LREAL"];
  }
  if (aElem.name === "REAL" || bElem.name === "REAL") {
    return ELEMENTARY_TYPES["REAL"];
  }

  // Use canonical bit widths from ELEMENTARY_TYPES
  const aBits = ELEMENTARY_TYPES[aElem.name]?.sizeBits ?? aElem.sizeBits;
  const bBits = ELEMENTARY_TYPES[bElem.name]?.sizeBits ?? bElem.sizeBits;

  // Both must be in compatible numeric categories
  const aCategories = TYPE_CATEGORIES[aElem.name];
  const bCategories = TYPE_CATEGORIES[bElem.name];
  if (!aCategories || !bCategories) return undefined;

  const aIsNum = aCategories.includes("ANY_NUM");
  const bIsNum = bCategories.includes("ANY_NUM");
  const aIsBit = aCategories.includes("ANY_BIT");
  const bIsBit = bCategories.includes("ANY_BIT");

  // Both numeric → return the wider one
  if (aIsNum && bIsNum) {
    return aBits >= bBits ? a : b;
  }

  // BIT + NUM → promote BIT to the numeric type (or wider)
  if (aIsBit && bIsNum) return b;
  if (bIsBit && aIsNum) return a;

  // Both BIT → return wider
  if (aIsBit && bIsBit) {
    return aBits >= bBits ? a : b;
  }

  return undefined;
}

// =============================================================================
// Standard Function Argument Harmonization
// =============================================================================

/**
 * Determine the argument range to harmonize for variadic/mixed standard
 * functions.  For functions with a leading selector (MUX, SEL) the selector
 * is skipped so the value arguments can be unified independently.
 */
export function getHarmonizableRange(
  stdFunc: StdFunctionDescriptor,
  argCount: number,
): { start: number; end: number } | undefined {
  if (stdFunc.params.length === 0) return undefined;
  const firstConstraint = stdFunc.params[0]!.constraint;
  let start = 0;
  if (firstConstraint === "BOOL" || firstConstraint === "specific") {
    start = 1;
  }
  if (argCount <= start + 1) return undefined;
  const restConstraint = stdFunc.params[start]!.constraint;
  for (let i = start; i < stdFunc.params.length; i++) {
    if (stdFunc.params[i]!.constraint !== restConstraint) return undefined;
  }
  return { start, end: argCount };
}

/**
 * Returns true for standard functions whose C++ runtime implementation is a
 * single-type template and therefore needs all value arguments cast to a common
 * IEC type.  LIMIT/SEL/MIN/MAX/EXPT and comparison operators have mixed-type
 * overloads and must not be forced into a common type here.
 */
export function shouldHarmonizeStdFuncArgs(
  stdFunc: StdFunctionDescriptor,
  _argCount: number,
): boolean {
  const name = stdFunc.cppName.toUpperCase();
  return [
    "ADD",
    "MUL",
    "SUB",
    "DIV",
    "MOD",
    "MUX",
    "AND",
    "OR",
    "XOR",
  ].includes(name);
}

/**
 * Returns true for standard functions whose result is the common IEC type of
 * their value arguments, even when the first argument is a selector (MUX, SEL)
 * or the function is not marked returnMatchesFirstParam (LIMIT, MIN, MAX).
 */
export function stdFuncReturnsCommonType(
  stdFunc: StdFunctionDescriptor,
): boolean {
  const name = stdFunc.name.toUpperCase();
  return ["MUX", "SEL", "LIMIT", "MIN", "MAX"].includes(name);
}

/**
 * Compute a single IEC type that every argument in the range can be cast to
 * without losing the sign of any value.  Mixed signed/unsigned integers are
 * widened to a signed type large enough for both ranges.  If no such type
 * exists (e.g. LINT + ULINT) the function returns undefined.
 */
export function computeCommonHarmonizedType(
  argTypes: (string | undefined)[],
  start: number,
  end: number,
): string | undefined {
  return _computeCommonType(argTypes, start, end, false);
}

/**
 * Compute the common IEC type for a selection function (MIN/MAX/LIMIT/SEL/MUX).
 * Unlike harmonized arithmetic, these functions select (rather than combine)
 * one of their operands, so when no signed type can hold every value the common
 * type falls back to the unsigned type of the widest operand (matching the
 * runtime's `iec_minmax_result_t` / `iec_common_result_t`).
 */
export function computeSelectionCommonType(
  argTypes: (string | undefined)[],
  start: number,
  end: number,
): string | undefined {
  return _computeCommonType(argTypes, start, end, true);
}

function _computeCommonType(
  argTypes: (string | undefined)[],
  start: number,
  end: number,
  allowUnsignedFallback: boolean,
): string | undefined {
  const types: string[] = [];
  for (let i = start; i < end; i++) {
    const t = argTypes[i];
    if (!t) return undefined;
    types.push(t);
  }

  const first = types[0]!;
  if (types.every((t) => t === first)) return first;

  const cats = types.map((t) => getTypeCategory(t));
  if (cats.some((c) => !c)) return undefined;

  // REAL/LREAL: promote to LREAL if any operand is LREAL or a 64-bit integer.
  const hasReal = cats.some((c) => c === "REAL");
  if (hasReal) {
    const hasLReal = types.some((t) => t.toUpperCase() === "LREAL");
    const has64Int = types.some((t) => {
      const bits = getTypeBits(t) ?? 0;
      const cat = getTypeCategory(t);
      return (cat === "SINT" || cat === "UINT" || cat === "BIT") && bits === 64;
    });
    if (hasLReal || has64Int) return "LREAL";
    return "REAL";
  }

  // All integer-like (BIT/SINT/UINT)
  let maxSignedWidth = 0;
  let maxUnsignedWidth = 0;
  for (const t of types) {
    const cat = getTypeCategory(t)!;
    const bits = getTypeBits(t) ?? 0;
    if (cat === "SINT") {
      if (bits > maxSignedWidth) maxSignedWidth = bits;
    } else if (cat === "UINT" || cat === "BIT") {
      if (bits > maxUnsignedWidth) maxUnsignedWidth = bits;
    }
  }
  const anySigned = maxSignedWidth > 0;
  const anyUnsigned = maxUnsignedWidth > 0;

  if (anySigned && anyUnsigned) {
    const needed = Math.max(maxSignedWidth, maxUnsignedWidth + 1);
    if (needed <= 8) return "SINT";
    if (needed <= 16) return "INT";
    if (needed <= 32) return "DINT";
    if (needed <= 64) return "LINT";
    // No signed type can represent the full value range.  Selection functions
    // fall back to the unsigned common type (runtime `iec_minmax_result_t`);
    // arithmetic functions stop here and report an error.
    if (allowUnsignedFallback) {
      return unsignedTypeAtWidth(maxUnsignedWidth);
    }
    return undefined;
  }

  if (anySigned) {
    if (maxSignedWidth <= 8) return "SINT";
    if (maxSignedWidth <= 16) return "INT";
    if (maxSignedWidth <= 32) return "DINT";
    return "LINT";
  }

  if (anyUnsigned) {
    return unsignedTypeAtWidth(maxUnsignedWidth, types);
  }

  return undefined;
}

function unsignedTypeAtWidth(
  width: number,
  types?: string[],
): string | undefined {
  if (types) {
    // Prefer a UINT-category name if one exists at this width; otherwise a
    // BIT-category name (BYTE/WORD/DWORD/LWORD).  This keeps e.g. MAX(WORD,
    // DWORD) returning DWORD rather than UINT.
    const uintAtWidth = types.find(
      (t) => getTypeCategory(t) === "UINT" && (getTypeBits(t) ?? 0) === width,
    );
    if (uintAtWidth) return uintAtWidth;
    const bitAtWidth = types.find(
      (t) => getTypeCategory(t) === "BIT" && (getTypeBits(t) ?? 0) === width,
    );
    if (bitAtWidth) return bitAtWidth;
  }
  if (width <= 8) return "USINT";
  if (width <= 16) return "UINT";
  if (width <= 32) return "UDINT";
  return "ULINT";
}

/**
 * Returns true if an expression is a bare literal (no explicit type prefix),
 * possibly wrapped in a unary +/-.  Bare literals should be treated as
 * untyped placeholders that take on the type of the surrounding expression.
 */
export function isBareLiteral(expr: Expression): boolean {
  const inner = expr.kind === "UnaryExpression" ? expr.operand : expr;
  return inner.kind === "LiteralExpression" && !inner.typePrefix;
}

/**
 * Compute the common IEC type for a harmonized std function argument range.
 * If all non-bare (typed) operands share one type, that type wins so bare
 * literals are cast to the typed operand's type.  Otherwise fall back to the
 * full widened common type.  This mirrors the cast emitter in codegen.
 */
export function resolveHarmonizedCommonType(
  argTypeNames: (string | undefined)[],
  isBare: boolean[],
  start: number,
  end: number,
): string | undefined {
  return resolveCommonTypeWith(
    argTypeNames,
    isBare,
    start,
    end,
    computeCommonHarmonizedType,
  );
}

/**
 * Compute the common IEC type for a selection function argument range
 * (MIN/MAX/LIMIT/SEL/MUX).  Like `resolveHarmonizedCommonType` but falls back
 * to the unsigned common type when no signed type can hold all integer values.
 */
export function resolveSelectionCommonType(
  argTypeNames: (string | undefined)[],
  isBare: boolean[],
  start: number,
  end: number,
): string | undefined {
  return resolveCommonTypeWith(
    argTypeNames,
    isBare,
    start,
    end,
    computeSelectionCommonType,
  );
}

function resolveCommonTypeWith(
  argTypeNames: (string | undefined)[],
  isBare: boolean[],
  start: number,
  end: number,
  compute: (
    argTypes: (string | undefined)[],
    start: number,
    end: number,
  ) => string | undefined,
): string | undefined {
  const nonBareTypes: string[] = [];
  for (let i = start; i < end; i++) {
    const t = argTypeNames[i];
    if (!t) return undefined;
    if (!isBare[i]) nonBareTypes.push(t);
  }

  // A generic IEC type group (ANY, ANY_NUM, etc.) cannot be used as a
  // concrete common type to cast other arguments to. Fall through to the
  // full widened computation, which will fail for generic operands and
  // produce a clear compile-time error instead of invalid C++.
  if (
    nonBareTypes.length > 0 &&
    nonBareTypes.every((t) => t === nonBareTypes[0]!) &&
    !isGenericTypeName(nonBareTypes[0]!)
  ) {
    return nonBareTypes[0]!;
  }

  return compute(argTypeNames, start, end);
}

// =============================================================================
// Composite Type Helpers
// =============================================================================

/**
 * Return true if a type definition is a struct or union (they share field-list
 * handling everywhere except codegen/validation).
 */
export function isCompositeDefinition(
  def: TypeDefinition,
): def is StructDefinition | UnionDefinition {
  return def.kind === "StructDefinition" || def.kind === "UnionDefinition";
}

// =============================================================================
// Member Resolution
// =============================================================================

/**
 * Resolve the type of a struct or FB field by looking up the type definition in the AST.
 */
export function resolveFieldType(
  typeName: string,
  fieldName: string,
  ast: CompilationUnit,
): string | undefined {
  const typeUpper = typeName.toUpperCase();
  const fieldUpper = fieldName.toUpperCase();

  // Check struct / union type definitions
  for (const td of ast.types) {
    if (
      td.name.toUpperCase() === typeUpper &&
      isCompositeDefinition(td.definition)
    ) {
      for (const field of td.definition.fields) {
        for (const name of field.names) {
          if (name.toUpperCase() === fieldUpper) return field.type.name;
        }
      }
    }
  }

  // Check FB var blocks (FB instance member access)
  for (const fb of ast.functionBlocks) {
    if (fb.name.toUpperCase() === typeUpper) {
      for (const block of fb.varBlocks) {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            if (name.toUpperCase() === fieldUpper) return decl.type.name;
          }
        }
      }
      return undefined;
    }
  }

  // Check programs (program instance member access)
  for (const prog of ast.programs) {
    if (prog.name.toUpperCase() === typeUpper) {
      for (const block of prog.varBlocks) {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            if (name.toUpperCase() === fieldUpper) return decl.type.name;
          }
        }
      }
      return undefined;
    }
  }

  return undefined;
}

/**
 * Resolve the element type of an array type.
 * Handles __INLINE_ARRAY_* internal types and user-defined array TYPE definitions.
 */
export function resolveArrayElementType(
  typeName: string,
  ast: CompilationUnit,
): string | undefined {
  const typeUpper = typeName.toUpperCase();

  // Handle __INLINE_ARRAY_<ElementType> internal types
  if (typeUpper.startsWith("__INLINE_ARRAY_")) {
    return typeUpper.substring("__INLINE_ARRAY_".length);
  }

  // Check user-defined array type definitions
  for (const td of ast.types) {
    if (
      td.name.toUpperCase() === typeUpper &&
      td.definition.kind === "ArrayDefinition"
    ) {
      return td.definition.elementType.name.toUpperCase();
    }
  }

  return undefined;
}

/**
 * Evaluate a compile-time integer expression; undefined when it isn't one.
 *
 * Deliberately narrow — array bounds and similar declaration-time integers are
 * literals or a negated literal in practice, and anything else is better left
 * unresolved than guessed at.
 */
export function evalIntConst(e: unknown): number | undefined {
  if (e === null || e === undefined || typeof e !== "object") return undefined;
  const expr = e as {
    kind?: string;
    value?: unknown;
    operand?: unknown;
    operator?: string;
  };
  if (expr.kind === "LiteralExpression") {
    if (typeof expr.value === "number") return expr.value;
    if (typeof expr.value === "bigint") {
      const n = Number(expr.value);
      if (Number.isSafeInteger(n)) return n;
    }
  }
  if (expr.kind === "UnaryExpression" && expr.operator === "-") {
    const inner = evalIntConst(expr.operand);
    return inner === undefined ? undefined : -inner;
  }
  return undefined;
}

/** One declared array dimension; `null` when its extent isn't known statically. */
export type ArrayDimExtent = { start: number; end: number } | null;

/** The declared shape of an array type: its dimensions and element type name. */
export interface ArrayShape {
  /** One entry per dimension. `null` for a variable-length (`ARRAY[*]`) or
   *  non-constant bound — the rank is still known, the extent isn't. */
  dims: ArrayDimExtent[];
  elementTypeName: string;
}

/** Guard against a cyclic alias chain while resolving a type name. */
const MAX_TYPE_ALIAS_DEPTH = 32;

/**
 * Resolve the declared shape of an array-typed reference, following type
 * aliases. Returns undefined when the reference is not an array.
 *
 * Covers both spellings: an inline `ARRAY[…] OF T` (whose bounds the AST builder
 * has already resolved onto the TypeReference) and a named ARRAY type.
 */
export function resolveArrayShape(
  type: {
    name: string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
  },
  ast: CompilationUnit,
): ArrayShape | undefined {
  if (type.arrayDimensions && type.arrayDimensions.length > 0) {
    return {
      dims: type.arrayDimensions.map((d) => ({ start: d.start, end: d.end })),
      elementTypeName: type.elementTypeName ?? "",
    };
  }
  return resolveArrayShapeByName(type.name, ast);
}

/**
 * Resolve the declared shape of a named type, following alias chains.
 * Returns undefined when the name doesn't (transitively) name an array.
 */
export function resolveArrayShapeByName(
  typeName: string,
  ast: CompilationUnit,
  depth = 0,
): ArrayShape | undefined {
  if (depth >= MAX_TYPE_ALIAS_DEPTH) return undefined;
  const upper = typeName.toUpperCase();

  // Internal marker for an inline array whose bounds live on the declaration;
  // the rank isn't recoverable from the name alone.
  if (upper.startsWith("__INLINE_ARRAY_")) return undefined;

  for (const td of ast.types) {
    if (td.name.toUpperCase() !== upper) continue;
    const def = td.definition;
    if (def.kind === "ArrayDefinition") {
      return {
        dims: def.dimensions.map((d) => {
          if (d.isVariableLength) return null;
          const start = evalIntConst(d.start);
          const end = evalIntConst(d.end);
          return start === undefined || end === undefined
            ? null
            : { start, end };
        }),
        elementTypeName: def.elementType.name,
      };
    }
    if (def.kind === "TypeReference") {
      // Alias — keep walking toward the underlying array, if any.
      return resolveArrayShapeByName(def.name, ast, depth + 1);
    }
    return undefined;
  }
  return undefined;
}

/** Number of elements a dimension holds, or undefined when its extent is unknown. */
export function arrayDimSize(dim: ArrayDimExtent): number | undefined {
  if (!dim) return undefined;
  const size = dim.end - dim.start + 1;
  return size > 0 ? size : undefined;
}

/** Total element count across every dimension, or undefined if any is unknown. */
export function arrayTotalSize(dims: ArrayDimExtent[]): number | undefined {
  let total = 1;
  for (const d of dims) {
    const size = arrayDimSize(d);
    if (size === undefined) return undefined;
    total *= size;
  }
  return total;
}

// =============================================================================
// Display Helper
// =============================================================================

/**
 * Get a display name for an IECType.
 */
export function typeName(type: IECType): string {
  switch (type.typeKind) {
    case "elementary":
      return (type as ElementaryType).name;
    case "array":
      return "ARRAY";
    case "struct":
      return (type as StructType).name;
    case "enum":
      return (type as EnumType).name;
    case "reference":
      return `REF_TO ${typeName((type as ReferenceType).referencedType)}`;
    case "functionBlock":
      return (type as FunctionBlockType).name;
    default:
      return type.typeKind;
  }
}

// =============================================================================
// Enum Member Reverse Lookup
// =============================================================================

/**
 * Entry in the enum member reverse map.
 * `typeName` is the owning enum's original-case name, or `null` when the
 * member appears in more than one enum (ambiguous).
 * `conflictingTypes` lists all enum types that define this member (only
 * populated when ambiguous, for error messages).
 */
export interface EnumMemberEntry {
  typeName: string | null;
  conflictingTypes: string[];
}

/**
 * Build a reverse lookup map from enum member names to their owning enum type.
 * When a member name exists in multiple enum types the entry is marked
 * ambiguous (`typeName: null`) and `conflictingTypes` lists all owners.
 *
 * @param enumTypes Iterable of `{ name, members }` descriptors.
 *   `name` is the original-case enum type name; `members` are the
 *   original-case member names.
 * @returns Map keyed by uppercase member name.
 */
export function buildEnumMemberMap(
  enumTypes: Iterable<{ name: string; members: string[] }>,
): Map<string, EnumMemberEntry> {
  const map = new Map<string, EnumMemberEntry>();
  for (const enumType of enumTypes) {
    for (const member of enumType.members) {
      const key = member.toUpperCase();
      const existing = map.get(key);
      if (existing) {
        // Mark ambiguous and track all conflicting types
        existing.typeName = null;
        if (!existing.conflictingTypes.includes(enumType.name)) {
          existing.conflictingTypes.push(enumType.name);
        }
      } else {
        map.set(key, {
          typeName: enumType.name,
          conflictingTypes: [enumType.name],
        });
      }
    }
  }
  return map;
}

/**
 * Render an IECType as a short human-readable string for diagnostic
 * messages. Names the offending type without leaking internal field
 * structure: "INT", "STRUCT 'MyType'", "ARRAY", "REF_TO INT", etc.
 *
 * Falls back to the typeKind tag if the variant carries no name.
 */
export function describeType(t: IECType): string {
  switch (t.typeKind) {
    case "elementary":
      return (t as ElementaryType).name;
    case "struct":
      return `STRUCT '${(t as StructType).name}'`;
    case "enum":
      return `ENUM '${(t as EnumType).name}'`;
    case "functionBlock":
      return `FUNCTION_BLOCK '${(t as FunctionBlockType).name}'`;
    case "array":
      return `ARRAY OF ${describeType((t as ArrayType).elementType)}`;
    case "reference":
      return `REF_TO ${describeType((t as ReferenceType).referencedType)}`;
    default:
      return t.typeKind;
  }
}

// =============================================================================
// Constant literal range validation
// =============================================================================

const REAL32_MAX = 3.4028234663852886e38;
const REAL64_MAX = Number.MAX_VALUE;

const NON_INTEGER_NUMERIC_TYPES = new Set([
  "TIME",
  "LTIME",
  "DATE",
  "LDATE",
  "TIME_OF_DAY",
  "TOD",
  "DATE_AND_TIME",
  "DT",
  "LTOD",
  "LDT",
]);

/**
 * Return the inclusive numeric range for an IEC elementary type.
 * Returns undefined for non-numeric types (STRING, TIME/date, etc.).
 */
export function getTypeNumericRange(
  typeName: string,
):
  | { min: bigint; max: bigint; isInteger: true }
  | { min: number; max: number; isInteger: false }
  | undefined {
  const meta = lookupBaseType(typeName);
  if (!meta) return undefined;

  const upper = meta.name.toUpperCase();
  if (upper === "BOOL") {
    return { min: 0n, max: 1n, isInteger: true };
  }
  if (upper === "REAL" || upper === "LREAL") {
    const max = upper === "REAL" ? REAL32_MAX : REAL64_MAX;
    return { min: -max, max, isInteger: false };
  }
  if (NON_INTEGER_NUMERIC_TYPES.has(upper)) {
    return undefined;
  }

  const bits = BigInt(meta.bits);
  if (meta.signed === false) {
    const max = (1n << bits) - 1n;
    return { min: 0n, max, isInteger: true };
  }
  if (meta.signed === true) {
    const max = (1n << (bits - 1n)) - 1n;
    const min = -(1n << (bits - 1n));
    return { min, max, isInteger: true };
  }

  return undefined;
}

/**
 * Parse an IEC integer literal string to a BigInt.
 * Handles decimal, based (2#1010, 8#77, 16#FF), optional underscores
 * and an optional leading sign.
 * Returns undefined for malformed literals.
 */
export function parseIntegerLiteral(rawValue: string): bigint | undefined {
  try {
    let text = rawValue.replace(/_/g, "").trim();
    if (text.length === 0) return undefined;

    let sign = 1n;
    if (text.startsWith("+")) {
      text = text.slice(1);
    } else if (text.startsWith("-")) {
      sign = -1n;
      text = text.slice(1);
    }

    let base = 10;
    const hashIdx = text.indexOf("#");
    if (hashIdx !== -1) {
      const baseText = text.slice(0, hashIdx);
      const valText = text.slice(hashIdx + 1);
      base = parseInt(baseText, 10);
      if (!Number.isFinite(base) || base < 2 || base > 36) return undefined;
      text = valText.replace(/_/g, "");
    }

    if (text.length === 0) return undefined;

    let unsigned: bigint;
    switch (base) {
      case 2:
        unsigned = BigInt("0b" + text);
        break;
      case 8:
        unsigned = BigInt("0o" + text);
        break;
      case 10:
        unsigned = BigInt(text);
        break;
      case 16:
        unsigned = BigInt("0x" + text);
        break;
      default: {
        const parsed = parseInt(text, base);
        if (!Number.isFinite(parsed)) return undefined;
        unsigned = BigInt(parsed);
      }
    }

    return sign * unsigned;
  } catch {
    return undefined;
  }
}
