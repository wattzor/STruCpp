// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ Type Code Generator
 *
 * Generates C++ type definitions from user-defined types (TYPE...END_TYPE blocks).
 * Handles structs, enums, arrays, subranges, and type aliases.
 */

import type {
  TypeDeclaration,
  StructDefinition,
  UnionDefinition,
  EnumDefinition,
  ArrayDefinition,
  SubrangeDefinition,
  TypeReference,
  VarDeclaration,
  Expression,
  LiteralExpression,
  VariableExpression,
  BinaryExpression,
  UnaryExpression,
} from "../frontend/ast.js";
import { TypeRegistry, isElementaryType } from "../semantic/type-registry.js";
import { formatArrayType } from "./codegen-utils.js";
import {
  parseDateLiteralToDays,
  parseDtLiteralToNs,
  parseTimeLiteral,
  parseTodLiteralToNs,
} from "../project-model.js";
import {
  buildEnumMemberMap,
  type EnumMemberEntry,
} from "../semantic/type-utils.js";

/**
 * Options for type code generation
 */
export interface TypeCodeGenOptions {
  indent: string;
  lineEnding: string;
  /** Wrap each generated type's emission with `//@chunk:begin/end:type:<NAME>`
   *  marker comments. Off by default; the library compiler enables it so
   *  it can slice per-symbol chunks for tree-shaking. See
   *  `CodeGenOptions.emitChunkMarkers`. */
  emitChunkMarkers: boolean;
}

/**
 * Default type code generation options
 */
export const defaultTypeCodeGenOptions: TypeCodeGenOptions = {
  indent: "    ",
  lineEnding: "\n",
  emitChunkMarkers: false,
};

/**
 * Map IEC elementary type names to C++ type names
 */
const IEC_TO_CPP_TYPE: Record<string, string> = {
  BOOL: "BOOL_t",
  BYTE: "BYTE_t",
  WORD: "WORD_t",
  DWORD: "DWORD_t",
  LWORD: "LWORD_t",
  SINT: "SINT_t",
  INT: "INT_t",
  DINT: "DINT_t",
  LINT: "LINT_t",
  USINT: "USINT_t",
  UINT: "UINT_t",
  UDINT: "UDINT_t",
  ULINT: "ULINT_t",
  __XWORD: "XWORD_t",
  __XINT: "XINT_t",
  __UXINT: "UXINT_t",
  REAL: "REAL_t",
  LREAL: "LREAL_t",
  TIME: "TIME_t",
  DATE: "DATE_t",
  TIME_OF_DAY: "TOD_t",
  TOD: "TOD_t",
  DATE_AND_TIME: "DT_t",
  DT: "DT_t",
  LTIME: "LTIME_t",
  LDATE: "LDATE_t",
  LTOD: "LTOD_t",
  LDT: "LDT_t",
  CHAR: "CHAR_t",
  WCHAR: "WCHAR_t",
  STRING: "IECString<254>",
  WSTRING: "IECWString<254>",
};

/**
 * Map IEC elementary type names to their IECVar-wrapped C++ type names.
 * Used for struct fields and array elements that need per-element forcing.
 */
export const IEC_TO_CPP_VAR_TYPE: Record<string, string> = {
  BOOL: "IEC_BOOL",
  BYTE: "IEC_BYTE",
  WORD: "IEC_WORD",
  DWORD: "IEC_DWORD",
  LWORD: "IEC_LWORD",
  SINT: "IEC_SINT",
  INT: "IEC_INT",
  DINT: "IEC_DINT",
  LINT: "IEC_LINT",
  USINT: "IEC_USINT",
  UINT: "IEC_UINT",
  UDINT: "IEC_UDINT",
  ULINT: "IEC_ULINT",
  __XWORD: "IEC_XWORD",
  __XINT: "IEC_XINT",
  __UXINT: "IEC_UXINT",
  REAL: "IEC_REAL",
  LREAL: "IEC_LREAL",
  TIME: "IEC_TIME",
  DATE: "IEC_DATE",
  TIME_OF_DAY: "IEC_TOD",
  TOD: "IEC_TOD",
  DATE_AND_TIME: "IEC_DT",
  DT: "IEC_DT",
  LTIME: "IEC_LTIME",
  LDATE: "IEC_LDATE",
  LTOD: "IEC_LTOD",
  LDT: "IEC_LDT",
  CHAR: "IEC_CHAR",
  WCHAR: "IEC_WCHAR",
};

/**
 * Type Code Generator for user-defined types
 */
export class TypeCodeGenerator {
  private options: TypeCodeGenOptions;
  private output: string[] = [];
  /** Track known enum type names (uppercase) so struct fields can use IEC_ wrapper */
  private knownEnumNames: Set<string> = new Set();
  /** Reverse map: enum member name (upper case) → owning enum type */
  private enumMemberToType: Map<string, EnumMemberEntry> = new Map();
  /** Map of all type declarations (uppercase name → declaration) for alias resolution */
  private typeMap: Map<string, TypeDeclaration> = new Map();

  constructor(options: Partial<TypeCodeGenOptions> = {}) {
    this.options = { ...defaultTypeCodeGenOptions, ...options };
  }

  /**
   * Generate C++ type definitions from a type registry.
   * Types are generated in dependency order.
   */
  generateFromRegistry(registry: TypeRegistry): string {
    this.output = [];
    const types = registry.getTypesInDependencyOrder();
    return this.generateTypes(types);
  }

  /**
   * Generate C++ type definitions from an array of type declarations.
   * Assumes types are already in dependency order.
   */
  generateTypes(types: TypeDeclaration[]): string {
    this.output = [];
    this.knownEnumNames = new Set();
    this.typeMap = new Map(types.map((t) => [t.name.toUpperCase(), t]));

    // Build reverse map for bare enum member qualification
    this.enumMemberToType = buildEnumMemberMap(
      types
        .filter((t) => t.definition.kind === "EnumDefinition")
        .map((t) => ({
          name: t.name,
          members: (
            t.definition as import("../frontend/ast.js").EnumDefinition
          ).members.map((m) => m.name),
        })),
    );

    if (types.length === 0) {
      return "";
    }

    this.emit("// User-defined types");
    this.emit("");

    for (const type of types) {
      if (this.options.emitChunkMarkers) {
        this.emit(`//@chunk:begin:type:${type.name}`);
      }
      this.generateTypeDeclaration(type);
      if (this.options.emitChunkMarkers) {
        this.emit(`//@chunk:end:type:${type.name}`);
      }
    }

    return this.output.join(this.options.lineEnding);
  }

  /**
   * Generate a single type declaration
   */
  private generateTypeDeclaration(type: TypeDeclaration): void {
    const def = type.definition;

    switch (def.kind) {
      case "StructDefinition":
        this.generateStructType(type.name, def);
        // Struct fields already contain IECVar leaves — identity alias
        this.emit(`using IEC_${type.name} = ${type.name};`);
        this.emit("");
        break;
      case "UnionDefinition":
        this.generateUnionType(type.name, def);
        // Union variables are not IECVar-wrapped; identity alias
        this.emit(`using IEC_${type.name} = ${type.name};`);
        this.emit("");
        break;
      case "EnumDefinition":
        this.knownEnumNames.add(type.name.toUpperCase());
        this.generateEnumType(type.name, def);
        // Generate IEC_ wrapper for enum variables using IEC_ENUM
        this.emit(`using IEC_${type.name} = IEC_ENUM<${type.name}>;`);
        this.emit("");
        break;
      case "ArrayDefinition":
        this.generateArrayType(type.name, def);
        // Array elements already contain IECVar leaves — identity alias
        this.emit(`using IEC_${type.name} = ${type.name};`);
        this.emit("");
        break;
      case "SubrangeDefinition":
        this.generateSubrangeType(type.name, def);
        // Generate IEC_ wrapper aliasing to base type's wrapper
        this.generateIecWrapperForSubrange(type.name, def);
        break;
      case "TypeReference":
        this.generateTypeAlias(type.name, def);
        // Generate IEC_ wrapper aliasing to base type's wrapper
        this.generateIecWrapperForAlias(type.name, def);
        break;
    }
  }

  /**
   * Generate IEC_ wrapper for a type alias
   */
  private generateIecWrapperForAlias(name: string, def: TypeReference): void {
    const baseName = def.name.toUpperCase();
    if (isElementaryType(baseName)) {
      // Alias to elementary type - use the existing IEC_ wrapper
      this.emit(`using IEC_${name} = IEC_${baseName};`);
    } else {
      // Alias to user-defined type - use IECVar wrapper
      this.emit(`using IEC_${name} = IECVar<${name}>;`);
    }
    this.emit("");
  }

  /**
   * Generate IEC_ wrapper for a subrange type
   */
  private generateIecWrapperForSubrange(
    name: string,
    def: SubrangeDefinition,
  ): void {
    const baseName = def.baseType.name.toUpperCase();
    if (isElementaryType(baseName)) {
      // Subrange of elementary type - use the existing IEC_ wrapper
      this.emit(`using IEC_${name} = IEC_${baseName};`);
    } else {
      // Subrange of user-defined type - use IECVar wrapper
      this.emit(`using IEC_${name} = IECVar<${name}>;`);
    }
    this.emit("");
  }

  /**
   * Generate a struct type definition
   *
   * ST:
   *   MyStruct : STRUCT
   *     x : INT;
   *     y : REAL;
   *   END_STRUCT;
   *
   * C++:
   *   struct MyStruct {
   *       INT_t x;
   *       REAL_t y;
   *   };
   */
  private generateStructType(name: string, def: StructDefinition): void {
    this.emit(`struct ${name} {`);

    // Collect member C++ types so iec_byte_size can be computed with padding.
    const memberTypes: string[] = [];
    const memberNames: string[] = [];
    for (const field of def.fields) {
      let cppType: string;
      if (field.type.arrayDimensions && field.type.elementTypeName) {
        // Inline array type: emit Array1D/2D/3D<WrappedElementType, bounds...>
        const elemCpp = this.wrapReferenceKind(
          this.mapStructFieldTypeToCpp(field.type.elementTypeName),
          field.type.elementReferenceKind,
        );
        cppType = formatArrayType(elemCpp, field.type.arrayDimensions);
      } else {
        cppType = this.mapStructFieldTypeToCpp(
          field.type.name,
          field.type.maxLength,
        );
      }
      if (field.type.referenceKind === "pointer_to") {
        cppType += "*";
      }
      for (const fieldName of field.names) {
        // Mangle field name if it matches its user-defined type name
        // to avoid GCC -Wchanges-meaning error. Compare against the ST
        // type name, not cppType (which may include pointer '*' suffix).
        const emitName =
          !isElementaryType(field.type.name.toUpperCase()) &&
          fieldName.toUpperCase() === field.type.name.toUpperCase()
            ? `${fieldName}_`
            : fieldName;
        memberTypes.push(cppType);
        memberNames.push(emitName);
        if (field.initialValue) {
          const initVal = this.expressionToCpp(field.initialValue);
          // Array types can't be initialized with = 0; use {} instead
          const isArrayType = /^Array[123]D</.test(cppType);
          if (isArrayType && initVal === "0") {
            this.emit(`${this.options.indent}${cppType} ${emitName}{};`);
          } else {
            this.emit(
              `${this.options.indent}${cppType} ${emitName} = ${initVal};`,
            );
          }
        } else {
          if (field.type.referenceKind === "pointer_to") {
            this.emit(
              `${this.options.indent}${cppType} ${emitName} = nullptr;`,
            );
          } else {
            this.emit(`${this.options.indent}${cppType} ${emitName}{};`);
          }
        }
      }
    }

    if (memberTypes.length > 0) {
      this.emit(
        `${this.options.indent}static constexpr std::size_t iec_byte_size = iec_struct_size<${memberTypes.join(", ")}>::value;`,
      );
    }

    // Equality and test-only stream output helpers for ASSERT_EQ on structs.
    if (memberNames.length > 0) {
      const eqExpr = memberNames.map((n) => `${n} == other.${n}`).join(" && ");
      this.emit(
        `${this.options.indent}bool operator==(const ${name}& other) const noexcept { return ${eqExpr}; }`,
      );
      this.emit(
        `${this.options.indent}bool operator!=(const ${name}& other) const noexcept { return !(*this == other); }`,
      );
      this.emit(`${this.options.indent}#ifdef STRUCPP_TEST`);
      const streamExpr = memberNames
        .map(
          (n, i) =>
            `os << "${i === 0 ? "" : ", "}${n}=" << to_display_string(s.${n})`,
        )
        .join("; ");
      this.emit(
        `${this.options.indent}friend std::ostream& operator<<(std::ostream& os, const ${name}& s) { os << "{"; ${streamExpr}; os << "}"; return os; }`,
      );
      this.emit(`${this.options.indent}#endif`);
    }

    this.emit("};");
    this.emit("");
  }

  /**
   * Generate a union type definition.
   *
   * Union members are emitted as raw (unwrapped) C++ types so the generated
   * `union` is trivially constructible. Composite struct members are inlined
   * with raw elementary fields — this keeps all members trivial and permits
   * C-style type punning. Strings, arrays, references, pointers, FB instances,
   * and non-trivial composite members are rejected by the analyzer.
   */
  private generateUnionType(name: string, def: UnionDefinition): void {
    this.emit(`union ${name} {`);

    const memberNames: string[] = [];
    for (const field of def.fields) {
      const emitted = this.emitUnionField(field, this.options.indent);
      memberNames.push(...emitted);
    }

    if (memberNames.length > 0) {
      const sizeArgs = memberNames.map((n) => `sizeof(${n})`).join(", ");
      this.emit(
        `${this.options.indent}static constexpr std::size_t iec_byte_size = std::max({${sizeArgs}});`,
      );

      // Equality: unions share storage, so compare the raw IEC bytes.
      this.emit(
        `${this.options.indent}bool operator==(const ${name}& other) const noexcept { return std::memcmp(this, &other, iec_byte_size) == 0; }`,
      );
      this.emit(
        `${this.options.indent}bool operator!=(const ${name}& other) const noexcept { return !(*this == other); }`,
      );

      // Stream output is only needed when building test diagnostics.
      this.emit(`${this.options.indent}#ifdef STRUCPP_TEST`);
      this.emit(
        `${this.options.indent}friend std::ostream& operator<<(std::ostream& os, const ${name}&) { return os << "<union: ${name}>"; }`,
      );
      this.emit(`${this.options.indent}#endif`);
    }

    this.emit("};");
    this.emit("");
  }

  /**
   * Emit a single union field declaration. Returns the C++ names that were emitted.
   */
  private emitUnionField(field: VarDeclaration, indent: string): string[] {
    const emittedNames: string[] = [];
    const resolved = this.resolveUnionMemberType(field.type, new Set<string>());

    if (resolved.kind === "inline") {
      // Anonymous inline struct; emit a fresh anonymous struct per declared name
      for (const fieldName of field.names) {
        const emitName = this.mangleUnionFieldName(fieldName, field.type.name);
        this.emit(`${indent}struct {`);
        for (const sf of resolved.def.fields) {
          // Recursively emit each sub-field (including nested inline structs)
          this.emitUnionField(sf, `${indent}    `);
        }
        this.emit(`${indent}} ${emitName};`);
        emittedNames.push(emitName);
      }
      return emittedNames;
    }

    const cppType = resolved.cpp;
    for (const fieldName of field.names) {
      const emitName = this.mangleUnionFieldName(fieldName, field.type.name);
      this.emit(`${indent}${cppType} ${emitName};`);
      emittedNames.push(emitName);
    }
    return emittedNames;
  }

  /**
   * Resolve the C++ representation for a union member.
   * - Elementary types and enums → raw C++ scalar type string.
   * - Named unions → bare union name.
   * - Named structs (and aliases to structs) → inline definition.
   */
  private resolveUnionMemberType(
    typeRef: TypeReference,
    visited: Set<string>,
  ):
    | { kind: "scalar"; cpp: string }
    | { kind: "inline"; def: StructDefinition } {
    const upper = typeRef.name.toUpperCase();

    if (typeRef.arrayDimensions && typeRef.arrayDimensions.length > 0) {
      return { kind: "scalar", cpp: this.mapTypeToCpp(typeRef.name) };
    }

    if (upper === "STRING") {
      return { kind: "scalar", cpp: `IECString<${typeRef.maxLength ?? 254}>` };
    }
    if (upper === "WSTRING") {
      return {
        kind: "scalar",
        cpp: `IECWString<${typeRef.maxLength ?? 254}>`,
      };
    }

    if (isElementaryType(upper)) {
      return { kind: "scalar", cpp: IEC_TO_CPP_TYPE[upper] ?? typeRef.name };
    }

    if (this.knownEnumNames.has(upper)) {
      return { kind: "scalar", cpp: typeRef.name };
    }

    const decl = this.typeMap.get(upper);
    if (!decl) {
      // Unknown type — analyzer should have caught this; fallback to bare name.
      return { kind: "scalar", cpp: typeRef.name };
    }

    const def = decl.definition;

    if (def.kind === "TypeReference") {
      if (visited.has(upper)) {
        return { kind: "scalar", cpp: typeRef.name };
      }
      visited.add(upper);
      const aliased: TypeReference = { ...typeRef, name: def.name };
      const aliasMaxLength =
        typeRef.maxLength ??
        (typeof def.maxLength === "number" ? def.maxLength : undefined);
      if (aliasMaxLength !== undefined) {
        aliased.maxLength = aliasMaxLength;
      }
      return this.resolveUnionMemberType(aliased, visited);
    }

    if (def.kind === "EnumDefinition") {
      return { kind: "scalar", cpp: typeRef.name };
    }

    if (def.kind === "UnionDefinition") {
      return { kind: "scalar", cpp: typeRef.name };
    }

    if (def.kind === "StructDefinition") {
      return { kind: "inline", def };
    }

    return { kind: "scalar", cpp: typeRef.name };
  }

  /**
   * Mangle a union field name when it matches its user-defined type name,
   * matching the struct-field mangling convention.
   */
  private mangleUnionFieldName(fieldName: string, typeName: string): string {
    const fieldUpper = fieldName.toUpperCase();
    const typeUpper = typeName.toUpperCase();
    if (!isElementaryType(typeUpper) && fieldUpper === typeUpper) {
      return `${fieldName}_`;
    }
    return fieldName;
  }

  /**
   * Generate an enum type definition
   *
   * Simple enum:
   *   TrafficLight : (RED, YELLOW, GREEN);
   * C++:
   *   enum class TrafficLight { RED, YELLOW, GREEN };
   *
   * Typed enum with explicit values:
   *   State : INT (IDLE := 0, RUNNING := 1, STOPPED := 2);
   * C++:
   *   enum class State : INT_t { IDLE = 0, RUNNING = 1, STOPPED = 2 };
   */
  private generateEnumType(name: string, def: EnumDefinition): void {
    const baseType = def.baseType
      ? ` : ${this.mapTypeToCpp(def.baseType.name)}`
      : "";

    const members = def.members.map((member) => {
      if (member.value) {
        const val = this.expressionToCpp(member.value);
        return `${member.name} = ${val}`;
      }
      return member.name;
    });

    this.emit(`enum class ${name}${baseType} { ${members.join(", ")} };`);
    this.emit("");
  }

  /**
   * Generate an array type definition
   *
   * ST:
   *   IntArray : ARRAY[0..9] OF INT;
   *   Matrix : ARRAY[0..2, 0..2] OF REAL;
   *   OffsetArray : ARRAY[3..7] OF INT;
   *
   * C++:
   *   using IntArray = Array1D<INT_t, 0, 9>;
   *   using Matrix = Array2D<REAL_t, 0, 2, 0, 2>;
   *   using OffsetArray = Array1D<INT_t, 3, 7>;
   *
   * Uses Array1D/2D/3D templates which preserve index bounds for proper
   * IEC 61131-3 array semantics (arrays can have arbitrary start indices).
   */
  private generateArrayType(name: string, def: ArrayDefinition): void {
    const elementType = this.wrapReferenceKind(
      this.mapStructFieldTypeToCpp(
        def.elementType.name,
        def.elementType.maxLength,
      ),
      def.elementType.referenceKind,
    );
    const numDims = def.dimensions.length;

    // Collect bounds for all dimensions (skip variable-length dimensions)
    const bounds: Array<{ start: number; end: number }> = [];
    for (const dim of def.dimensions) {
      if (dim && !dim.isVariableLength && dim.start && dim.end) {
        const start = this.evaluateConstantExpression(dim.start);
        const end = this.evaluateConstantExpression(dim.end);
        bounds.push({ start, end });
      }
    }

    // Generate appropriate Array template based on dimensions
    let cppType: string;
    if (numDims <= 3 && bounds.length === numDims) {
      cppType = formatArrayType(elementType, bounds);
    } else {
      // Fallback for higher dimensions: use nested std::array (loses bounds info)
      // This maintains backwards compatibility but loses arbitrary index support
      cppType = elementType;
      for (let i = def.dimensions.length - 1; i >= 0; i--) {
        const dim = def.dimensions[i];
        if (dim && !dim.isVariableLength && dim.start && dim.end) {
          const start = this.evaluateConstantExpression(dim.start);
          const end = this.evaluateConstantExpression(dim.end);
          const size = end - start + 1;
          cppType = `std::array<${cppType}, ${size}>`;
        }
      }
    }

    this.emit(`using ${name} = ${cppType};`);
    this.emit("");
  }

  /**
   * Generate a subrange type definition
   *
   * ST:
   *   Percentage : INT(0..100);
   *
   * C++:
   *   using Percentage = INT_t;
   *
   * Note: Runtime bounds checking would be implemented separately.
   * For now, we just create a type alias.
   */
  private generateSubrangeType(name: string, def: SubrangeDefinition): void {
    const baseType = this.mapTypeToCpp(def.baseType.name);
    const lower = this.expressionToCpp(def.lowerBound);
    const upper = this.expressionToCpp(def.upperBound);

    this.emit(`using ${name} = ${baseType};`);
    this.emit(`constexpr ${baseType} ${name}_MIN = ${lower};`);
    this.emit(`constexpr ${baseType} ${name}_MAX = ${upper};`);
    this.emit("");
  }

  /**
   * Generate a type alias
   *
   * ST:
   *   MyInt : INT;
   *
   * C++:
   *   using MyInt = INT_t;
   */
  private generateTypeAlias(name: string, def: TypeReference): void {
    let cppType: string;
    if (def.arrayDimensions && def.elementTypeName) {
      // POINTER TO ARRAY[...] OF T — use array template
      const elemCpp = this.mapTypeToCpp(def.elementTypeName);
      cppType = formatArrayType(elemCpp, def.arrayDimensions);
    } else {
      cppType = this.mapTypeToCpp(def.name);
    }
    if (def.referenceKind === "pointer_to") {
      cppType += "*";
    }
    this.emit(`using ${name} = ${cppType};`);
    this.emit("");
  }

  /**
   * Map an IEC type name to its C++ equivalent (raw/unwrapped)
   */
  mapTypeToCpp(typeName: string): string {
    const upperName = typeName.toUpperCase();

    if (isElementaryType(upperName)) {
      return IEC_TO_CPP_TYPE[upperName] ?? `${upperName}_t`;
    }

    return typeName;
  }

  /**
   * Resolve a type name to an elementary base, following aliases and subranges.
   * Returns the elementary base name and any STRING/WSTRING maxLength, or
   * undefined when the chain ends in a composite, enum, pointer, or unknown.
   */
  private resolveElementaryAlias(
    typeName: string,
    visited = new Set<string>(),
  ): { name: string; maxLength?: number | string } | undefined {
    const upper = typeName.toUpperCase();
    if (visited.has(upper)) return undefined;
    visited.add(upper);

    if (isElementaryType(upper)) {
      return { name: typeName };
    }

    const decl = this.typeMap.get(upper);
    const def = decl?.definition;
    if (!def) return undefined;

    if (def.kind === "TypeReference") {
      const ref = def;
      if (ref.referenceKind && ref.referenceKind !== "none") {
        return undefined;
      }
      const resolved = this.resolveElementaryAlias(ref.name, visited);
      if (!resolved) return undefined;
      if (ref.maxLength !== undefined) {
        return { ...resolved, maxLength: ref.maxLength };
      }
      return resolved;
    }

    if (def.kind === "SubrangeDefinition") {
      const sub = def;
      return this.resolveElementaryAlias(sub.baseType.name, visited);
    }

    return undefined;
  }

  /**
   * Map a type name to its IECVar-wrapped C++ equivalent for struct fields
   * and array elements. Wraps elementary types with IECVar for per-field forcing.
   * Composites (structs, arrays, FBs) use bare names since their fields
   * already contain IECVar leaves.
   */
  mapStructFieldTypeToCpp(
    typeName: string,
    maxLength?: number | string,
  ): string {
    const upperName = typeName.toUpperCase();

    // Resolve TYPE aliases / subranges to elementary (including STRING/WSTRING
    // with maxLength) so fields like `field : MyInt` are stored as `IEC_INT`,
    // not the bare alias `INT_t`.
    const aliasBase = this.resolveElementaryAlias(typeName);
    if (aliasBase) {
      const baseUpper = aliasBase.name.toUpperCase();
      if (baseUpper === "STRING" || baseUpper === "WSTRING") {
        const len = aliasBase.maxLength ?? maxLength ?? 254;
        return baseUpper === "STRING"
          ? `IECStringVar<${len}>`
          : `IECWStringVar<${len}>`;
      }
      return IEC_TO_CPP_VAR_TYPE[baseUpper] ?? `IEC_${baseUpper}`;
    }

    // Enum types → IEC_<Name> (resolves to IEC_ENUM<Name> via alias)
    if (this.knownEnumNames.has(upperName)) {
      return `IEC_${typeName}`;
    }

    // Composite types (struct, array, FB) → bare name
    return typeName;
  }

  /**
   * Wrap a C++ type with IEC pointer/reference wrappers for the given reference kind.
   */
  private wrapReferenceKind(cppType: string, referenceKind?: string): string {
    switch (referenceKind) {
      case "pointer_to":
        return `IEC_Ptr<${cppType}>`;
      case "ref_to":
        return `IEC_REF_TO<${cppType}>`;
      case "reference_to":
        return `IEC_REFERENCE_TO<${cppType}>`;
      default:
        return cppType;
    }
  }

  /**
   * Convert an AST expression to C++ code
   */
  private expressionToCpp(expr: Expression): string {
    switch (expr.kind) {
      case "LiteralExpression":
        return this.literalToCpp(expr);
      case "VariableExpression":
        return this.variableToCpp(expr);
      case "BinaryExpression":
        return this.binaryExprToCpp(expr);
      case "UnaryExpression":
        return this.unaryExprToCpp(expr);
      case "ParenthesizedExpression":
        return `(${this.expressionToCpp(expr.expression)})`;
      case "FunctionCallExpression":
        return `${expr.functionName}()`;
      default:
        return "0";
    }
  }

  private literalToCpp(expr: LiteralExpression): string {
    switch (expr.literalType) {
      case "BOOL":
        return expr.value === true ? "true" : "false";
      case "STRING": {
        // IEC STRING literals carry their surrounding single quotes
        // in `rawValue` (`'wide hello'`); strip them before wrapping
        // in C++ double quotes — otherwise we end up with `"'…'"`.
        const inner = expr.rawValue.replace(/^'|'$/g, "");
        return `"${inner}"`;
      }
      case "WSTRING": {
        // IEC WSTRING literals are double-quoted; strip either form
        // for safety. The C++ prefix is `u` (char16_t) — `L"…"`
        // (wchar_t) is 32-bit on Linux/AVR and wouldn't bind to
        // IECWStringVar's char16_t* ctor.
        const inner = expr.rawValue.replace(/^["']|["']$/g, "");
        return `u"${inner}"`;
      }
      case "TIME": {
        const timeVal = parseTimeLiteral(String(expr.value));
        return `${timeVal.nanoseconds}LL`;
      }
      case "DATE":
        return `${parseDateLiteralToDays(String(expr.value))}LL`;
      case "TIME_OF_DAY":
        return `${parseTodLiteralToNs(String(expr.value))}LL`;
      case "DATE_AND_TIME":
        return `${parseDtLiteralToNs(String(expr.value))}LL`;
      default:
        return String(expr.value);
    }
  }

  private variableToCpp(expr: VariableExpression): string {
    let result = expr.name;
    const nameUpper = expr.name.toUpperCase();

    // Bare enum member: Stopped → Irrigation_State::Stopped
    const enumEntry = this.enumMemberToType.get(nameUpper);
    if (enumEntry?.typeName && expr.fieldAccess.length === 0) {
      return `${enumEntry.typeName}::${expr.name}`;
    }

    // Enum qualified access: TrafficState.RED → TrafficState::RED
    if (this.knownEnumNames.has(nameUpper) && expr.fieldAccess.length === 1) {
      return `${expr.name}::${expr.fieldAccess[0]}`;
    }

    for (const subscript of expr.subscripts) {
      result += `[${this.expressionToCpp(subscript)}]`;
    }

    for (const field of expr.fieldAccess) {
      result += `.${field}`;
    }

    if (expr.isDereference) {
      result = `*${result}`;
    }

    return result;
  }

  private binaryExprToCpp(expr: BinaryExpression): string {
    const left = this.expressionToCpp(expr.left);
    const right = this.expressionToCpp(expr.right);

    const opMap: Record<string, string> = {
      "+": "+",
      "-": "-",
      "*": "*",
      "/": "/",
      MOD: "%",
      "**": "/* pow */",
      AND: "&&",
      OR: "||",
      XOR: "^",
      "=": "==",
      "<>": "!=",
      "<": "<",
      ">": ">",
      "<=": "<=",
      ">=": ">=",
    };

    const cppOp = opMap[expr.operator] ?? expr.operator;
    return `${left} ${cppOp} ${right}`;
  }

  private unaryExprToCpp(expr: UnaryExpression): string {
    const operand = this.expressionToCpp(expr.operand);

    const opMap: Record<string, string> = {
      NOT: "!",
      "-": "-",
      "+": "+",
    };

    const cppOp = opMap[expr.operator] ?? expr.operator;
    return `${cppOp}${operand}`;
  }

  /**
   * Evaluate a constant expression to a number.
   * Used for array dimension calculations.
   */
  private evaluateConstantExpression(expr: Expression): number {
    switch (expr.kind) {
      case "LiteralExpression":
        if (typeof expr.value === "number") {
          return expr.value;
        }
        return parseInt(String(expr.value), 10) || 0;
      case "UnaryExpression":
        if (expr.operator === "-") {
          return -this.evaluateConstantExpression(expr.operand);
        }
        return this.evaluateConstantExpression(expr.operand);
      case "BinaryExpression": {
        const left = this.evaluateConstantExpression(expr.left);
        const right = this.evaluateConstantExpression(expr.right);
        switch (expr.operator) {
          case "+":
            return left + right;
          case "-":
            return left - right;
          case "*":
            return left * right;
          case "/":
            return Math.floor(left / right);
          case "MOD":
            return left % right;
          default:
            return 0;
        }
      }
      default:
        return 0;
    }
  }

  /**
   * Emit a line of output
   */
  private emit(line: string): void {
    this.output.push(line);
  }
}

/**
 * Generate C++ type definitions from a type registry
 */
export function generateTypeCode(
  registry: TypeRegistry,
  options?: Partial<TypeCodeGenOptions>,
): string {
  const generator = new TypeCodeGenerator(options);
  return generator.generateFromRegistry(registry);
}
