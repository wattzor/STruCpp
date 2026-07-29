// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ Code Generator
 *
 * Generates C++ code from the typed AST or IR.
 * Produces readable, debuggable C++ that maintains line correspondence with ST source.
 */

import type {
  CompilationUnit,
  VarDeclaration,
  Statement,
  Expression,
  AssignmentStatement,
  RefAssignStatement,
  IfStatement,
  CaseStatement,
  ForStatement,
  WhileStatement,
  RepeatStatement,
  FunctionCallExpression,
  Argument,
  MethodCallExpression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  VariableExpression,
  VarInfoExpression,
  AccessStep,
  ExternalCodePragma,
  MethodDeclaration,
  InterfaceDeclaration,
  PropertyDeclaration,
  QueryInterfaceExpression,
  Visibility,
  ReferenceKind,
  IECType,
  ElementaryType,
  ArrayType,
  VarBlock,
} from "../frontend/ast.js";
import type { SymbolTables } from "../semantic/symbol-table.js";
import type { LineMapEntry } from "../types.js";
import {
  StdFunctionRegistry,
  type StdFunctionDescriptor,
} from "../semantic/std-function-registry.js";
import type {
  ProjectModel,
  ConfigurationDecl,
  ProgramDecl,
} from "../project-model.js";
import type {
  LibraryChunk,
  StlibArchive,
} from "../library/library-manifest.js";
import {
  getProjectNamespace,
  parseDateLiteralToDays,
  parseDtLiteralToNs,
  parseTimeLiteral,
  parseTodLiteralToNs,
} from "../project-model.js";
import { isElementaryType, TypeRegistry } from "../semantic/type-registry.js";
import {
  resolveTypeClass,
  TYPE_CLASS,
  TYPE_CLASS_NAME,
  getSystemType,
} from "../semantic/system-types.js";
import { TypeCodeGenerator, IEC_TO_CPP_VAR_TYPE } from "./type-codegen.js";
import { formatArrayType, iecBaseToCppLiteral } from "./codegen-utils.js";
import {
  getTypeBits,
  getTypeCategory,
  isImplicitlyConvertible,
  resolveFieldType as resolveFieldTypeUtil,
  resolveArrayElementType,
  typeName as typeNameUtil,
  buildEnumMemberMap,
  isGenericTypeName,
  type EnumMemberEntry,
  ELEMENTARY_TYPES,
  getHarmonizableRange,
  shouldHarmonizeStdFuncArgs,
  isBareLiteral,
  resolveHarmonizedCommonType,
  resolveSelectionCommonType,
  stdFuncReturnsCommonType,
} from "../semantic/type-utils.js";
import { isEnEnoArgument } from "../ast-utils.js";

// =============================================================================
// Located Variable Support
// =============================================================================

/**
 * Information about a located variable for code generation.
 */
interface LocatedVarDescriptor {
  varName: string;
  cppName: string;
  address: string;
  area: "Input" | "Output" | "Memory";
  size: "Bit" | "Byte" | "Word" | "DWord" | "LWord";
  byteIndex: number;
  bitIndex: number;
  typeName: string;
  programName: string;
  /** True when the C++ variable is a GlobalVar<V> wrapper (project-model VAR_GLOBAL). */
  isGlobalVarWrapper: boolean;
}

/**
 * Parse a located variable address and return descriptor info.
 */
function parseLocatedAddress(address: string): {
  area: "Input" | "Output" | "Memory";
  size: "Bit" | "Byte" | "Word" | "DWord" | "LWord";
  byteIndex: number;
  bitIndex: number;
} | null {
  // Concrete: %IX0.0, %QW10, %MD100
  // Placeholder (bound later by VAR_CONFIG or the OpenPLC I/O layer): %I*, %QX*
  const match = address.match(/^%([IQM])([XBWDL]?)(?:(\d+)(?:\.(\d+))?|\*)$/i);
  if (!match) return null;

  const areaChar = match[1]!.toUpperCase();
  const sizeChar = match[2]?.toUpperCase() || "X";
  const isPlaceholder = match[3] === undefined;
  const byteIndex = isPlaceholder ? 0 : parseInt(match[3]!, 10);
  const bitIndex = isPlaceholder ? 0 : match[4] ? parseInt(match[4], 10) : 0;

  const areaMap: Record<string, "Input" | "Output" | "Memory"> = {
    I: "Input",
    Q: "Output",
    M: "Memory",
  };

  const sizeMap: Record<string, "Bit" | "Byte" | "Word" | "DWord" | "LWord"> = {
    X: "Bit",
    B: "Byte",
    W: "Word",
    D: "DWord",
    L: "LWord",
  };

  const area = areaMap[areaChar];
  const size = sizeMap[sizeChar];

  if (!area || !size) return null;

  return {
    area,
    size,
    byteIndex,
    bitIndex,
  };
}

// =============================================================================
// Code Generation Options
// =============================================================================

/**
 * Options for code generation.
 */
export interface CodeGenOptions {
  /** Include #line directives for debugging */
  lineDirectives: boolean;

  /** Include ST source as comments */
  sourceComments: boolean;

  /** Indentation string (default: 4 spaces) */
  indent: string;

  /** Line ending (default: \n) */
  lineEnding: string;

  /** Header filename to use in #include directive (default: "generated.hpp") */
  headerFileName: string;

  /** Additional library headers to include in the generated header */
  libraryHeaders: string[];

  /** Extra `#include "..."` lines to emit at the top of every per-POU
   *  translation unit (after the shared header include). Used by the
   *  editor to plumb in `c_blocks.h` so POU bodies that reference
   *  user-defined C/C++ block structs and extern functions resolve. */
  pouIncludes: string[];

  /** Whether this is a test build (adds mock infrastructure to FB classes) */
  isTestBuild: boolean;

  /** Global constants injected as constexpr into the header preamble (before namespace) */
  globalConstants: Record<string, number>;

  /** ST source filename for #line directives (default: "main.st") */
  fileName: string;

  /** Override filename used in #line directives (absolute path for debugger).
   *  Falls back to fileName when not set. */
  lineDirectiveFileName?: string;

  /** Emit `//@chunk:begin/end:<kind>:<NAME>` comment markers around each
   *  top-level declaration in both header and cpp output. The library
   *  compiler uses these to slice emitted code into per-symbol chunks
   *  for function-level tree-shaking. Off by default — production
   *  compiles produce identical output regardless. */
  emitChunkMarkers?: boolean;
}

/**
 * Numeric and bit-string targets for the `TO_*` family — i.e. every
 * elementary type whose runtime representation is "just an integer or
 * a float."  Used by `wrapTemporalArgForNumericConversion` to gate
 * the temporal→ms scaling: STRING / WSTRING and temporal targets need
 * different handling and stay out of this set.
 */
const NUMERIC_OR_BIT_CONVERSION_TARGETS = new Set([
  "BOOL",
  "SINT",
  "INT",
  "DINT",
  "LINT",
  "USINT",
  "UINT",
  "UDINT",
  "ULINT",
  "REAL",
  "LREAL",
  "BYTE",
  "WORD",
  "DWORD",
  "LWORD",
]);

/**
 * Default code generation options.
 */
export const defaultCodeGenOptions: CodeGenOptions = {
  lineDirectives: false,
  sourceComments: true,
  indent: "    ",
  lineEnding: "\n",
  headerFileName: "generated.hpp",
  libraryHeaders: [],
  pouIncludes: [],
  isTestBuild: false,
  globalConstants: {},
  fileName: "main.st",
};

// =============================================================================
// Code Generation Result
// =============================================================================

/**
 * Result of code generation.
 */
export interface CodeGenResult {
  /**
   * One emit bucket per output file. Always contains
   * `configuration.cpp` (library preambles, located-var defs,
   * configuration glue) plus one `pou_<NAME>.cpp` per program/FB/
   * function. The single-string `cppCode` is the legacy concatenated
   * view — derived from this map by the public `compile()` wrapper.
   */
  cppFiles: Array<{ name: string; content: string }>;

  /** Generated C++ implementation code (concatenation of cppFiles). */
  cppCode: string;

  /** Generated C++ header code */
  headerCode: string;

  /** Line mapping from ST to C++ implementation lines */
  lineMap: Map<number, LineMapEntry>;

  /** Line mapping from ST to C++ header lines */
  headerLineMap: Map<number, LineMapEntry>;

  /** Warnings emitted during code generation */
  warnings: Array<{
    message: string;
    line?: number;
    column?: number;
    file?: string;
    code?: string;
  }>;

  /** Errors emitted during code generation */
  errors: Array<{
    message: string;
    line?: number;
    column?: number;
    file?: string;
    code?: string;
  }>;
}

// =============================================================================
// Code Generator
// =============================================================================

/**
 * C++ code generator for IEC 61131-3 programs.
 */
export class CodeGenerator {
  private options: CodeGenOptions;

  /**
   * One emit bucket per output .cpp file. The codegen splits POU
   * implementations across files so the runtime build can run
   * `make -j$(nproc)` and ccache can keep .o files for unchanged
   * POUs across rebuilds. `output` always points at the bucket for
   * the currently-active file; `setOutputFile` swaps it. The
   * bucket map preserves insertion order, which determines emit
   * order for the legacy `cppCode` concatenation.
   */
  private outputFiles: Map<string, string[]> = new Map();
  protected output: string[] = []; // currently-active bucket
  private currentLine = 1; // line counter within currently-active file

  private headerOutput: string[] = [];
  private lineMap: Map<number, LineMapEntry> = new Map();
  private headerLineMap: Map<number, LineMapEntry> = new Map();
  private currentHeaderLine = 1;
  private projectModel?: ProjectModel;

  /** Track located variables for descriptor array generation */
  private locatedVars: LocatedVarDescriptor[] = [];

  /** UPPER(names) of the current PROGRAM's VAR_EXTERNAL globals. Non-empty only
   *  while emitting a program body; access to these is rewritten to go through
   *  the GlobalVar pointer (g->read() / g->write() / g->with_lock()). */
  private programExternals: Set<string> = new Set();

  /** UPPER(names) of the current PROGRAM's VAR_EXTERNAL globals whose type is
   *  NOT elementary (struct / array / function-block). Subset of
   *  programExternals. Scalar externals get full read()/write() codegen;
   *  composite externals can be declared + debugged but their in-body access is
   *  gated here (fail-loud) until locked field/element/call codegen lands. */
  private compositeExternals: Set<string> = new Set();

  /** Track retain variables per program for table generation */
  private programRetainVars: Map<
    string,
    Array<{ name: string; typeName: string }>
  > = new Map();

  /** Store AST for looking up program bodies when using project model */
  protected ast?: CompilationUnit;

  /** Current function name (for redirecting function name := to result variable) */
  private currentFunctionName: string | undefined;

  /** True when the current method returns REFERENCE TO a user-defined type,
   *  so REF= on the method name lowers to a pointer assignment. */
  private currentFunctionReturnsReferenceToUserDefined: boolean = false;

  /** Standard function registry for name mapping and conversion resolution */
  private stdRegistry: StdFunctionRegistry;

  /** Warnings collected during code generation */
  private codegenWarnings: Array<{
    message: string;
    line?: number;
    column?: number;
    file?: string;
    code?: string;
  }> = [];

  /** Errors collected during code generation */
  private codegenErrors: Array<{
    message: string;
    line?: number;
    column?: number;
    file?: string;
    code?: string;
  }> = [];

  /** Counter for generating unique temporary variable names */
  private tempVarCounter = 0;

  /** Counter for generating unique __VARINFO descriptor identifiers */
  private varInfoCounter = 0;

  /** Stable symbol-to-id map for deterministic synthetic byte addresses */
  private varInfoSymbolIds = new Map<string, number>();

  /** Cache descriptor names by symbol so two __VARINFO(x) calls share one descriptor */
  private varInfoDescriptorCache = new Map<string, string>();

  /**
   * Stack of loop exit labels for EXIT codegen. C++ `break` only escapes the
   * innermost switch/loop, so `EXIT` inside a `CASE` nested in a loop must
   * goto past the loop instead. Each loop pushes a fresh label; an inner
   * `EXIT` records `used=true` so the closing emitter only writes the label
   * when something jumps to it.
   */
  private loopExitLabelStack: Array<{ name: string; used: boolean }> = [];
  private loopExitLabelCounter = 0;

  /** Current statement indent level (set by generateStatement before expression generation) */
  private currentStatementIndent = "    ";

  /** Set of known function block type names (upper case) for FB instance detection */
  protected knownFBTypes: Set<string> = new Set();

  /** Set of known interface type names (upper case) */
  protected knownInterfaceTypes: Set<string> = new Set();

  /** Set of known struct/UDT type names (upper case) */
  protected knownStructTypes: Set<string> = new Set();

  /** Map of enum type name (upper case) → set of member names (upper case) for :: emission */
  protected enumTypeMembers: Map<string, Set<string>> = new Map();

  /** Reverse map: enum member name (upper case) → owning enum type (for bare enum qualification) */
  protected enumMemberToType: Map<string, EnumMemberEntry> = new Map();

  /** Library FB field type map: "FBNAME.FIELDNAME" → type name (for field mangling in test codegen) */
  private libraryFBFieldTypes: Map<string, string> = new Map();

  /** Extended type metadata for library FB fields (array dims, reference kind) */
  private libraryFBFieldTypeRefs: Map<
    string,
    {
      arrayDimensions?: Array<{ start: number; end: number }>;
      elementTypeName?: string;
      referenceKind?: string;
    }
  > = new Map();

  /** Set of known program type names (upper case) for program invocation detection */
  protected knownProgramTypes: Set<string> = new Set();

  /** Map of variable name (upper case) → type name (original case) for current scope */
  protected currentScopeVarTypes: Map<string, string> = new Map();

  /** Map of variable name (upper case) → referenceKind ("ref_to" | "reference_to"
   *  | "pointer_to") for current scope. Only reference/pointer vars are present;
   *  used e.g. to pick the correct lowering for a REF= rebind. */
  protected currentScopeVarRefKinds: Map<string, string> = new Map();

  /** Set of VAR_IN_OUT FB-instance member names (upper case) in the current scope.
   *  These are emitted as C++ pointers and must be dereferenced when used as objects. */
  private currentScopeInoutFBPointers: Set<string> = new Set();

  /** Set of VAR_IN_OUT array member names (upper case) in the current scope.
   *  These are emitted as pointers to Array1D and must be dereferenced before indexing. */
  private currentScopeInoutArrayPointers: Set<string> = new Set();

  /** Set of local/member array variable names (upper case) in the current scope.
   *  Used by generatePointerExpression to emit the address of the whole array. */
  private currentScopeVarIsArray: Set<string> = new Set();

  /** Parent class name of current FB (for SUPER resolution) */
  private currentFBExtends: string | undefined;

  /** When generating a method that returns an interface type, assignments to the
   *  result variable should be converted to return statements */
  private interfaceReturnMethod = false;

  /** Map of UPPER(typeName).UPPER(methodName) → declared method name for case normalization */
  protected methodNameMap: Map<string, string> = new Map();

  /** Map of UPPER(interfaceName) → Set of UPPER(methodName) for variable/method collision detection */
  protected interfaceMethodsByInterface: Map<string, Set<string>> = new Map();

  /** Map of UPPER(typeName).UPPER(propName) → declared property name for property access codegen */
  protected propertyNameMap: Map<string, string> = new Map();

  /** Current FB name (set during generateFBImplementation for property resolution) */
  private currentFBName: string | undefined;

  /** Mapping of VAR_INST names (upper case) to mangled class member names */
  private varInstMangledNames: Map<string, string> = new Map();

  /** Mapping of member names (upper case) that collide with their type name
   *  or interface method names to mangled names (e.g., SENSOR → SENSOR_) */
  private memberMangledNames: Map<string, string> = new Map();

  /** Interface method names for the current FB (UPPER case), used for variable/method collision detection */
  private currentFBInterfaceMethods: Set<string> = new Set();

  /** Map of UPPER(fbName) → Set of UPPER(interfaceMethodName) for external field access mangling */
  protected fbInterfaceMethodNames: Map<string, Set<string>> = new Map();

  /** Current FB's var blocks, kept so method scopes can see FB member types */
  private currentFBVarBlocks: CompilationUnit["programs"][0]["varBlocks"] = [];

  /** Topologically sorted function blocks (computed once in generate(), used by header + impl) */
  private sortedFBs: CompilationUnit["functionBlocks"] = [];

  /** Per-archive reachable-chunk emission state.
   *
   *  Built by `addLibraryChunks` — one entry per library the consumer
   *  pulled at least one chunk from. The emission loop iterates this
   *  in insertion order (= the order index.ts hands archives over,
   *  which is library load order). For each library, only chunks
   *  whose name appears in `reachable` are emitted; the array order
   *  matches the library's `chunks[]` declaration order so symbol
   *  layout in the user's `generated.hpp` is stable across builds. */
  private libraryEmissions: Array<{
    archive: StlibArchive;
    reachable: Set<string>;
  }> = [];

  /** Map of UPPER(fbTypeName) → ordered VAR_INPUT parameter names (UPPER case).
   *  Used to resolve positional arguments in FB invocations. */
  protected fbInputParams: Map<string, string[]> = new Map();

  /** Map of UPPER(fbTypeName) → set of VAR_IN_OUT parameter names (UPPER case). */
  protected fbInoutParams: Map<string, Set<string>> = new Map();

  /** Map of UPPER(fbTypeName).UPPER(paramName) → declared type name for VAR_IN_OUT parameters. */
  protected fbInoutParamTypes: Map<string, string> = new Map();

  /** Map of UPPER(fbTypeName).UPPER(paramName) → true if the VAR_IN_OUT parameter is an array. */
  protected fbInoutParamIsArray: Map<string, boolean> = new Map();

  // IEC_TYPE_BITS and IEC_TYPE_CAT removed — use getTypeBits()/getTypeCategory() from type-utils.ts

  constructor(
    private readonly _symbolTables?: SymbolTables,
    options: Partial<CodeGenOptions> = {},
  ) {
    this.options = { ...defaultCodeGenOptions, ...options };
    this.stdRegistry = new StdFunctionRegistry();
  }

  /** TypeCodeGenerator instance for type mapping */
  private typeCodeGen = new TypeCodeGenerator();

  /** Get symbol tables (for future use in Phase 3+) */
  get symbolTables(): SymbolTables {
    if (!this._symbolTables) {
      throw new Error("SymbolTables not available (test codegen mode)");
    }
    return this._symbolTables;
  }

  /**
   * Map a variable type name to its C++ type string.
   * Handles VLA synthetic names (__VLA_1D_INT → ArrayView1D<INT_t>)
   * and regular types (INT → IEC_INT).
   */
  protected mapVarTypeToCpp(
    typeName: string,
    maxLength?: number | string,
  ): string {
    // CODESYS generic type groups (ANY, ANY_BIT, ANY_NUM, ...) are passed as the
    // runtime AnyType descriptor (TYPECLASS, PVALUE, DISIZE) and manipulated
    // through their fields inside the POU.
    const upperTypeName = typeName.toUpperCase();
    if (isGenericTypeName(upperTypeName)) {
      return "strucpp::AnyType";
    }

    // CODESYS __SYSTEM enum types: __SYSTEM.TYPE_CLASS → IEC_TYPE_CLASS
    const systemCpp = this.mapSystemTypeToCpp(typeName);
    if (systemCpp) return systemCpp;

    // Handle VLA synthetic names: __VLA_{ndims}D_{elementType}
    // Use IECVar-wrapped types to match concrete Array1D<IEC_T, ...> elements
    const vlaMatch = typeName.match(/^__VLA_(\d+)D_(.+)$/);
    if (vlaMatch) {
      const ndims = vlaMatch[1];
      const elemType = this.mapVarTypeToCpp(vlaMatch[2]!);
      return `ArrayView${ndims}D<${elemType}>`;
    }
    // Handle parameterized STRING(n) / WSTRING(n) / STRING(CONSTANT_NAME)
    if (maxLength !== undefined) {
      const upper = typeName.toUpperCase();
      if (upper === "STRING") {
        return `IECStringVar<${maxLength}>`;
      }
      if (upper === "WSTRING") {
        return `IECWStringVar<${maxLength}>`;
      }
    }
    // User-defined types fall into two camps:
    //   1. FBs / interfaces / structs / arrays — fields already wrap leaves
    //      in IECVar internally, so the bare class name is used directly.
    //   2. Enums (`enum class`) — the raw C++ enum has no value_/forced_/
    //      forced_value_ layout, so the debugger's `read_impl<int16_t>`
    //      cast walks past the 2-byte enum into adjacent memory and
    //      returns garbage when nearby variables are forced. Use the
    //      `IEC_<name>` wrapper (= `IEC_ENUM<name>`) so enum-typed fields
    //      have proper IECVar shape with forcing support.
    if (this.isUserDefinedType(typeName)) {
      // Programs use Program_NAME class naming convention
      if (this.knownProgramTypes.has(typeName.toUpperCase())) {
        return `Program_${typeName}`;
      }
      if (this.enumTypeMembers.has(typeName.toUpperCase())) {
        return `IEC_${typeName}`;
      }
      // Interface-typed variables are reference/pointer types in CODESYS.
      if (this.knownInterfaceTypes.has(typeName.toUpperCase())) {
        return `${typeName}*`;
      }
      // TYPE aliases / subranges that resolve to an elementary base need the
      // IECVar-wrapped storage type (e.g. MyInt -> IEC_INT), not the bare alias
      // (INT_t), so REPL/forcing overlays line up.
      const aliasBase = this.resolveElementaryAlias(typeName);
      if (aliasBase) {
        const baseUpper = aliasBase.name.toUpperCase();
        if (baseUpper === "STRING" && aliasBase.maxLength !== undefined) {
          return `IECStringVar<${aliasBase.maxLength}>`;
        }
        if (baseUpper === "WSTRING" && aliasBase.maxLength !== undefined) {
          return `IECWStringVar<${aliasBase.maxLength}>`;
        }
        return IEC_TO_CPP_VAR_TYPE[baseUpper] ?? `IEC_${baseUpper}`;
      }
      return typeName;
    }
    // Elementary types: use the canonical IECVar alias map so names whose
    // wrapper isn't simply `IEC_<NAME>` (e.g. __XWORD → IEC_XWORD) resolve
    // correctly; all standard types map to `IEC_<NAME>` as before.
    return IEC_TO_CPP_VAR_TYPE[typeName.toUpperCase()] ?? `IEC_${typeName}`;
  }

  /**
   * Map CODESYS __SYSTEM enum type names to their IEC_ENUM wrapper.
   * Accepts both "__SYSTEM.TYPE_CLASS" and bare "TYPE_CLASS" forms.
   */
  private mapSystemTypeToCpp(typeName: string): string | undefined {
    const upper = typeName.toUpperCase();
    const suffix = upper.startsWith("__SYSTEM.")
      ? upper.slice("__SYSTEM.".length)
      : upper;
    if (suffix === "TYPE_CLASS") return "IEC_TYPE_CLASS";
    if (suffix === "MEMORY_AREA") return "IEC_MEMORY_AREA";
    if (suffix === "VAR_INFO") return "strucpp::VAR_INFO";
    return undefined;
  }

  /**
   * Resolve a type name to an elementary base type, following aliases and
   * subranges. Used so that `TYPE MyInt : INT` variables are stored with the
   * IECVar wrapper (`IEC_INT`) instead of the bare alias (`INT_t`), which
   * breaks REPL display, forcing, and `__VARINFO` overlays.
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

    const decl = this.ast?.types.find((t) => t.name.toUpperCase() === upper);
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
   * Map a TypeReference to its C++ type string, including parameterized length
   * and pointer/reference qualifiers.
   */
  /**
   * Build a TypeReference shape suitable for emitting a parameter type.
   *
   * Preserves array/pointer metadata (so inline ARRAY parameters become
   * `Array1D<T, L, U>&` and pointer params become `IEC_Ptr<T>&`) but
   * strips STRING/WSTRING maxLength so any size string binds to the
   * &-reference — matching the previous behavior of the call sites that
   * went through `mapVarTypeToCpp(decl.type.name)` without maxLength.
   */
  protected toParamTypeRef<
    T extends {
      name: string;
      maxLength?: number | string;
      referenceKind?: string;
      arrayDimensions?: Array<{ start: number; end: number }>;
      elementTypeName?: string;
      elementReferenceKind?: string;
    },
  >(
    typeRef: T,
  ): {
    name: string;
    maxLength?: number | string;
    referenceKind?: string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
    elementReferenceKind?: string;
  } {
    const upper = typeRef.name.toUpperCase();
    const isString = upper === "STRING" || upper === "WSTRING";
    return {
      name: typeRef.name,
      ...(!isString && typeRef.maxLength !== undefined
        ? { maxLength: typeRef.maxLength }
        : {}),
      ...(typeRef.arrayDimensions !== undefined
        ? { arrayDimensions: typeRef.arrayDimensions }
        : {}),
      ...(typeRef.elementTypeName !== undefined
        ? { elementTypeName: typeRef.elementTypeName }
        : {}),
      ...(typeRef.elementReferenceKind !== undefined
        ? { elementReferenceKind: typeRef.elementReferenceKind }
        : {}),
      ...(typeRef.referenceKind !== undefined
        ? { referenceKind: typeRef.referenceKind }
        : {}),
    };
  }

  /**
   * Convert a project-model record (ProjectVarDeclaration /
   * VarExternalDeclaration) into a TypeReference shape suitable for
   * `mapTypeRefToCpp` / `toParamTypeRef`. Project-model records keep the
   * type name in `.typeName` and reserve `.name` for the variable name;
   * this helper rewires the fields so the shape matches what the
   * type-resolution helpers expect.
   */
  private projectVarToTypeRef(spec: {
    typeName: string;
    maxLength?: number | string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
    elementReferenceKind?: string;
    referenceKind?: string;
  }): {
    name: string;
    maxLength?: number | string;
    referenceKind?: string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
    elementReferenceKind?: string;
  } {
    return {
      name: spec.typeName,
      ...(spec.maxLength !== undefined ? { maxLength: spec.maxLength } : {}),
      ...(spec.arrayDimensions !== undefined
        ? { arrayDimensions: spec.arrayDimensions }
        : {}),
      ...(spec.elementTypeName !== undefined
        ? { elementTypeName: spec.elementTypeName }
        : {}),
      ...(spec.elementReferenceKind !== undefined
        ? { elementReferenceKind: spec.elementReferenceKind }
        : {}),
      ...(spec.referenceKind !== undefined
        ? { referenceKind: spec.referenceKind }
        : {}),
    };
  }

  protected mapTypeRefToCpp(typeRef: {
    name: string;
    maxLength?: number | string;
    referenceKind?: string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
    elementReferenceKind?: string;
  }): string {
    let baseType: string;

    // Handle inline array types with dimension info
    // Array1D stores T directly — use IECVar-wrapped types for elementary elements
    // and bare names for composites (whose fields already contain IECVar leaves)
    if (typeRef.arrayDimensions && typeRef.elementTypeName) {
      let elemCpp = this.mapVarTypeToCpp(typeRef.elementTypeName);
      // Wrap the element type if the array is OF POINTER/REF_TO/REFERENCE TO T
      if (typeRef.elementReferenceKind === "pointer_to") {
        elemCpp = `IEC_Ptr<${elemCpp}>`;
      } else if (typeRef.elementReferenceKind === "ref_to") {
        elemCpp = `IEC_REF_TO<${elemCpp}>`;
      } else if (typeRef.elementReferenceKind === "reference_to") {
        elemCpp = `IEC_REFERENCE_TO<${elemCpp}>`;
      }
      baseType = formatArrayType(elemCpp, typeRef.arrayDimensions);
    } else {
      baseType = this.mapVarTypeToCpp(
        typeRef.name,
        typeof typeRef.maxLength === "number" ? typeRef.maxLength : undefined,
      );
    }

    if (
      typeRef.referenceKind === "pointer_to" ||
      typeRef.referenceKind === "ref_to" ||
      typeRef.referenceKind === "reference_to"
    ) {
      // REF_TO / REFERENCE_TO wrap a pointer to IECVar<T>, so their template
      // argument is the raw underlying type (INT_t, MyStruct, ...).
      // POINTER TO dereferences as T&, so for elementary types it must use the
      // IECVar-wrapped C++ type (IEC_INT) so pointer arithmetic matches the
      // actual Array1D<IEC_INT, ...> element size.
      let refElemType: string;
      let ptrElemType: string;
      if (typeRef.arrayDimensions && typeRef.elementTypeName) {
        // Array pointer/reference: baseType is already raw (Array1D<...>)
        refElemType = baseType;
        ptrElemType = baseType;
      } else if (this.isUserDefinedType(typeRef.name)) {
        // UDT: use raw struct/FB/program name
        const name = this.knownProgramTypes.has(typeRef.name.toUpperCase())
          ? `Program_${typeRef.name}`
          : typeRef.name;
        refElemType = name;
        ptrElemType = name;
      } else {
        // Primitive type: raw type for references, IECVar-wrapped for POINTER TO.
        refElemType = this.typeCodeGen.mapTypeToCpp(typeRef.name);
        ptrElemType = this.mapVarTypeToCpp(typeRef.name);
      }
      switch (typeRef.referenceKind) {
        case "pointer_to":
          // IEC_Ptr<T> — cross-type assignment, pointer arithmetic,
          // pointer-to-integer conversion.
          return `IEC_Ptr<${ptrElemType}>`;
        case "ref_to":
          // REF_TO — explicit dereference (^), nullable, rebind via
          // `:= REF(x)` / `:= ADR(x)`.
          return `IEC_REF_TO<${refElemType}>`;
        case "reference_to":
          // REFERENCE TO — implicit dereference, rebind via `REF=`.
          return `IEC_REFERENCE_TO<${refElemType}>`;
      }
    }
    // For STRING(CONSTANT_NAME), emit template with the constant name
    if (typeof typeRef.maxLength === "string") {
      const upper = typeRef.name.toUpperCase();
      if (upper === "STRING") {
        return `IECStringVar<${typeRef.maxLength}>`;
      }
      if (upper === "WSTRING") {
        return `IECWStringVar<${typeRef.maxLength}>`;
      }
    }
    return baseType;
  }

  /**
   * Set the project model for enhanced code generation.
   */
  setProjectModel(model: ProjectModel): void {
    this.projectModel = model;
  }

  /**
   * Register FB type names from libraries so codegen can distinguish
   * FB invocations from regular function calls. Private — use registerLibraryArchives().
   */
  private registerLibraryFBTypes(
    fbs: Array<{
      name: string;
      inputNames: string[];
      inoutNames: string[];
      fields: Array<{
        name: string;
        type: string;
        arrayDimensions?: Array<{ start: number; end: number }>;
        elementTypeName?: string;
        referenceKind?: string;
      }>;
    }>,
  ): void {
    for (const fb of fbs) {
      const fbUpper = fb.name.toUpperCase();
      this.knownFBTypes.add(fbUpper);
      if (fb.inputNames.length > 0) {
        this.fbInputParams.set(
          fbUpper,
          fb.inputNames.map((n) => n.toUpperCase()),
        );
      }
      if (fb.inoutNames.length > 0) {
        this.fbInoutParams.set(
          fbUpper,
          new Set(fb.inoutNames.map((n) => n.toUpperCase())),
        );
      }
      for (const f of fb.fields) {
        this.libraryFBFieldTypes.set(
          `${fbUpper}.${f.name.toUpperCase()}`,
          f.type,
        );
        // Store array metadata for inline array type reconstruction
        if (f.arrayDimensions || f.elementTypeName || f.referenceKind) {
          const ref: {
            arrayDimensions?: Array<{ start: number; end: number }>;
            elementTypeName?: string;
            referenceKind?: string;
          } = {};
          if (f.arrayDimensions) ref.arrayDimensions = f.arrayDimensions;
          if (f.elementTypeName) ref.elementTypeName = f.elementTypeName;
          if (f.referenceKind) ref.referenceKind = f.referenceKind;
          this.libraryFBFieldTypeRefs.set(
            `${fbUpper}.${f.name.toUpperCase()}`,
            ref,
          );
        }
      }
    }
  }

  /**
   * Register type info from library manifests (enum types for :: emission,
   * struct types for known-type detection). Private — use registerLibraryArchives().
   */
  private registerLibraryTypes(
    types: Array<{ name: string; kind: string }>,
  ): void {
    for (const t of types) {
      const nameUpper = t.name.toUpperCase();
      if (t.kind === "enum") {
        // Members are not available in the manifest, but we only need to
        // know the type IS an enum for :: emission in generateVariableExpression
        if (!this.enumTypeMembers.has(nameUpper)) {
          this.enumTypeMembers.set(nameUpper, new Set());
        }
      }
      this.knownStructTypes.add(nameUpper);
    }
  }

  /**
   * Register all type and FB metadata from library archives.
   * Single entry point used by both compile() and generateTestMain().
   */
  registerLibraryArchives(archives: StlibArchive[]): void {
    for (const archive of archives) {
      this.registerLibraryFBTypes(
        archive.manifest.functionBlocks.map((fb) => {
          const mapVar = (v: {
            name: string;
            type: string;
            arrayDimensions?: Array<{ start: number; end: number }>;
            elementTypeName?: string;
            referenceKind?: string;
          }) => {
            const entry: {
              name: string;
              type: string;
              arrayDimensions?: Array<{ start: number; end: number }>;
              elementTypeName?: string;
              referenceKind?: string;
            } = {
              name: v.name,
              type: v.type,
            };
            if (v.arrayDimensions) entry.arrayDimensions = v.arrayDimensions;
            if (v.elementTypeName) entry.elementTypeName = v.elementTypeName;
            if (v.referenceKind) entry.referenceKind = v.referenceKind;
            return entry;
          };
          return {
            name: fb.name,
            inputNames: fb.inputs.map((i) => i.name),
            inoutNames: fb.inouts.map((i) => i.name),
            fields: [
              ...fb.inputs.map(mapVar),
              ...fb.outputs.map(mapVar),
              ...fb.inouts.map(mapVar),
            ],
          };
        }),
      );
      if (archive.manifest.types) {
        this.registerLibraryTypes(archive.manifest.types);
      }
    }
  }

  /**
   * Hand the codegen a library archive and the set of chunk names
   * the consumer determined to be reachable from the user's AST.
   * Only those chunks are emitted into the final header/cpp.
   *
   * Single per-call entry point: nothing else mutates
   * `libraryEmissions`. The caller (index.ts) computes the reachable
   * set via function-level tree-shake before invoking this method.
   */
  addLibraryChunks(archive: StlibArchive, reachable: Set<string>): void {
    this.libraryEmissions.push({ archive, reachable });
  }

  /**
   * Emit a chunk-boundary marker in the active header stream. No-op
   * when `emitChunkMarkers` is off. See `CodeGenOptions.emitChunkMarkers`
   * — the markers exist so the library compiler can slice emitted code
   * into per-symbol chunks for function-level tree-shaking.
   */
  protected emitHeaderChunkMarker(
    boundary: "begin" | "end",
    kind: "function" | "functionBlock" | "type" | "inlineGlobal",
    name: string,
  ): void {
    if (!this.options.emitChunkMarkers) return;
    this.emitHeader(`//@chunk:${boundary}:${kind}:${name}`);
  }

  /** Emit a chunk-boundary marker in the active cpp stream. */
  protected emitCppChunkMarker(
    boundary: "begin" | "end",
    kind: "function" | "functionBlock" | "type" | "inlineGlobal",
    name: string,
  ): void {
    if (!this.options.emitChunkMarkers) return;
    this.emit(`//@chunk:${boundary}:${kind}:${name}`);
  }

  /**
   * Switch the active emit bucket. Creates a new bucket if the file
   * name hasn't been seen before; otherwise resumes appending to the
   * existing one. Caller is responsible for emitting the per-TU
   * preamble (license, #include, namespace open) on the first switch
   * to a file via `startTranslationUnit`.
   *
   * `currentLine` keeps its global value across switches — lineMap
   * entries reference positions in the legacy concatenated `cppCode`,
   * which is what the REPL line-mapping display and gdb debug info
   * (via #line directives) consume. Splitting only affects which
   * physical .cpp file a line lands in; the logical numbering for
   * the source-map is end-to-end across all files.
   */
  private setOutputFile(name: string): void {
    let bucket = this.outputFiles.get(name);
    if (!bucket) {
      bucket = [];
      this.outputFiles.set(name, bucket);
    }
    this.output = bucket;
  }

  /**
   * Begin a new translation unit. Emits the standard preamble (banner,
   * #include for the shared header, opening namespace) into the file's
   * bucket. Pair with `endTranslationUnit` after emitting POU bodies.
   */
  private startTranslationUnit(name: string): void {
    this.setOutputFile(name);
    const ns = this.projectModel
      ? getProjectNamespace(this.projectModel)
      : "strucpp";
    this.emit(
      "// Generated by STruC++ - IEC 61131-3 Structured Text to C++ Compiler",
    );
    this.emit("// Do not edit this file manually.");
    this.emit("");
    this.emit(`#include "${this.options.headerFileName}"`);
    for (const extra of this.options.pouIncludes) {
      this.emit(`#include "${extra}"`);
    }
    this.emit("");
    this.emit(`namespace ${ns} {`);
    this.emit("");
  }

  /**
   * Close the namespace on the currently-active translation unit.
   * Mirrors `startTranslationUnit`.
   */
  private endTranslationUnit(): void {
    const ns = this.projectModel
      ? getProjectNamespace(this.projectModel)
      : "strucpp";
    this.emit(`}  // namespace ${ns}`);
  }

  /**
   * Build a deterministic .cpp file name for a POU. Names already
   * conform to C identifier rules (the parser enforces it), so we
   * just lowercase + prefix; per-POU uniqueness is the caller's
   * concern (multiple POUs with the same name would already be a
   * semantic error caught earlier).
   */
  private pouFileName(pouName: string): string {
    return `pou_${pouName}.cpp`;
  }

  /**
   * Generate C++ code from a compilation unit.
   */
  generate(ast: CompilationUnit): CodeGenResult {
    this.outputFiles = new Map();
    this.output = [];
    this.headerOutput = [];
    this.lineMap = new Map();
    this.headerLineMap = new Map();
    this.currentLine = 1;
    this.currentHeaderLine = 1;
    this.locatedVars = [];
    this.codegenWarnings = [];
    this.codegenErrors = [];
    this.tempVarCounter = 0;
    this.varInfoCounter = 0;
    this.varInfoSymbolIds = new Map();
    this.varInfoDescriptorCache = new Map();
    this.ast = ast; // Store AST for looking up program bodies

    // Assign stable synthetic byte-address IDs from sorted __VARINFO symbols.
    this.buildVarInfoSymbolIds(ast);

    // Build set of known FB types from AST (library FB types already registered
    // via registerLibraryFBTypes() before generate() is called)
    for (const fb of ast.functionBlocks) {
      this.knownFBTypes.add(fb.name.toUpperCase());
      // Build ordered input parameter names for positional argument resolution
      const inputNames: string[] = [];
      const inoutNames: string[] = [];
      for (const block of fb.varBlocks) {
        if (block.blockType === "VAR_INPUT") {
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              inputNames.push(name.toUpperCase());
            }
          }
        } else if (block.blockType === "VAR_IN_OUT") {
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              inoutNames.push(name.toUpperCase());
              this.fbInoutParamTypes.set(
                `${fb.name.toUpperCase()}.${name.toUpperCase()}`,
                decl.type.name,
              );
              this.fbInoutParamIsArray.set(
                `${fb.name.toUpperCase()}.${name.toUpperCase()}`,
                !!(decl.type.arrayDimensions || decl.type.elementTypeName),
              );
            }
          }
        }
      }
      if (inputNames.length > 0) {
        this.fbInputParams.set(fb.name.toUpperCase(), inputNames);
      }
      if (inoutNames.length > 0) {
        this.fbInoutParams.set(fb.name.toUpperCase(), new Set(inoutNames));
      }
    }

    // Build set of known interface types, method name map, and per-interface method sets
    for (const iface of ast.interfaces) {
      this.knownInterfaceTypes.add(iface.name.toUpperCase());
      const ifaceMethods = new Set<string>();
      for (const method of iface.methods) {
        this.methodNameMap.set(
          `${iface.name.toUpperCase()}.${method.name.toUpperCase()}`,
          method.name,
        );
        ifaceMethods.add(method.name.toUpperCase());
      }
      this.interfaceMethodsByInterface.set(
        iface.name.toUpperCase(),
        ifaceMethods,
      );
    }

    // Build method name map, property name map, and interface method names for FBs
    for (const fb of ast.functionBlocks) {
      for (const method of fb.methods) {
        this.methodNameMap.set(
          `${fb.name.toUpperCase()}.${method.name.toUpperCase()}`,
          method.name,
        );
      }
      for (const prop of fb.properties) {
        this.propertyNameMap.set(
          `${fb.name.toUpperCase()}.${prop.name.toUpperCase()}`,
          prop.name,
        );
      }
      // Precompute interface method names for each FB (for field access mangling)
      const ifaceMethods = this.getInterfaceMethodNames(fb);
      if (ifaceMethods.size > 0) {
        this.fbInterfaceMethodNames.set(fb.name.toUpperCase(), ifaceMethods);
      }
    }

    // Propagate methods and properties down the FB inheritance chain so
    // `Child.BaseProp` and `Child.InheritedMethod()` resolve to the parent names.
    const fbMap = new Map(
      ast.functionBlocks.map((fb) => [fb.name.toUpperCase(), fb] as const),
    );
    const propagate = (
      derived: (typeof ast.functionBlocks)[0],
      ancestorName: string,
      visited: Set<string>,
    ) => {
      if (visited.has(ancestorName.toUpperCase())) return;
      visited.add(ancestorName.toUpperCase());
      const ancestor = fbMap.get(ancestorName.toUpperCase());
      if (!ancestor) return;
      const derivedKey = derived.name.toUpperCase();
      for (const method of ancestor.methods) {
        const key = `${derivedKey}.${method.name.toUpperCase()}`;
        if (!this.methodNameMap.has(key)) {
          this.methodNameMap.set(key, method.name);
        }
      }
      for (const prop of ancestor.properties) {
        const key = `${derivedKey}.${prop.name.toUpperCase()}`;
        if (!this.propertyNameMap.has(key)) {
          this.propertyNameMap.set(key, prop.name);
        }
      }
      if (ancestor.extends) {
        propagate(derived, ancestor.extends, visited);
      }
    };
    for (const fb of ast.functionBlocks) {
      if (fb.extends) {
        propagate(fb, fb.extends, new Set<string>());
      }
    }

    // Build set of known struct/UDT types and enum member maps
    const enumDescriptors: Array<{ name: string; members: string[] }> = [];
    for (const td of ast.types) {
      this.knownStructTypes.add(td.name.toUpperCase());
      if (td.definition.kind === "EnumDefinition") {
        const memberNames = td.definition.members.map((m) => m.name);
        const members = new Set(memberNames.map((m) => m.toUpperCase()));
        this.enumTypeMembers.set(td.name.toUpperCase(), members);
        enumDescriptors.push({ name: td.name, members: memberNames });
      }
    }
    this.enumMemberToType = buildEnumMemberMap(enumDescriptors);

    // Register program names as types (CODESYS allows instantiating PROGRAMs like FBs)
    for (const prog of ast.programs) {
      this.knownProgramTypes.add(prog.name.toUpperCase());
    }

    // Topologically sort FBs once (used in both header and implementation)
    this.sortedFBs = this.topologicalSortFBs(ast.functionBlocks);

    // Generate header
    this.generateHeader(ast);

    // Generate implementation
    this.generateImplementation(ast);

    const eol = this.options.lineEnding;
    const cppFiles = Array.from(this.outputFiles.entries()).map(
      ([name, lines]) => ({ name, content: lines.join(eol) }),
    );
    return {
      cppFiles,
      // Legacy concatenation — preserves the historical single-blob
      // shape for callers (CLI single-file output, library compiler,
      // REPL preview, tests) that don't care about per-TU split. The
      // public compile() wrapper exposes this verbatim.
      cppCode: cppFiles.map((f) => f.content).join(eol),
      headerCode: this.headerOutput.join(eol),
      lineMap: this.lineMap,
      headerLineMap: this.headerLineMap,
      warnings: this.codegenWarnings,
      errors: this.codegenErrors,
    };
  }

  /**
   * Generate the C++ header file.
   */
  private generateHeader(ast: CompilationUnit): void {
    // Determine the namespace for this project
    const ns = this.projectModel
      ? getProjectNamespace(this.projectModel)
      : "strucpp";

    this.emitHeader("#pragma once");
    this.emitHeader("");
    this.emitHeader(
      "// Generated by STruC++ - IEC 61131-3 Structured Text to C++ Compiler",
    );
    this.emitHeader("// Do not edit this file manually.");
    this.emitHeader("");
    this.emitHeader('#include "iec_types.hpp"');
    this.emitHeader('#include "iec_var.hpp"');
    this.emitHeader('#include "iec_global.hpp"');
    this.emitHeader('#include "iec_array.hpp"');
    this.emitHeader('#include "iec_located.hpp"');
    this.emitHeader('#include "iec_std_lib.hpp"');
    this.emitHeader('#include "iec_enum.hpp"');
    this.emitHeader('#include "iec_system.hpp"');
    this.emitHeader('#include "iec_varinfo.hpp"');
    this.emitHeader('#include "iec_memory.hpp"');
    this.emitHeader('#include "iec_pointer.hpp"');
    this.emitHeader('#include "iec_string.hpp"');
    this.emitHeader('#include "iec_wstring.hpp"');
    this.emitHeader("#ifdef STRUCPP_TEST");
    this.emitHeader('  #include "iec_test.hpp"');
    this.emitHeader("#endif");
    this.emitHeader("#include <array>");
    this.emitHeader("#include <cstddef>");
    this.emitHeader("#include <string>");

    // Undefine C standard-library macros that collide with legal ST identifiers
    // (e.g. OSCAT's T_AVG24 has a local `TMP_MAX`, which <cstdio> #defines).
    // Done after the runtime includes so the runtime still sees the real macros;
    // user code below only ever uses these names as ordinary identifiers.
    this.emitHeader("");
    this.emitHeader(
      "// Avoid clashes between ST identifiers and C stdlib macros",
    );
    for (const m of [
      "TMP_MAX",
      "EOF",
      "BUFSIZ",
      "FOPEN_MAX",
      "FILENAME_MAX",
      "RAND_MAX",
      "EXIT_SUCCESS",
      "EXIT_FAILURE",
    ]) {
      this.emitHeader(`#ifdef ${m}`);
      this.emitHeader(`#undef ${m}`);
      this.emitHeader(`#endif`);
    }

    // Include library headers
    if (this.options.libraryHeaders.length > 0) {
      this.emitHeader("");
      this.emitHeader("// Library headers");
      for (const header of this.options.libraryHeaders) {
        this.emitHeader(`#include "${header}"`);
      }
    }

    // Undefine macros that collide with IEC identifiers.
    //
    // `<math.h>` (transitively included via `<cmath>` in iec_std_lib.hpp)
    // defines `OVERFLOW` as a legacy SVID numeric-error constant on both
    // glibc/macOS and avr-libc. That collides with several OSCAT FB
    // struct fields named OVERFLOW, and the preprocessor expansion would
    // turn those into integer literals before the C++ parser sees them.
    // The architecturally-correct fixes — wrapping in a namespace,
    // renaming the IEC identifier — either don't help (macros expand
    // before scope resolution) or break IEC FB ABI. The `#undef` has
    // zero cost on platforms where the macro isn't defined.
    //
    // (`<avr/io.h>`'s `SP` macro used to need the same treatment, but
    // post the Arduino-glue split no TU that parses `generated.hpp`
    // also pulls in `<avr/io.h>`, so the SP undef was retired.)
    this.emitHeader("");
    this.emitHeader("#undef OVERFLOW");

    // Emit global constants (before namespace, so they work as template parameters)
    const globalConsts = Object.entries(this.options.globalConstants);
    if (globalConsts.length > 0) {
      this.emitHeader("");
      this.emitHeader("// Global constants");
      for (const [name, value] of globalConsts) {
        this.emitHeader(`constexpr size_t ${name} = ${value};`);
      }
    }

    this.emitHeader("");

    // Open namespace
    this.emitHeader(`namespace ${ns} {`);
    this.emitHeader("");

    // If using a custom namespace, import strucpp types
    if (ns !== "strucpp") {
      this.emitHeader("using namespace strucpp;  // Runtime types");
      this.emitHeader("");
    }

    // Generate user-defined types (Phase 2.2)
    if (ast.types.length > 0) {
      const typeRegistry = new TypeRegistry();
      typeRegistry.registerTypes(ast.types);
      const typeCodeGen = new TypeCodeGenerator({
        indent: this.options.indent,
        lineEnding: this.options.lineEnding,
        emitChunkMarkers: this.options.emitChunkMarkers ?? false,
      });
      const typeCode = typeCodeGen.generateFromRegistry(typeRegistry);
      for (const line of typeCode.split(this.options.lineEnding)) {
        this.emitHeader(line);
      }
    }

    // Inject reachable library chunks (header side).
    //
    // Per archive: emit `// Library: <name>` header, then `class X;`
    // forward decls for every reachable functionBlock chunk
    // (libraries' FB classes are sometimes mutually-referential and
    // the bodies are emitted in declaration order — the forward
    // decls ahead of any body keep the layout linkable in every
    // ordering). Then emit each reachable chunk's `header` slice in
    // chunk-array order; types come first, FBs next, functions last
    // because that's the order the library compiler emitted them
    // before slicing.
    for (const { archive, reachable } of this.libraryEmissions) {
      const reachableChunks: LibraryChunk[] = [];
      for (const chunk of archive.chunks ?? []) {
        if (chunk.header.length === 0) continue;
        if (reachable.has(chunk.name)) reachableChunks.push(chunk);
      }
      if (reachableChunks.length === 0) continue;

      this.emitHeader(`// Library: ${archive.manifest.name}`);

      for (const chunk of reachableChunks) {
        if (chunk.kind === "functionBlock") {
          this.emitHeader(`class ${chunk.name};`);
        }
      }

      for (const chunk of reachableChunks) {
        for (const line of chunk.header.split("\n")) {
          this.emitHeader(line);
        }
      }

      this.emitHeader("");
    }

    // Generate forward declarations
    for (const iface of ast.interfaces) {
      this.emitHeader(`class ${iface.name};`);
    }
    for (const fb of ast.functionBlocks) {
      this.emitHeader(`class ${fb.name};`);
    }
    for (const prog of ast.programs) {
      this.emitHeader(`class Program_${prog.name};`);
    }
    for (const config of ast.configurations) {
      this.emitHeader(`class Configuration_${config.name};`);
    }
    if (
      ast.interfaces.length > 0 ||
      ast.functionBlocks.length > 0 ||
      ast.programs.length > 0 ||
      ast.configurations.length > 0
    ) {
      this.emitHeader("");
    }

    // Generate interface declarations (before FBs since FBs may implement interfaces)
    for (const iface of ast.interfaces) {
      this.emitHeaderChunkMarker("begin", "type", iface.name);
      this.generateInterfaceHeaderDeclaration(iface);
      this.emitHeaderChunkMarker("end", "type", iface.name);
    }

    // Configuration VAR_GLOBALs as file-scope singletons — emitted before the
    // FB/program classes so their bodies (and FB constructors that bind a
    // VAR_EXTERNAL pointer to a global) can name them.
    this.emitFileScopeGlobals();

    // Generate function block class declarations (topologically sorted by dependency)
    for (const fb of this.sortedFBs) {
      this.emitHeaderChunkMarker("begin", "functionBlock", fb.name);
      this.generateFBHeaderDeclaration(fb);
      this.emitHeaderChunkMarker("end", "functionBlock", fb.name);
    }

    // Generate top-level global variables (GVL files) after the FB class
    // declarations so that inline instances of function-block types are
    // well-formed (the type must be complete before the variable is defined).
    if (ast.globalVarBlocks.length > 0) {
      this.emitHeader("// Global variables");
      for (const block of ast.globalVarBlocks) {
        const constQualifier = block.isConstant ? "const " : "";
        for (const decl of block.declarations) {
          const cppType = this.mapTypeRefToCpp(decl.type);
          for (const name of decl.names) {
            this.emitHeaderChunkMarker("begin", "inlineGlobal", name);
            if (decl.initialValue) {
              const initExpr = this.generateInitializer(
                decl.type,
                decl.initialValue,
              );
              this.emitHeader(
                `${constQualifier}inline ${cppType} ${name} = ${initExpr};`,
              );
            } else {
              this.emitHeader(`inline ${cppType} ${name}{};`);
            }
            // Track top-level global located variables for runtime I/O binding.
            if (decl.address) {
              this.collectLocatedVar(name, name, decl, "@config", false);
            }
            this.emitHeaderChunkMarker("end", "inlineGlobal", name);
          }
        }
      }
      this.emitHeader("");
    }

    // Generate program class declarations
    if (this.projectModel) {
      // Use project model for enhanced generation with VAR_EXTERNAL support
      for (const prog of this.projectModel.programs.values()) {
        this.emitHeaderChunkMarker(
          "begin",
          "functionBlock",
          `Program_${prog.name}`,
        );
        this.generateProgramHeaderFromModel(prog);
        this.emitHeaderChunkMarker(
          "end",
          "functionBlock",
          `Program_${prog.name}`,
        );
      }
    } else {
      // Fallback to AST-based generation
      for (const prog of ast.programs) {
        this.emitHeaderChunkMarker(
          "begin",
          "functionBlock",
          `Program_${prog.name}`,
        );
        this.generateProgramHeaderDeclaration(prog);
        this.emitHeaderChunkMarker(
          "end",
          "functionBlock",
          `Program_${prog.name}`,
        );
      }
    }

    // Generate function declarations
    for (const func of ast.functions) {
      this.emitHeaderChunkMarker("begin", "function", func.name);
      this.generateFunctionHeaderDeclaration(func);
      this.emitHeaderChunkMarker("end", "function", func.name);
    }

    // Generate configuration class declarations
    if (this.projectModel) {
      for (const config of this.projectModel.configurations) {
        this.generateConfigurationHeaderFromModel(config);
      }
    } else {
      for (const config of ast.configurations) {
        this.generateConfigurationHeaderDeclaration(config);
      }
    }

    // Generate located variables descriptor array declaration
    this.generateLocatedVarsDeclaration();

    this.emitHeader(`}  // namespace ${ns}`);
  }

  /**
   * Generate the C++ implementation files.
   *
   * Splits across multiple translation units so the runtime build can
   * run `make -j$(nproc)` and ccache can keep .o files for unchanged
   * POUs across rebuilds:
   *
   *   configuration.cpp     library preambles, located-vars definition,
   *                         configuration glue (must be exactly one TU
   *                         to avoid duplicate symbol errors at link).
   *   pou_<NAME>.cpp        one TU per program / FB / function.
   *
   * All files share `generated.hpp`, so editing a POU's *body* leaves
   * other TUs' preprocessed source unchanged → ccache reuses them.
   * Editing a declaration invalidates the header and forces a full
   * rebuild — same as any C++ project.
   */
  private generateImplementation(ast: CompilationUnit): void {
    // 1. Shared TU: library preambles, located-vars def, configurations.
    //    Anything that must have exactly one definition in the .so
    //    lives here (multiple-TU defs would link-fail with "multiple
    //    definition of …").
    this.startTranslationUnit("configuration.cpp");

    // Inject reachable library chunks (cpp side). Same per-archive
    // iteration order as the header side; only chunks whose `cpp`
    // slice is non-empty get emitted (types and inline globals are
    // header-only).
    for (const { archive, reachable } of this.libraryEmissions) {
      const reachableChunks: LibraryChunk[] = [];
      for (const chunk of archive.chunks ?? []) {
        if (chunk.cpp.length === 0) continue;
        if (reachable.has(chunk.name)) reachableChunks.push(chunk);
      }
      if (reachableChunks.length === 0) continue;

      this.emit(`// Library: ${archive.manifest.name}`);
      for (const chunk of reachableChunks) {
        for (const line of chunk.cpp.split("\n")) {
          this.emit(line);
        }
      }
      this.emit("");
    }

    this.generateLocatedVarsDefinition();
    this.generateInitGlobalLocatedPointers();

    if (this.projectModel) {
      for (const config of this.projectModel.configurations) {
        this.generateConfigurationImplementationFromModel(config);
      }
    } else {
      for (const config of ast.configurations) {
        this.generateConfigurationImplementation(config);
      }
    }

    this.endTranslationUnit();

    // 2. One TU per program.
    if (this.projectModel) {
      for (const prog of this.projectModel.programs.values()) {
        this.startTranslationUnit(this.pouFileName(prog.name));
        this.emitCppChunkMarker(
          "begin",
          "functionBlock",
          `Program_${prog.name}`,
        );
        this.generateProgramImplementationFromModel(prog);
        this.emitCppChunkMarker("end", "functionBlock", `Program_${prog.name}`);
        this.endTranslationUnit();
      }
    } else {
      for (const prog of ast.programs) {
        this.startTranslationUnit(this.pouFileName(prog.name));
        this.emitCppChunkMarker(
          "begin",
          "functionBlock",
          `Program_${prog.name}`,
        );
        this.generateProgramImplementation(prog);
        this.emitCppChunkMarker("end", "functionBlock", `Program_${prog.name}`);
        this.endTranslationUnit();
      }
    }

    // 3. One TU per function block. Topological order doesn't matter
    //    here (each impl just sees the shared header's full set of
    //    class declarations); ordering only mattered for the header.
    for (const fb of this.sortedFBs) {
      this.startTranslationUnit(this.pouFileName(fb.name));
      this.emitCppChunkMarker("begin", "functionBlock", fb.name);
      this.generateFBImplementation(fb);
      this.emitCppChunkMarker("end", "functionBlock", fb.name);
      this.endTranslationUnit();
    }

    // 4. One TU per function.
    for (const func of ast.functions) {
      this.startTranslationUnit(this.pouFileName(func.name));
      this.emitCppChunkMarker("begin", "function", func.name);
      this.generateFunctionImplementation(func);
      this.emitCppChunkMarker("end", "function", func.name);
      this.endTranslationUnit();
    }
  }

  /**
   * Collect a function block's VAR_EXTERNAL references (name + resolved C++
   * type). IEC 61131-3 lets an FB access configuration globals this way; each
   * becomes a `GlobalVar<V>*` bound to the file-scope canonical.
   */
  private collectFBExternals(
    fb: CompilationUnit["functionBlocks"][0],
  ): Array<{ name: string; cppType: string }> {
    const externals: Array<{ name: string; cppType: string }> = [];
    for (const block of fb.varBlocks) {
      if (block.blockType !== "VAR_EXTERNAL") continue;
      for (const decl of block.declarations) {
        const cppType = this.mapTypeRefToCpp(decl.type);
        for (const name of decl.names) {
          externals.push({ name, cppType });
        }
      }
    }
    return externals;
  }

  /**
   * Generate header declaration for a function block.
   */
  private generateFBHeaderDeclaration(
    fb: CompilationUnit["functionBlocks"][0],
  ): void {
    // Populate interface method names for variable/method collision detection
    this.currentFBInterfaceMethods = this.getInterfaceMethodNames(fb);

    // Build inheritance clause
    const bases: string[] = [];
    if (fb.extends) {
      bases.push(`public ${fb.extends}`);
    }
    if (fb.implements) {
      for (const iface of fb.implements) {
        // Virtual inheritance prevents diamond ambiguity when an FB both
        // inherits another FB that already implements an interface and also
        // implements a derived interface of the same base.
        bases.push(`virtual public ${iface}`);
      }
    }
    const inheritance = bases.length > 0 ? ` : ${bases.join(", ")}` : "";
    const finalSpec = fb.isFinal ? " final" : "";

    const iecStructMembers: string[] = [];
    const fbDataMemberNames: string[] = [];
    if (fb.extends) {
      iecStructMembers.push(`${fb.extends}`);
    }

    this.emitHeaderLineDirective(fb.sourceSpan.startLine);
    const classLine = this.currentHeaderLine;
    this.emitHeader(`class ${fb.name}${finalSpec}${inheritance} {`);
    this.emitHeader("public:");
    this.recordHeaderLineMapping(fb.sourceSpan.startLine, classLine);

    // Member names in this FB — used to detect a member that shadows the type
    // of a sibling member (e.g. F_LAMP has both `ONTIME : UDINT` and
    // `RUNTIME : ONTIME`, where the FB type ONTIME also exists). C++ member
    // lookup would resolve the bare type name to the data member, so such a
    // member declaration needs an elaborated `class`/`struct` specifier.
    const fbMemberNames = new Set<string>();
    for (const block of fb.varBlocks) {
      for (const decl of block.declarations) {
        for (const n of decl.names) fbMemberNames.add(n.toUpperCase());
      }
    }

    // Detect nested scalar function-block members (used for lifecycle ordering).
    const hasNestedFB = fb.varBlocks.some((block) => {
      if (block.blockType === "VAR_EXTERNAL") return false;
      return block.declarations.some((decl) => {
        const isInoutFBScalar =
          block.blockType === "VAR_IN_OUT" &&
          decl.type.arrayDimensions === undefined &&
          decl.type.elementTypeName === undefined &&
          this.isPointerInoutType(decl.type.name);
        const isInoutArray =
          block.blockType === "VAR_IN_OUT" &&
          (decl.type.arrayDimensions !== undefined ||
            decl.type.elementTypeName !== undefined);
        if (isInoutFBScalar || isInoutArray) return false;
        return (
          decl.type.arrayDimensions === undefined &&
          !decl.initialValue &&
          this.isFBType(decl.type.name)
        );
      });
    });

    // Generate member variables
    for (const block of fb.varBlocks) {
      // VAR_EXTERNAL is a reference to a configuration global, not a member of
      // the FB — emitted below as a GlobalVar<V>* pointing at the file-scope
      // canonical (mirrors the PROGRAM path). Handling it here as a plain member
      // would give the FB a private copy that never touches the shared global.
      if (block.blockType === "VAR_EXTERNAL") continue;

      const comment =
        block.blockType === "VAR_INPUT"
          ? "// Inputs"
          : block.blockType === "VAR_OUTPUT"
            ? "// Outputs"
            : block.blockType === "VAR_IN_OUT"
              ? "// In-Out"
              : "// Local variables";

      this.emitHeader(`    ${comment}`);
      for (const decl of block.declarations) {
        let cppType = this.mapTypeRefToCpp(decl.type);
        const isInoutArray =
          block.blockType === "VAR_IN_OUT" &&
          (decl.type.arrayDimensions !== undefined ||
            decl.type.elementTypeName !== undefined);
        const isInoutFBScalar =
          block.blockType === "VAR_IN_OUT" &&
          decl.type.arrayDimensions === undefined &&
          decl.type.elementTypeName === undefined &&
          this.isFBType(decl.type.name);
        if (isInoutArray || isInoutFBScalar) {
          cppType += "*";
        }
        // Note: interface-typed VAR_IN_OUT scalar already emits as IInterface* via
        // mapTypeRefToCpp, so only array inouts need an extra * here.
        const tag = this.elaboratedTagIfShadowed(decl.type.name, fbMemberNames);
        for (const name of decl.names) {
          const memberName = this.mangleMemberIfNeeded(
            name,
            cppType,
            decl.type.name,
          );
          this.emitHeaderLineDirective(decl.sourceSpan.startLine);
          const memberLine = this.currentHeaderLine;
          this.emitHeader(`    ${tag}${cppType} ${memberName};`);
          this.recordHeaderLineMapping(decl.sourceSpan.startLine, memberLine);
          iecStructMembers.push(`${tag}${cppType}`);
          fbDataMemberNames.push(memberName);
        }
      }
    }

    // VAR_EXTERNAL members: a pointer to the file-scope canonical GlobalVar<V>
    // (same shape a PROGRAM uses). Bound in the constructor to &<ns>::<name>.
    const fbExternals = this.collectFBExternals(fb);
    if (fbExternals.length > 0) {
      this.emitHeader("    // External variables (pointers to shared globals)");
      for (const ext of fbExternals) {
        this.emitHeader(
          `    GlobalVar<${ext.cppType}>* ${ext.name} = nullptr;`,
        );
        iecStructMembers.push(`GlobalVar<${ext.cppType}>*`);
      }
    }

    // Generate VAR_INST mangled members from methods
    const varInstMembers = this.collectVarInstMembers(fb);
    if (varInstMembers.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Method instance variables (VAR_INST)");
      for (const m of varInstMembers) {
        this.emitHeader(`    ${m.cppType} ${m.mangledName};`);
        iecStructMembers.push(`${m.cppType}`);
      }
    }

    // IEC 61131-3 implicit ENO output. Mirrors EN at every call site, so
    // user code that does `IF inst.ENO THEN ...` after invoking the FB
    // resolves. Default is true so FBs invoked without an EN pin see ENO=1
    // (matches the standard: ENO defaults to TRUE when EN is omitted).
    // Only emitted on the leaf FB; if it extends another FB, the parent
    // already provides ENO.
    if (!fb.extends) {
      this.emitHeader("");
      this.emitHeader("    // Implicit IEC 61131-3 ENO pin (mirrors EN)");
      this.emitHeader("    IEC_BOOL ENO = true;");
      fbDataMemberNames.push("ENO");
    }

    this.emitHeader("");
    this.emitHeader("  protected:");
    this.emitHeader("    // Lifecycle control flag");
    this.emitHeader("    bool __strucpp_lifecycle_ = true;");
    this.emitHeader("");
    this.emitHeader("  public:");
    this.emitHeader("    // Constructor");
    this.emitHeader(`    ${fb.name}(bool __strucpp_lifecycle = true);`);
    this.emitHeader("");
    this.emitHeader("    // Lifecycle helpers");
    this.emitHeader(
      "    void __strucpp_fb_init(bool bInitRetains, bool bInCopyCode);",
    );
    this.emitHeader("    void __strucpp_fb_exit(bool bInCopyCode);");
    this.emitHeader("");
    this.emitHeader("    // Execute function block");
    this.emitHeader("    void operator()();");

    // Generate method declarations (grouped by visibility)
    if (fb.methods.length > 0) {
      this.emitHeader("");
      this.generateMethodDeclarations(fb.methods);
    }

    // Generate property declarations
    if (fb.properties.length > 0) {
      this.emitHeader("");
      this.generatePropertyDeclarations(fb.properties);
    }

    // Virtual destructor (needed for classes with virtual methods, or for
    // calling FB_Exit lifecycle cleanup).
    const hasFBExit = fb.methods.some(
      (m) => m.name.toUpperCase() === "FB_EXIT",
    );
    const hasBaseFB = fb.extends !== undefined;
    const needsUserDestructor = hasFBExit || hasNestedFB || hasBaseFB;
    if (
      needsUserDestructor ||
      fb.methods.length > 0 ||
      fb.properties.length > 0 ||
      !fb.isFinal
    ) {
      this.emitHeader("");
      if (needsUserDestructor) {
        this.emitHeader(`    virtual ~${fb.name}();`);
      } else {
        this.emitHeader(`    virtual ~${fb.name}() = default;`);
      }
    }

    if (fb.implements && fb.implements.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Interface query support");
      this.emitHeader(
        `    bool __strucpp_query_interface(const char* id, void*& out) const override;`,
      );
    }

    // Logical IEC byte size (padded sum of member logical sizes, for SIZEOF)
    if (iecStructMembers.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Logical IEC byte size (for SIZEOF)");
      this.emitHeader(
        `    static constexpr std::size_t iec_byte_size = iec_struct_size<${iecStructMembers.join(", ")}>::value;`,
      );
    }

    // Equality and test-only stream output helpers for ASSERT_EQ on FBs.
    const eqParts: string[] = [];
    if (fb.extends) {
      eqParts.push(
        `static_cast<const ${fb.extends}&>(*this) == static_cast<const ${fb.extends}&>(other)`,
      );
    }
    for (const memberName of fbDataMemberNames) {
      eqParts.push(`${memberName} == other.${memberName}`);
    }
    const eqBody = eqParts.length > 0 ? eqParts.join(" && ") : "true";
    this.emitHeader("");
    this.emitHeader(
      `    bool operator==(const ${fb.name}& other) const noexcept { return ${eqBody}; }`,
    );
    this.emitHeader(
      `    bool operator!=(const ${fb.name}& other) const noexcept { return !(*this == other); }`,
    );
    this.emitHeader("    #ifdef STRUCPP_TEST");
    const streamParts: string[] = [];
    if (fb.extends) {
      streamParts.push(`os << static_cast<const ${fb.extends}&>(s)`);
    }
    for (const memberName of fbDataMemberNames) {
      streamParts.push(
        `os << "${streamParts.length > 0 ? ", " : ""}${memberName}=" << to_display_string(s.${memberName})`,
      );
    }
    const streamBody =
      streamParts.length > 0 ? streamParts.join("; ") : 'os << "{}"';
    this.emitHeader(
      `    friend std::ostream& operator<<(std::ostream& os, const ${fb.name}& s) { os << "{"; ${streamBody}; os << "}"; return os; }`,
    );
    this.emitHeader("    #endif");

    // Test build: add mock infrastructure
    if (this.options.isTestBuild) {
      this.emitHeader("");
      this.emitHeader("    // Test mock infrastructure");
      this.emitHeader("    bool __mocked_ = false;");
      this.emitHeader("    struct { int call_count = 0; } __mock_state_;");
    }

    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Generate header declaration for a program.
   */
  private generateProgramHeaderDeclaration(
    prog: CompilationUnit["programs"][0],
  ): void {
    this.emitHeaderLineDirective(prog.sourceSpan.startLine);
    const classLine = this.currentHeaderLine;
    this.emitHeader(`class Program_${prog.name} : public ProgramBase {`);
    this.emitHeader("public:");
    this.recordHeaderLineMapping(prog.sourceSpan.startLine, classLine);

    // Generate member variables and collect located variables
    const iecStructMembers: string[] = [];
    for (const block of prog.varBlocks) {
      for (const decl of block.declarations) {
        const cppType = this.mapTypeRefToCpp(decl.type);
        for (const name of decl.names) {
          const memberName = this.mangleMemberIfNeeded(
            name,
            cppType,
            decl.type.name,
          );
          this.emitHeaderLineDirective(decl.sourceSpan.startLine);
          const memberLine = this.currentHeaderLine;
          if (decl.address) {
            // Generate variable with optional address comment
            this.emitHeader(
              `    ${cppType} ${memberName};  // AT ${decl.address}`,
            );
            // Collect located variable info
            this.collectLocatedVar(name, memberName, decl, prog.name);
          } else {
            this.emitHeader(`    ${cppType} ${memberName};`);
          }
          this.recordHeaderLineMapping(decl.sourceSpan.startLine, memberLine);
          iecStructMembers.push(`${cppType}`);
        }
      }
    }

    this.emitHeader("");
    // Implicit IEC 61131-3 ENO pin. Mirrors EN at every call site, so
    // user code that does `IF prog.ENO THEN ...` after invoking the
    // program (or the test framework that wraps a program as a UUT and
    // invokes it like an FB) resolves. Default true matches the
    // standard's "ENO defaults to TRUE when EN is omitted".
    this.emitHeader("    // Implicit IEC 61131-3 ENO pin (mirrors EN)");
    this.emitHeader("    IEC_BOOL ENO = true;");
    this.emitHeader("");
    this.emitHeader("    // Constructor");
    this.emitHeader(`    Program_${prog.name}();`);
    this.emitHeader("");
    this.emitHeader("    // Run program");
    this.emitHeader("    void run() override;");

    if (this.locatedVars.some((v) => v.programName === prog.name)) {
      this.emitHeader("    // Bind located variable pointers at runtime");
      this.emitHeader("    void bind_located_vars() override;");
    }

    if (iecStructMembers.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Logical IEC byte size (for SIZEOF)");
      this.emitHeader(
        `    static constexpr std::size_t iec_byte_size = iec_struct_size<${iecStructMembers.join(", ")}>::value;`,
      );
    }

    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Generate header declaration for a function.
   */
  private generateFunctionHeaderDeclaration(
    func: CompilationUnit["functions"][0],
  ): void {
    const params = this.generateFunctionParams(func);
    const retType = this.mapTypeRefToCpp(func.returnType);

    this.emitHeaderLineDirective(func.sourceSpan.startLine);
    const declLine = this.currentHeaderLine;
    this.emitHeader(`${retType} ${func.name}(${params.join(", ")});`);
    this.recordHeaderLineMapping(func.sourceSpan.startLine, declLine);
  }

  /**
   * Generate function parameter list including VAR_INPUT and VAR_IN_OUT.
   * VAR_IN_OUT parameters are passed by reference.
   * VLA types use ArrayView instead of IECVar reference.
   */
  protected generateFunctionParams(
    func: CompilationUnit["functions"][0],
  ): string[] {
    const params: string[] = [];
    for (const block of func.varBlocks) {
      if (block.blockType === "VAR_INPUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            params.push(`${this.mapTypeRefToCpp(decl.type)} ${name}`);
          }
        }
      } else if (block.blockType === "VAR_IN_OUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            // VLA types (ArrayView) are already reference-like; others need &
            if (decl.type.name.startsWith("__VLA_")) {
              params.push(`${this.mapTypeRefToCpp(decl.type)} ${name}`);
            } else {
              // mapTypeRefToCpp preserves arrayDimensions / elementTypeName
              // (so inline ARRAY params emit Array1D<...>) but we still want
              // STRING/WSTRING maxLength dropped so any string size binds to
              // the &-reference — strip it on a shallow copy of the typeRef.
              params.push(
                `${this.mapTypeRefToCpp(this.toParamTypeRef(decl.type))}& ${name}`,
              );
            }
          }
        }
      } else if (block.blockType === "VAR_OUTPUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            // Same metadata-aware lookup as VAR_IN_OUT — see the comment above.
            params.push(
              `${this.mapTypeRefToCpp(this.toParamTypeRef(decl.type))}& ${name}`,
            );
          }
        }
      }
    }
    return params;
  }

  // ===========================================================================
  // OOP Code Generation (Phase 5.2)
  // ===========================================================================

  /**
   * Generate header declaration for an interface.
   * Interfaces become abstract classes with pure virtual methods.
   */
  private generateInterfaceHeaderDeclaration(
    iface: InterfaceDeclaration,
  ): void {
    const bases: string[] = ["virtual public strucpp::__IInterface"];
    if (iface.extends && iface.extends.length > 0) {
      for (const e of iface.extends) bases.push(`virtual public ${e}`);
    }
    const extendsClause = bases.length > 0 ? ` : ${bases.join(", ")}` : "";

    this.emitHeaderLineDirective(iface.sourceSpan.startLine);
    const classLine = this.currentHeaderLine;
    this.emitHeader(`class ${iface.name}${extendsClause} {`);
    this.emitHeader("public:");
    this.emitHeader(`    virtual ~${iface.name}() = default;`);
    this.emitHeader(
      `    static const char* __strucpp_interface_name() { return "${iface.name.toUpperCase()}"; }`,
    );
    this.recordHeaderLineMapping(iface.sourceSpan.startLine, classLine);

    for (const method of iface.methods) {
      const returnType = method.returnType
        ? this.mapMethodReturnTypeToCpp(method.returnType)
        : "void";
      const params = this.generateMethodParamList(method);
      if (method.sourceSpan) {
        this.emitHeaderLineDirective(method.sourceSpan.startLine);
        const methodLine = this.currentHeaderLine;
        this.emitHeader(
          `    virtual ${returnType} ${method.name}(${params}) = 0;`,
        );
        this.recordHeaderLineMapping(method.sourceSpan.startLine, methodLine);
      } else {
        this.emitHeader(
          `    virtual ${returnType} ${method.name}(${params}) = 0;`,
        );
      }
    }

    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Collect VAR_INST members from all methods of a function block.
   * These become name-mangled class members: __MethodName__varName
   */
  private collectVarInstMembers(
    fb: CompilationUnit["functionBlocks"][0],
  ): Array<{ mangledName: string; cppType: string }> {
    const result: Array<{ mangledName: string; cppType: string }> = [];
    for (const method of fb.methods) {
      for (const block of method.varBlocks) {
        if (block.blockType === "VAR_INST") {
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              result.push({
                mangledName: `__${method.name}__${name}`,
                cppType: this.mapTypeRefToCpp(decl.type),
              });
            }
          }
        }
      }
    }
    return result;
  }

  /**
   * Generate method declarations in the class header, grouped by visibility.
   */
  private generateMethodDeclarations(methods: MethodDeclaration[]): void {
    // Group by visibility
    const groups: Record<Visibility, MethodDeclaration[]> = {
      PUBLIC: [],
      PRIVATE: [],
      PROTECTED: [],
    };
    for (const method of methods) {
      groups[method.visibility].push(method);
    }

    // Track current visibility section (class starts as public:)
    let currentVisibility = "public";

    for (const [visibility, visMethods] of Object.entries(groups) as [
      Visibility,
      MethodDeclaration[],
    ][]) {
      if (visMethods.length === 0) continue;

      const cppVisibility = visibility.toLowerCase();
      if (cppVisibility !== currentVisibility) {
        this.emitHeader(`${cppVisibility}:`);
        currentVisibility = cppVisibility;
      }

      for (const method of visMethods) {
        const returnType = method.returnType
          ? this.mapMethodReturnTypeToCpp(method.returnType)
          : "void";
        const params = this.generateMethodParamList(method);

        // Build declaration with appropriate specifiers
        let prefix: string;
        let suffix: string;

        if (method.isAbstract) {
          prefix = "virtual ";
          suffix = " = 0";
        } else if (method.isOverride) {
          prefix = "";
          suffix = " override";
          if (method.isFinal) suffix += " final";
        } else {
          prefix = "virtual ";
          suffix = method.isFinal ? " final" : "";
        }

        this.emitHeaderLineDirective(method.sourceSpan.startLine);
        const methodLine = this.currentHeaderLine;
        this.emitHeader(
          `    ${prefix}${returnType} ${method.name}(${params})${suffix};`,
        );
        this.recordHeaderLineMapping(method.sourceSpan.startLine, methodLine);
      }
    }

    // Restore public section if we changed it (for destructor etc.)
    if (currentVisibility !== "public") {
      this.emitHeader("public:");
    }
  }

  /**
   * Mangle a parameter/local name that collides with a user-defined type name
   * or an interface method name in the current FB. This must match the
   * member-mangling applied by enterScope so the signature matches the body.
   */
  private mangleParamName(name: string, typeName?: string): string {
    const nameUpper = name.toUpperCase();
    if (this.currentFBInterfaceMethods.has(nameUpper)) {
      return `${name}_`;
    }
    if (
      typeName &&
      this.isUserDefinedType(typeName) &&
      nameUpper === typeName.toUpperCase()
    ) {
      return `${name}_`;
    }
    return name;
  }

  /**
   * Generate parameter list string for a method declaration.
   * VAR_INPUT, VAR_OUTPUT (by ref), VAR_IN_OUT (by ref) become C++ params.
   */
  private generateMethodParamList(method: MethodDeclaration): string {
    const params: string[] = [];
    for (const block of method.varBlocks) {
      if (block.blockType === "VAR_INPUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            const paramName = this.mangleParamName(name, decl.type.name);
            params.push(`${this.mapTypeRefToCpp(decl.type)} ${paramName}`);
          }
        }
      } else if (block.blockType === "VAR_IN_OUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            const paramName = this.mangleParamName(name, decl.type.name);
            // mapTypeRefToCpp preserves arrayDimensions / elementTypeName
            // (so inline ARRAY params emit Array1D<...>) while
            // toParamTypeRef strips STRING/WSTRING maxLength so any
            // string size binds to the &-reference.
            params.push(
              `${this.mapTypeRefToCpp(this.toParamTypeRef(decl.type))}& ${paramName}`,
            );
          }
        }
      } else if (block.blockType === "VAR_OUTPUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            const paramName = this.mangleParamName(name, decl.type.name);
            params.push(
              `${this.mapTypeRefToCpp(this.toParamTypeRef(decl.type))}& ${paramName}`,
            );
          }
        }
      }
    }
    return params.join(", ");
  }

  /**
   * Generate property getter/setter declarations in the class header.
   */
  private generatePropertyDeclarations(
    properties: PropertyDeclaration[],
  ): void {
    this.emitHeader("    // Properties");
    for (const prop of properties) {
      const type = this.mapTypeRefToCpp(prop.type);
      this.emitHeaderLineDirective(prop.sourceSpan.startLine);
      const propLine = this.currentHeaderLine;
      if (prop.getter) {
        this.emitHeader(`    virtual ${type} get_${prop.name}() const;`);
      }
      if (prop.setter) {
        this.emitHeader(
          `    virtual void set_${prop.name}(${type} ${prop.name});`,
        );
      }
      this.recordHeaderLineMapping(prop.sourceSpan.startLine, propLine);
    }
  }

  /**
   * Generate implementation for a method (in the .cpp file).
   * Follows the same return-variable pattern as functions.
   */
  private generateMethodImplementation(
    method: MethodDeclaration,
    className: string,
  ): void {
    const isIfaceReturn =
      method.returnType && this.isInterfaceType(method.returnType.name);
    const isRefToUserDefined =
      method.returnType && this.isReferenceToUserDefined(method.returnType);
    const returnType = method.returnType
      ? this.mapMethodReturnTypeToCpp(method.returnType)
      : "void";
    const params = this.generateMethodParamList(method);

    this.emitLineDirective(method.sourceSpan.startLine);
    const implLine = this.currentLine;
    this.emit(`${returnType} ${className}::${method.name}(${params}) {`);

    // Declare return variable if method has return type
    if (method.returnType) {
      if (isIfaceReturn) {
        // Interface return: assignments to result become return statements
        this.interfaceReturnMethod = true;
      } else {
        const lifecycleInit = ["FB_INIT", "FB_EXIT", "FB_REINIT"].includes(
          method.name.toUpperCase(),
        )
          ? " = IEC_BOOL(true)"
          : "";
        this.emit(
          `    ${this.mapMethodResultVarType(method.returnType)} ${method.name}_result${
            isRefToUserDefined ? " = nullptr" : lifecycleInit
          };`,
        );
      }
      this.currentFunctionName = method.name;
      this.currentFunctionReturnsReferenceToUserDefined = !!isRefToUserDefined;
    }

    // Set up VAR_INST name mangling
    this.varInstMangledNames.clear();
    for (const block of method.varBlocks) {
      if (block.blockType === "VAR_INST") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            this.varInstMangledNames.set(
              name.toUpperCase(),
              `__${method.name}__${name}`,
            );
          }
        }
      }
    }

    // Merge FB scope + method scope so FB member types are visible (same pattern as properties)
    this.enterScope([...this.currentFBVarBlocks, ...method.varBlocks]);
    this.setFBInoutFBPointers(this.currentFBVarBlocks);

    // Declare local variables (VAR, VAR_TEMP)
    for (const block of method.varBlocks) {
      if (block.blockType === "VAR" || block.blockType === "VAR_TEMP") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            const initValue = decl.initialValue
              ? ` = ${this.generateInitializer(decl.type, decl.initialValue)}`
              : "";
            this.emit(
              `    ${this.mapTypeRefToCpp(decl.type)} ${name}${initValue};`,
            );
          }
        }
      }
    }

    // Generate body
    if (method.body.length > 0) {
      this.generateStatements(method.body);
    }

    // Return if method has return type
    if (method.returnType) {
      if (!isIfaceReturn) {
        if (isRefToUserDefined) {
          // Guard against a missing REF= bind: a REFERENCE TO return must be
          // bound before the method exits. CODESYS requires the method to set
          // its return name with `<Method> ref= ...`; if it was not, fail
          // cleanly rather than dereferencing a null pointer.
          this.emit(`    if (${method.name}_result == nullptr) {`);
          this.emit(
            `        strucpp::iec_null_reference_fault("Unbound REFERENCE TO return value in method '${method.name}'");`,
          );
          this.emit("    }");
          this.emit(`    return *${method.name}_result;`);
        } else {
          this.emit(`    return ${method.name}_result;`);
        }
      }
      this.currentFunctionName = undefined;
      this.currentFunctionReturnsReferenceToUserDefined = false;
      this.interfaceReturnMethod = false;
    }

    // Clean up
    this.exitScope();
    this.varInstMangledNames.clear();

    this.emitLineDirective(method.sourceSpan.endLine);
    this.emit("}");
    this.emit("");
    this.recordLineMapping(method.sourceSpan.startLine, implLine);
  }

  /**
   * Generate implementation for a property (getter and/or setter in the .cpp file).
   */
  private generatePropertyImplementation(
    prop: PropertyDeclaration,
    className: string,
  ): void {
    const type = this.mapTypeRefToCpp(prop.type);

    // Helper to emit local VAR / VAR_TEMP declarations for an accessor
    const emitLocalVars = (varBlocks: VarBlock[] | undefined) => {
      if (!varBlocks) return;
      for (const block of varBlocks) {
        if (block.blockType === "VAR" || block.blockType === "VAR_TEMP") {
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              const initValue = decl.initialValue
                ? ` = ${this.generateExpression(decl.initialValue)}`
                : "";
              this.emit(
                `    ${this.mapTypeRefToCpp(decl.type)} ${name}${initValue};`,
              );
            }
          }
        }
      }
    };

    // Getter
    if (prop.getter) {
      this.emitLineDirective(prop.sourceSpan.startLine);
      const getterLine = this.currentLine;
      this.emit(`${type} ${className}::get_${prop.name}() const {`);
      this.enterScope([
        ...this.currentFBVarBlocks,
        ...(prop.getterVarBlocks ?? []),
      ]);
      this.setFBInoutFBPointers(this.currentFBVarBlocks);
      emitLocalVars(prop.getterVarBlocks);
      this.emit(`    ${type} ${prop.name}_result;`);
      this.currentFunctionName = prop.name;
      this.generateStatements(prop.getter);
      this.emit(`    return ${prop.name}_result;`);
      this.currentFunctionName = undefined;
      this.exitScope();
      this.emit("}");
      this.emit("");
      this.recordLineMapping(prop.sourceSpan.startLine, getterLine);
    }

    // Setter
    if (prop.setter) {
      this.emitLineDirective(prop.sourceSpan.startLine);
      const setterLine = this.currentLine;
      this.emit(`void ${className}::set_${prop.name}(${type} ${prop.name}) {`);
      this.enterScope([
        ...this.currentFBVarBlocks,
        ...(prop.setterVarBlocks ?? []),
      ]);
      this.setFBInoutFBPointers(this.currentFBVarBlocks);
      emitLocalVars(prop.setterVarBlocks);
      // In setter, prop.name refers to the input parameter (no redirection)
      this.generateStatements(prop.setter);
      this.exitScope();
      this.emit("}");
      this.emit("");
      this.recordLineMapping(prop.sourceSpan.startLine, setterLine);
    }
  }

  /**
   * Generate implementation for a program.
   */
  private generateProgramImplementation(
    prog: CompilationUnit["programs"][0],
  ): void {
    // Constructor
    this.emit(`Program_${prog.name}::Program_${prog.name}() {`);
    this.emit("    // Initialize variables");
    for (const block of prog.varBlocks) {
      for (const decl of block.declarations) {
        if (decl.initialValue !== undefined) {
          const initExpr = this.generateInitializer(
            decl.type,
            decl.initialValue,
          );
          for (const name of decl.names) {
            this.emit(`    ${name} = ${initExpr};`);
          }
        }
      }
    }

    // Initialize located variable pointers
    this.generateLocatedVarPointerInit(prog.name);

    this.emit("}");
    this.emit("");
    // PROGRAM line now maps to header class declaration, not constructor

    // Bind located variable pointers after static initialization is complete.
    this.generateBindLocatedVars(prog.name);

    // Run method
    this.emit(`void Program_${prog.name}::run() {`);
    this.enterScope(prog.varBlocks);
    if (prog.body.length > 0) {
      // Generate statements (Phase 2.8: only ExternalCodePragma; Phase 3+: all statements)
      this.generateStatements(prog.body);
    } else if (this.options.sourceComments) {
      this.emit("    // Empty program body");
    }
    this.exitScope();
    this.emitLineDirective(prog.sourceSpan.endLine);
    const closingBraceLine = this.currentLine;
    this.emit("}");
    this.emit("");
    this.recordLineMapping(prog.sourceSpan.endLine, closingBraceLine);
  }

  /**
   * Generate implementation for a function block.
   */
  private generateFBImplementation(
    fb: CompilationUnit["functionBlocks"][0],
  ): void {
    this.currentFBName = fb.name;
    this.currentFBExtends = fb.extends;
    this.currentFBVarBlocks = fb.varBlocks;
    this.currentFBInterfaceMethods = this.getInterfaceMethodNames(fb);

    // VAR_EXTERNAL: body access (operator(), methods, properties) is rewritten
    // to go through the GlobalVar pointer (g->read()/write()/with_lock), exactly
    // like a PROGRAM. Set for the whole implementation, cleared at the end.
    const externalDecls = fb.varBlocks
      .filter((b) => b.blockType === "VAR_EXTERNAL")
      .flatMap((b) =>
        b.declarations.flatMap((d) =>
          d.names.map((n) => ({ name: n, typeName: d.type.name })),
        ),
      );
    this.programExternals = new Set(
      externalDecls.map((e) => e.name.toUpperCase()),
    );
    this.compositeExternals = new Set(
      externalDecls
        .filter((e) => !isElementaryType(e.typeName))
        .map((e) => e.name.toUpperCase()),
    );

    // Constructor. VAR_EXTERNAL pointers and pointer-style VAR_IN_OUT members
    // are bound in the initializer list (they must be valid before FB_Init
    // runs). Nested scalar FB members are constructed with lifecycle suppressed
    // so the outer FB controls initialization order: outer FB_Init runs first,
    // then nested FBs are initialized depth-first. User-supplied initial values
    // are applied in __strucpp_fb_init AFTER FB_Init returns.
    const fbInits: string[] = [];
    const userInitStatements: string[] = [];
    const memberFBs: string[] = [];
    // Bind each VAR_EXTERNAL pointer to the file-scope canonical global. The
    // namespace qualifier disambiguates the global from the same-named pointer
    // member being initialized. File-scope visibility means this works no
    // matter how deeply the FB is instantiated — no pointer threading.
    if (externalDecls.length > 0) {
      const ns = this.projectModel
        ? getProjectNamespace(this.projectModel)
        : "strucpp";
      for (const e of externalDecls) {
        fbInits.push(`${e.name}(&${ns}::${e.name})`);
      }
    }
    for (const block of fb.varBlocks) {
      if (block.blockType === "VAR_EXTERNAL") continue;
      for (const decl of block.declarations) {
        const isPointerInout =
          block.blockType === "VAR_IN_OUT" &&
          (decl.type.arrayDimensions !== undefined ||
            decl.type.elementTypeName !== undefined ||
            this.isPointerInoutType(decl.type.name));
        const isScalarFB =
          decl.type.arrayDimensions === undefined &&
          !isPointerInout &&
          this.isFBType(decl.type.name);
        if (decl.initialValue) {
          const initExpr = this.generateInitializer(
            decl.type,
            decl.initialValue,
          );
          for (const name of decl.names) {
            const cppType = this.mapTypeRefToCpp(decl.type);
            const memberName = this.mangleMemberIfNeeded(
              name,
              cppType,
              decl.type.name,
            );
            userInitStatements.push(`    this->${memberName} = ${initExpr};`);
          }
        } else if (isPointerInout) {
          for (const name of decl.names) {
            const memberName = this.mangleMemberIfNeeded(
              name,
              decl.type.name,
              decl.type.name,
            );
            fbInits.push(`${memberName}(nullptr)`);
          }
        } else if (isScalarFB) {
          for (const name of decl.names) {
            const cppType = this.mapTypeRefToCpp(decl.type);
            const memberName = this.mangleMemberIfNeeded(
              name,
              cppType,
              decl.type.name,
            );
            fbInits.push(`${memberName}(false)`);
            memberFBs.push(memberName);
          }
        }
      }
    }
    const hasFBInit = fb.methods.some(
      (m) => m.name.toUpperCase() === "FB_INIT",
    );
    const hasFBExit = fb.methods.some(
      (m) => m.name.toUpperCase() === "FB_EXIT",
    );
    const hasNestedFB = memberFBs.length > 0;
    const baseName = fb.extends ?? undefined;
    const needsUserDestructor =
      hasFBExit || hasNestedFB || baseName !== undefined;

    // Constructor: delegates to lifecycle helpers. The default parameter lets
    // stand-alone instances run init automatically while nested members defer it
    // to the outer FB. Inherited FBs construct their base with lifecycle
    // disabled; the most-derived __strucpp_fb_init drives the whole chain once.
    const baseInit = baseName ? `${baseName}(false)` : "";
    const memberInit = fbInits.length > 0 ? fbInits.join(", ") : "";
    const lifecycleInit = `__strucpp_lifecycle_(__strucpp_lifecycle)`;
    let initList = baseInit;
    if (memberInit) {
      initList = initList ? `${initList}, ${memberInit}` : memberInit;
    }
    initList = initList ? `${initList}, ${lifecycleInit}` : lifecycleInit;
    this.emit(`${fb.name}::${fb.name}(bool __strucpp_lifecycle)`);
    this.emit(`    : ${initList} {`);
    this.emit(
      "    if (__strucpp_lifecycle_) this->__strucpp_fb_init(true, false);",
    );
    this.emit("}");
    this.emit("");

    // __strucpp_fb_init runs the base lifecycle, then FB_Init, then nested FBs,
    // then applies user-supplied initial values. CODESYS calls FB_Init before
    // initialization expression assignments become valid.
    this.emit(
      `void ${fb.name}::__strucpp_fb_init(bool bInitRetains, bool bInCopyCode) {`,
    );
    if (baseName) {
      this.emit(
        `    this->${baseName}::__strucpp_fb_init(bInitRetains, bInCopyCode);`,
      );
    }
    if (hasFBInit) {
      this.emit(`    this->${fb.name}::FB_INIT(bInitRetains, bInCopyCode);`);
    }
    for (const memberName of memberFBs) {
      this.emit(
        `    this->${memberName}.__strucpp_fb_init(bInitRetains, bInCopyCode);`,
      );
    }
    this.emit("    // Initialize variables");
    for (const stmt of userInitStatements) {
      this.emit(stmt);
    }
    this.emit("}");
    this.emit("");

    // __strucpp_fb_exit tears down nested FBs (innermost first), then FB_Exit,
    // then the base class lifecycle. The base lifecycle flag is cleared so the
    // base destructor does not run the base FB_Exit a second time.
    this.emit(`void ${fb.name}::__strucpp_fb_exit(bool bInCopyCode) {`);
    for (let i = memberFBs.length - 1; i >= 0; i--) {
      this.emit(`    this->${memberFBs[i]!}.__strucpp_fb_exit(bInCopyCode);`);
    }
    if (hasFBExit) {
      this.emit(`    this->${fb.name}::FB_EXIT(bInCopyCode);`);
    }
    if (baseName) {
      this.emit(`    this->${baseName}::__strucpp_fb_exit(bInCopyCode);`);
      this.emit(`    ${baseName}::__strucpp_lifecycle_ = false;`);
    }
    this.emit("}");
    this.emit("");

    // Operator()
    this.emitLineDirective(fb.sourceSpan.startLine);
    const fbImplLine = this.currentLine;
    this.emit(`void ${fb.name}::operator()() {`);
    if (this.options.isTestBuild) {
      this.emit("    if (__mocked_) { __mock_state_.call_count++; return; }");
    }
    this.enterScope(fb.varBlocks);
    this.setFBInoutFBPointers(fb.varBlocks);
    if (fb.body.length > 0) {
      this.generateStatements(fb.body);
    } else if (this.options.sourceComments) {
      this.emit("    // Empty function block body");
    }
    this.exitScope();
    this.emitLineDirective(fb.sourceSpan.endLine);
    this.emit("}");
    this.emit("");
    this.recordLineMapping(fb.sourceSpan.startLine, fbImplLine);

    // Method implementations
    for (const method of fb.methods) {
      if (!method.isAbstract) {
        this.generateMethodImplementation(method, fb.name);
      }
    }

    // Destructor with FB_Exit lifecycle call
    if (needsUserDestructor) {
      this.emit(`${fb.name}::~${fb.name}() {`);
      // Normal instance destruction (not an online change copy operation).
      this.emit(
        "    if (__strucpp_lifecycle_) this->__strucpp_fb_exit(false);",
      );
      this.emit("}");
      this.emit("");
    }

    // Property implementations (enter FB scope so FB member types are visible)
    for (const prop of fb.properties) {
      this.enterScope(fb.varBlocks);
      this.generatePropertyImplementation(prop, fb.name);
      this.exitScope();
    }

    // Interface query implementation
    if (fb.implements && fb.implements.length > 0) {
      this.emit(
        `bool ${fb.name}::__strucpp_query_interface(const char* id, void*& out) const {`,
      );
      for (const { upper, original } of this.getImplementedInterfaceNames(fb)) {
        this.emit(`    if (std::strcmp(id, "${upper}") == 0) {`);
        this.emit(
          `        out = static_cast<${original}*>(const_cast<${fb.name}*>(this));`,
        );
        this.emit(`        return true;`);
        this.emit(`    }`);
      }
      this.emit(`    return false;`);
      this.emit("}");
      this.emit("");
    }

    this.currentFBName = undefined;
    this.currentFBExtends = undefined;
    this.currentFBVarBlocks = [];
    this.currentFBInterfaceMethods = new Set();
    this.programExternals = new Set();
    this.compositeExternals = new Set();
  }

  /**
   * Generate implementation for a function.
   */
  private generateFunctionImplementation(
    func: CompilationUnit["functions"][0],
  ): void {
    const params = this.generateFunctionParams(func);
    const retType = this.mapTypeRefToCpp(func.returnType);

    // Helper to emit local variable declarations (VAR/VAR_TEMP) and body
    const emitFunctionBody = (funcName: string) => {
      this.emit(`    ${retType} ${funcName}_result;`);
      this.currentFunctionName = func.name;
      this.enterScope(func.varBlocks);

      // Declare local variables (VAR, VAR_TEMP) — same pattern as method locals
      for (const block of func.varBlocks) {
        if (block.blockType === "VAR" || block.blockType === "VAR_TEMP") {
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              const initValue = decl.initialValue
                ? ` = ${this.generateInitializer(decl.type, decl.initialValue)}`
                : "";
              this.emit(
                `    ${this.mapTypeRefToCpp(decl.type)} ${name}${initValue};`,
              );
            }
          }
        }
      }

      if (func.body.length > 0) {
        this.generateStatements(func.body);
      } else if (this.options.sourceComments) {
        this.emit("    // Empty function body");
      }
      this.exitScope();
      this.currentFunctionName = undefined;
      this.emit(`    return ${funcName}_result;`);
    };

    if (this.options.isTestBuild) {
      // Test build: generate _real, dispatch pointer, and wrapper
      // 1. _real implementation (original body with renamed function)
      this.emitLineDirective(func.sourceSpan.startLine);
      const realLine = this.currentLine;
      this.emit(`${retType} ${func.name}_real(${params.join(", ")}) {`);
      emitFunctionBody(func.name);
      this.emit("}");
      this.emit("");
      this.recordLineMapping(func.sourceSpan.startLine, realLine);

      // 2. Dispatch pointer (defaults to real implementation)
      this.emit(
        `${retType} (*${func.name}_dispatch)(${params.join(", ")}) = ${func.name}_real;`,
      );
      this.emit("");

      // 3. Wrapper that calls through dispatch pointer
      const paramNames = this.generateFunctionParamNames(func);
      this.emit(`${retType} ${func.name}(${params.join(", ")}) {`);
      this.emit(`    return ${func.name}_dispatch(${paramNames.join(", ")});`);
      this.emit("}");
      this.emit("");
    } else {
      // Production build: emit a normal function definition.
      this.emitLineDirective(func.sourceSpan.startLine);
      const funcImplLine = this.currentLine;
      this.emit(`${retType} ${func.name}(${params.join(", ")}) {`);
      emitFunctionBody(func.name);
      this.emit("}");
      this.emit("");
      this.recordLineMapping(func.sourceSpan.startLine, funcImplLine);
    }
  }

  /**
   * Generate function parameter name list (just names, no types).
   */
  private generateFunctionParamNames(
    func: CompilationUnit["functions"][0],
  ): string[] {
    const names: string[] = [];
    for (const block of func.varBlocks) {
      if (block.blockType === "VAR_INPUT" || block.blockType === "VAR_IN_OUT") {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            names.push(name);
          }
        }
      }
    }
    return names;
  }

  // ===========================================================================
  // Project Model-based Generation (Phase 2.1)
  // ===========================================================================

  /**
   * Generate header declaration for a program from the project model.
   * Handles VAR_EXTERNAL as reference members.
   */
  private generateProgramHeaderFromModel(prog: ProgramDecl): void {
    const className = `Program_${prog.name}`;
    const iecStructMembers: string[] = [];

    // Look up AST program for source spans
    const astProg = this.ast?.programs.find(
      (p) => p.name.toUpperCase() === prog.name.toUpperCase(),
    );

    if (astProg) {
      this.emitHeaderLineDirective(astProg.sourceSpan.startLine);
    }
    const classLine = this.currentHeaderLine;
    this.emitHeader(`class ${className} : public ProgramBase {`);
    this.emitHeader("public:");

    // Map PROGRAM line → class declaration
    if (astProg) {
      this.recordHeaderLineMapping(astProg.sourceSpan.startLine, classLine);
    }

    // Build name→sourceLine lookup from AST for variable mappings
    const varSourceLines = new Map<string, number>();
    if (astProg) {
      for (const block of astProg.varBlocks) {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            varSourceLines.set(name, decl.sourceSpan.startLine);
          }
        }
      }
    }

    // Collect retain variables for table generation
    const retainVars: Array<{ name: string; typeName: string }> = [];

    // Generate local variable members and collect located variables
    if (prog.varDeclarations.length > 0) {
      this.emitHeader("    // Local variables");
      for (const decl of prog.varDeclarations) {
        const constQualifier = decl.isConstant ? "const " : "";

        // Use mapTypeRefToCpp so inline ARRAY types (where typeName looks
        // like __INLINE_ARRAY_<T> and the bounds live alongside on the
        // ProjectVarDeclaration) get expanded to Array1D<T, L, U>. Going
        // through mapVarTypeToCpp directly would emit IEC___INLINE_ARRAY_<T>.
        const cppType = this.mapTypeRefToCpp({
          name: decl.typeName,
          ...(decl.maxLength !== undefined
            ? { maxLength: decl.maxLength }
            : {}),
          ...(decl.arrayDimensions !== undefined
            ? { arrayDimensions: decl.arrayDimensions }
            : {}),
          ...(decl.elementTypeName !== undefined
            ? { elementTypeName: decl.elementTypeName }
            : {}),
          ...(decl.elementReferenceKind !== undefined
            ? { elementReferenceKind: decl.elementReferenceKind }
            : {}),
          ...(decl.referenceKind !== undefined
            ? { referenceKind: decl.referenceKind }
            : {}),
        });
        const memberName = this.mangleMemberIfNeeded(
          decl.name,
          cppType,
          decl.typeName,
        );
        // Map variable ST line → header member line
        const stLine = varSourceLines.get(decl.name);
        if (stLine !== undefined) {
          this.emitHeaderLineDirective(stLine);
        }
        const memberLine = this.currentHeaderLine;
        if (decl.address) {
          this.emitHeader(
            `    ${constQualifier}${cppType} ${memberName};  // AT ${decl.address}`,
          );
          // Collect located variable info
          this.collectLocatedVarFromModel(
            { ...decl, cppName: memberName },
            prog.name,
          );
        } else {
          this.emitHeader(`    ${constQualifier}${cppType} ${memberName};`);
        }

        if (stLine !== undefined) {
          this.recordHeaderLineMapping(stLine, memberLine);
        }

        iecStructMembers.push(`${constQualifier}${cppType}`);

        // Collect retain variables (cppType — same metadata-aware lookup
        // as the member emission above, so inline arrays don't end up as
        // IEC___INLINE_ARRAY_<T> in the retain table either).
        if (decl.isRetain) {
          retainVars.push({
            name: decl.name,
            typeName: cppType,
          });
        }
      }
    }

    // Generate external variable members.
    //
    // A VAR_EXTERNAL reference to a CONFIGURATION VAR_GLOBAL is a pointer to the
    // single canonical GlobalVar<V> (which bundles the value + that global's own
    // mutex). Access goes through the pointer: `g->read()` / `g->write(v)` /
    // `g->with_lock(f)`. The lock is a no-op in the non-threaded build. Same
    // member shape and body code in both builds.
    if (prog.varExternal.length > 0) {
      // VAR_EXTERNAL records carry separate `name`/`typeName`;
      // projectVarToTypeRef + toParamTypeRef + mapTypeRefToCpp resolve the
      // C++ type the same way the constructor params do (must agree).
      const extTypes = prog.varExternal.map((ext) =>
        this.mapTypeRefToCpp(
          this.toParamTypeRef(this.projectVarToTypeRef(ext)),
        ),
      );
      this.emitHeader("    // External variables (pointers to shared globals)");
      for (let i = 0; i < prog.varExternal.length; i++) {
        const ext = prog.varExternal[i]!;
        // Every external — scalar or composite — is a pointer to its canonical
        // GlobalVar<V>. Composite globals (struct / array / function-block) can
        // be declared and debugged (the located image + debug table reach them
        // through `.value`); only their in-body ACCESS is currently gated, at
        // the access sites (see compositeExternals), because correct locked
        // field / element / call codegen is a follow-up phase.
        this.emitHeader(
          `    GlobalVar<${extTypes[i]!}>* ${ext.name} = nullptr;`,
        );
        iecStructMembers.push(`GlobalVar<${extTypes[i]!}>*`);
      }
    }

    this.emitHeader("");
    // Implicit IEC 61131-3 ENO pin (see generateProgramHeaderDeclaration
    // for the rationale; this is the project-model code path, same shape).
    this.emitHeader("    // Implicit IEC 61131-3 ENO pin (mirrors EN)");
    this.emitHeader("    IEC_BOOL ENO = true;");
    this.emitHeader("");
    this.emitHeader("    // Constructor");
    if (prog.varExternal.length > 0) {
      // Constructor takes a pointer to each canonical GlobalVar<V> (the
      // configuration owns the storage + mutex; the program just points at it).
      const params = prog.varExternal
        .map((ext) => {
          const cppType = this.mapTypeRefToCpp(
            this.toParamTypeRef(this.projectVarToTypeRef(ext)),
          );
          return `GlobalVar<${cppType}>* ${ext.name}_ref`;
        })
        .join(", ");
      this.emitHeader(`    explicit ${className}(${params});`);
    } else {
      this.emitHeader(`    ${className}();`);
    }
    this.emitHeader("");
    this.emitHeader("    // Run program");
    this.emitHeader("    void run() override;");

    if (this.locatedVars.some((v) => v.programName === prog.name)) {
      this.emitHeader("    // Bind located variable pointers at runtime");
      this.emitHeader("    void bind_located_vars() override;");
    }

    // Threaded-runtime override (STRUCPP_THREADED only): this program's slice
    // of the located-vars table, for PROGRAM-LOCAL `VAR AT` only. Shared globals
    // no longer use sync_in/sync_out — VAR_EXTERNAL access goes through the
    // GlobalVar pointer (per-global-mutex locked). `sync_in`/`sync_out` remain
    // reserved no-op vtable slots in ProgramBase for ABI stability; we simply
    // don't override them. Config-scope located globals are copied at the
    // barrier (owned by the configuration), so this range covers only this
    // program's own `VAR AT` declarations.
    const threadedRange = this.locatedRangeForProgram(prog.name);
    if (threadedRange.count > 0) {
      this.emitHeader("");
      this.emitHeader("#ifdef STRUCPP_THREADED");
      this.emitHeader(
        `    void located_range(uint32_t* __off, uint32_t* __cnt) const override { *__off = ${threadedRange.offset}; *__cnt = ${threadedRange.count}; }`,
      );
      this.emitHeader("#endif");
    }

    // Generate retain variable support if there are retain variables
    if (retainVars.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Retain variable support");
      this.emitHeader(
        `    static const RetainVarInfo __retain_vars[${retainVars.length}];`,
      );
      this.emitHeader(
        `    const RetainVarInfo* getRetainVars() const override { return __retain_vars; }`,
      );
      this.emitHeader(
        `    size_t getRetainCount() const override { return ${retainVars.length}; }`,
      );

      // Store retain vars for implementation file generation
      this.programRetainVars.set(prog.name, retainVars);
    }

    if (iecStructMembers.length > 0) {
      this.emitHeader("");
      this.emitHeader("    // Logical IEC byte size (for SIZEOF)");
      this.emitHeader(
        `    static constexpr std::size_t iec_byte_size = iec_struct_size<${iecStructMembers.join(", ")}>::value;`,
      );
    }

    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Generate implementation for a program from the project model.
   */
  private generateProgramImplementationFromModel(prog: ProgramDecl): void {
    // Look up AST program for source span
    const astProg = this.ast?.programs.find(
      (p) => p.name.toUpperCase() === prog.name.toUpperCase(),
    );

    // Constructor
    if (prog.varExternal.length > 0) {
      // Same metadata-aware type resolution as the matching declaration
      // in generateProgramHeaderFromModel — must agree byte-for-byte or
      // the linker rejects the definition.
      const params = prog.varExternal
        .map((ext) => {
          const cppType = this.mapTypeRefToCpp(
            this.toParamTypeRef(this.projectVarToTypeRef(ext)),
          );
          return `GlobalVar<${cppType}>* ${ext.name}_ref`;
        })
        .join(", ");
      this.emit(`Program_${prog.name}::Program_${prog.name}(${params})`);

      // Initializer list
      const inits: string[] = [];
      for (const decl of prog.varDeclarations) {
        // References (REF_TO / REFERENCE TO) and pointers (POINTER TO) wrap a
        // pointer internally and must be default-constructed (unbound/null) —
        // `name(0)` is ambiguous for IEC_REF_TO, and now also for IEC_Ptr,
        // which gained an integer-address ctor (the `0` literal matches both
        // the nullptr_t and the uintptr_t overload). The default ctor sets the
        // pointer to nullptr, which is exactly the IEC default. References are
        // bound later via REF= / := REF(); pointers via := ADR()/&.
        if (
          decl.referenceKind === "ref_to" ||
          decl.referenceKind === "reference_to" ||
          decl.referenceKind === "pointer_to"
        ) {
          continue;
        }
        const initVal = this.getDefaultValue(
          decl.typeName,
          decl.initialValue,
          decl.elementTypeName,
        );
        // Skip user-defined types (empty initVal) - they use default constructors
        if (initVal) {
          inits.push(`${decl.name}(${initVal})`);
        }
      }
      // External globals: bind the pointer member to the canonical GlobalVar<V>
      // passed by the configuration. Identical in both builds.
      const extInits = prog.varExternal.map(
        (ext) => `${ext.name}(${ext.name}_ref)`,
      );
      const combined = [...inits, ...extInits];
      if (combined.length > 0) {
        this.emit(`    : ${combined.join(", ")}`);
      }
      this.emit("{");

      // Initialize located variable pointers
      this.generateLocatedVarPointerInit(prog.name);

      this.emit("}");
    } else {
      this.emit(`Program_${prog.name}::Program_${prog.name}()`);
      // Initializer list for local variables
      const inits: string[] = [];
      for (const decl of prog.varDeclarations) {
        // References (REF_TO / REFERENCE TO) and pointers (POINTER TO) wrap a
        // pointer internally and must be default-constructed (unbound/null) —
        // `name(0)` is ambiguous for IEC_REF_TO, and now also for IEC_Ptr,
        // which gained an integer-address ctor (the `0` literal matches both
        // the nullptr_t and the uintptr_t overload). The default ctor sets the
        // pointer to nullptr, which is exactly the IEC default. References are
        // bound later via REF= / := REF(); pointers via := ADR()/&.
        if (
          decl.referenceKind === "ref_to" ||
          decl.referenceKind === "reference_to" ||
          decl.referenceKind === "pointer_to"
        ) {
          continue;
        }
        const initVal = this.getDefaultValue(
          decl.typeName,
          decl.initialValue,
          decl.elementTypeName,
        );
        // Skip user-defined types (empty initVal) - they use default constructors
        if (initVal) {
          inits.push(`${decl.name}(${initVal})`);
        }
      }
      if (inits.length > 0) {
        this.emit(`    : ${inits.join(", ")}`);
      }
      this.emit("{");

      // Initialize located variable pointers
      this.generateLocatedVarPointerInit(prog.name);

      this.emit("}");
    }
    this.emit("");
    // Bind located variable pointers after static initialization is complete.
    this.generateBindLocatedVars(prog.name);
    this.emit("");
    // PROGRAM line now maps to header class declaration, not constructor

    // Run method
    this.emit(`void Program_${prog.name}::run() {`);
    // VAR_EXTERNAL names for this program: body access to these is rewritten to
    // go through the GlobalVar pointer (g->read()/write()/with_lock).
    this.programExternals = new Set(
      prog.varExternal.map((ext) => ext.name.toUpperCase()),
    );
    this.compositeExternals = new Set(
      prog.varExternal
        .filter((ext) => !isElementaryType(ext.typeName))
        .map((ext) => ext.name.toUpperCase()),
    );
    if (astProg) {
      this.enterScope(astProg.varBlocks);
    }
    if (astProg && astProg.body.length > 0) {
      // Generate statements (Phase 2.8: only ExternalCodePragma; Phase 3+: all statements)
      this.generateStatements(astProg.body);
    } else if (this.options.sourceComments) {
      this.emit("    // Empty program body");
    }
    if (astProg) {
      this.exitScope();
      this.emitLineDirective(astProg.sourceSpan.endLine);
    }
    this.programExternals = new Set();
    this.compositeExternals = new Set();
    const closingBraceLine = this.currentLine;
    this.emit("}");
    this.emit("");
    if (astProg) {
      this.recordLineMapping(astProg.sourceSpan.endLine, closingBraceLine);
    }

    // Generate retain variable table if there are retain variables
    this.generateRetainTable(`Program_${prog.name}`, prog.name);
  }

  /**
   * Generate retain variable table for a class.
   */
  private generateRetainTable(className: string, progName: string): void {
    const retainVars = this.programRetainVars.get(progName);
    if (!retainVars || retainVars.length === 0) return;

    this.emit(`// Retain variable table for ${className}`);
    this.emit(`const RetainVarInfo ${className}::__retain_vars[] = {`);
    for (const v of retainVars) {
      this.emit(
        `    {"${v.name}", offsetof(${className}, ${v.name}), sizeof(${v.typeName})},`,
      );
    }
    this.emit("};");
    this.emit("");
  }

  /**
   * Emit configuration VAR_GLOBALs as file-scope `inline GlobalVar<V>`
   * singletons — one per unique name — instead of configuration-class members.
   *
   * File scope makes the single canonical storage (value + its own mutex)
   * reachable from every POU regardless of nesting: a program keeps receiving a
   * `GlobalVar<V>*` via the configuration constructor (which now hands over the
   * file-scope address), and a function block binds its VAR_EXTERNAL pointer
   * straight to `&<ns>::<name>` in its own constructor — no pointer threading
   * through containers. Must run before the FB/program/config classes so their
   * bodies can name the globals. Also registers located VAR_GLOBALs so the
   * runtime binds them to the I/O image.
   */
  private emitFileScopeGlobals(): void {
    if (!this.projectModel) return;
    const seen = new Set<string>();
    let emittedAny = false;
    for (const config of this.projectModel.configurations) {
      for (const gvar of config.globalVars) {
        const key = gvar.name.toUpperCase();
        // Same name across configurations = one canonical global (strucpp
        // already treats them as such); emit its storage once.
        if (seen.has(key)) continue;
        seen.add(key);

        const cppType = this.mapTypeRefToCpp({
          name: gvar.typeName,
          ...(gvar.maxLength !== undefined
            ? { maxLength: gvar.maxLength }
            : {}),
          ...(gvar.arrayDimensions !== undefined
            ? { arrayDimensions: gvar.arrayDimensions }
            : {}),
          ...(gvar.elementTypeName !== undefined
            ? { elementTypeName: gvar.elementTypeName }
            : {}),
          ...(gvar.elementReferenceKind !== undefined
            ? { elementReferenceKind: gvar.elementReferenceKind }
            : {}),
          ...(gvar.referenceKind !== undefined
            ? { referenceKind: gvar.referenceKind }
            : {}),
        });
        const initVal = this.getDefaultValue(
          gvar.typeName,
          gvar.initialValue,
          gvar.elementTypeName,
        );

        if (!emittedAny) {
          this.emitHeader(
            "// Configuration VAR_GLOBAL storage — file-scope so every POU " +
              "(program or nested function block) reaches the one canonical " +
              "GlobalVar<V> (value + mutex).",
          );
          emittedAny = true;
        }
        this.emitHeader(
          `inline GlobalVar<${cppType}> ${gvar.name}{${initVal}};`,
        );

        // A located VAR_GLOBAL (`AT %IX/%QX/%MW ...`) enters the located-vars
        // descriptor so the runtime binds it to the I/O image. Owner "@config"
        // (not a real program) keeps it out of every program's located_range.
        if (gvar.address) {
          this.collectLocatedVarFromModel(
            {
              name: gvar.name,
              cppName: gvar.name,
              typeName: gvar.typeName,
              address: gvar.address,
              isGlobalVarWrapper: true,
            },
            "@config",
          );
        }
      }
    }
    if (emittedAny) this.emitHeader("");
  }

  /**
   * Generate header declaration for a configuration from the project model.
   */
  private generateConfigurationHeaderFromModel(
    config: ConfigurationDecl,
  ): void {
    this.emitHeader(
      `class Configuration_${config.name} : public ConfigurationInstance {`,
    );
    this.emitHeader("public:");

    // VAR_GLOBALs are emitted as file-scope singletons (see
    // emitFileScopeGlobals), not configuration-class members, so every POU can
    // reach them. Nothing to declare inside the class here.

    // Generate program instance members
    const allInstances = this.collectProgramInstances(config);
    if (allInstances.length > 0) {
      this.emitHeader("    // Program instances");
      for (const inst of allInstances) {
        this.emitHeader(
          `    Program_${inst.programType} ${inst.instanceName};`,
        );
      }
      this.emitHeader("");
    }

    // Generate task and resource storage
    const taskCount = this.countTasks(config);
    const resourceCount = config.resources.length;
    if (taskCount > 0) {
      this.emitHeader("    // Task storage");
      this.emitHeader(`    TaskInstance tasks_storage[${taskCount}];`);
      this.emitHeader(
        `    ProgramBase* task_programs_storage[${allInstances.length > 0 ? allInstances.length : 1}];`,
      );
    }
    if (resourceCount > 0) {
      this.emitHeader("    // Resource storage");
      this.emitHeader(
        `    ResourceInstance resources_storage[${resourceCount}];`,
      );
    }
    this.emitHeader("");

    // Constructor
    this.emitHeader("    // Constructor");
    this.emitHeader(`    Configuration_${config.name}();`);
    this.emitHeader("");

    // ConfigurationInstance interface
    this.emitHeader("    // ConfigurationInstance interface");
    this.emitHeader("    const char* get_name() const override;");
    this.emitHeader("    ResourceInstance* get_resources() override;");
    this.emitHeader("    size_t get_resource_count() const override;");

    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Generate implementation for a configuration from the project model.
   */
  private generateConfigurationImplementationFromModel(
    config: ConfigurationDecl,
  ): void {
    const allInstances = this.collectProgramInstances(config);

    // Constructor
    this.emit(`Configuration_${config.name}::Configuration_${config.name}()`);

    // Initializer list
    const inits: string[] = [];

    // VAR_GLOBALs self-initialize at file scope (see emitFileScopeGlobals), so
    // there's nothing to init here.

    // Initialize program instances (with external variable references).
    // `&${ext.name}` now resolves to the file-scope global (the class no longer
    // shadows it with a member), so programs receive the same canonical pointer.
    for (const inst of allInstances) {
      const prog = this.projectModel?.programs.get(
        inst.programType.toUpperCase(),
      );
      if (prog && prog.varExternal.length > 0) {
        // Pass a pointer to each canonical GlobalVar<V> member.
        const args = prog.varExternal.map((ext) => `&${ext.name}`).join(", ");
        inits.push(`${inst.instanceName}(${args})`);
      } else {
        inits.push(`${inst.instanceName}()`);
      }
    }

    if (inits.length > 0) {
      this.emit(`    : ${inits.join(",")}`);
    }
    this.emit("{");

    // Wire up tasks and resources
    if (this.options.sourceComments) {
      this.emit("    // Wire up tasks and resources");
    }

    let taskIndex = 0;
    let programIndex = 0;
    let resourceIndex = 0;

    for (const resource of config.resources) {
      const resourceTaskStart = taskIndex;

      for (const task of resource.tasks) {
        const taskProgramStart = programIndex;

        // Store program pointers for this task
        for (const inst of task.programInstances) {
          this.emit(
            `    task_programs_storage[${programIndex}] = &${inst.instanceName};`,
          );
          programIndex++;
        }

        // Initialize task
        const intervalNs = task.interval?.nanoseconds ?? 0;
        const priority = task.priority ?? 0;
        const programCount = task.programInstances.length;
        this.emit(
          `    tasks_storage[${taskIndex}] = TaskInstance("${task.name}", ${intervalNs}LL, ${priority}, &task_programs_storage[${taskProgramStart}], ${programCount});`,
        );
        taskIndex++;
      }

      // Initialize resource
      const taskCount = resource.tasks.length;
      this.emit(
        `    resources_storage[${resourceIndex}] = ResourceInstance("${resource.name}", "${resource.processor}", &tasks_storage[${resourceTaskStart}], ${taskCount});`,
      );
      resourceIndex++;
    }

    // #172: bind located VAR_GLOBAL descriptor pointers to the canonical
    // storage (through the GlobalVar<V> wrapper's `.value`). The runtime copies
    // the I/O image to/from these pointers (locking each global's mutex on the
    // threaded path).
    this.generateLocatedVarPointerInit("@config");

    this.emit("}");
    this.emit("");

    // get_name()
    this.emit(`const char* Configuration_${config.name}::get_name() const {`);
    this.emit(`    return "${config.name}";`);
    this.emit("}");
    this.emit("");

    // get_resources()
    this.emit(
      `ResourceInstance* Configuration_${config.name}::get_resources() {`,
    );
    this.emit("    return resources_storage;");
    this.emit("}");
    this.emit("");

    // get_resource_count()
    this.emit(
      `size_t Configuration_${config.name}::get_resource_count() const {`,
    );
    this.emit(`    return ${config.resources.length};`);
    this.emit("}");
    this.emit("");
  }

  /**
   * Generate header declaration for a configuration from AST (fallback).
   */
  private generateConfigurationHeaderDeclaration(
    config: CompilationUnit["configurations"][0],
  ): void {
    this.emitHeader(
      `class Configuration_${config.name} : public ConfigurationInstance {`,
    );
    this.emitHeader("public:");

    // Generate VAR_GLOBAL members
    for (const block of config.varBlocks) {
      if (block.blockType === "VAR_GLOBAL") {
        this.emitHeader("    // VAR_GLOBAL variables");
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            this.emitHeader(`    ${this.mapTypeRefToCpp(decl.type)} ${name};`);
          }
        }
      }
    }

    this.emitHeader("");
    this.emitHeader("    // Constructor");
    this.emitHeader(`    Configuration_${config.name}();`);
    this.emitHeader("");
    this.emitHeader("    // ConfigurationInstance interface");
    this.emitHeader("    const char* get_name() const override;");
    this.emitHeader("    ResourceInstance* get_resources() override;");
    this.emitHeader("    size_t get_resource_count() const override;");
    this.emitHeader("};");
    this.emitHeader("");
  }

  /**
   * Generate implementation for a configuration from AST (fallback).
   */
  private generateConfigurationImplementation(
    config: CompilationUnit["configurations"][0],
  ): void {
    this.emit(`Configuration_${config.name}::Configuration_${config.name}() {`);
    this.emit("    // Initialize configuration");
    this.emit("}");
    this.emit("");

    this.emit(`const char* Configuration_${config.name}::get_name() const {`);
    this.emit(`    return "${config.name}";`);
    this.emit("}");
    this.emit("");

    this.emit(
      `ResourceInstance* Configuration_${config.name}::get_resources() {`,
    );
    this.emit("    return nullptr;");
    this.emit("}");
    this.emit("");

    this.emit(
      `size_t Configuration_${config.name}::get_resource_count() const {`,
    );
    this.emit("    return 0;");
    this.emit("}");
    this.emit("");
  }

  // ===========================================================================
  // Statement Generation (Phase 2.8+)
  // ===========================================================================

  /**
   * Generate code for a statement.
   */
  protected generateStatement(stmt: Statement, indent: string = "    "): void {
    this.currentStatementIndent = indent;
    this.emitLineDirective(stmt.sourceSpan.startLine);
    const cppStartLine = this.currentLine;
    // Compound statements handle their own line mappings internally
    let isCompound = false;
    switch (stmt.kind) {
      case "AssignmentStatement":
        this.generateAssignmentStatement(stmt, indent);
        break;
      case "RefAssignStatement":
        this.generateRefAssignStatement(stmt, indent);
        break;
      case "FunctionCallStatement": {
        if (stmt.call.kind === "MethodCallExpression") {
          this.emit(
            `${indent}${this.generateMethodCallExpression(stmt.call)};`,
          );
        } else if (stmt.call.functionName.toUpperCase() === "ADVANCE_TIME") {
          this.generateAdvanceTime(stmt.call, indent);
        } else {
          const fbType = this.getFBInvocationType(stmt.call.functionName);
          if (fbType) {
            this.generateFBInvocation(stmt.call, indent);
          } else if (
            stmt.call.kind === "FunctionCallExpression" &&
            this.hasEnEno(stmt.call.arguments)
          ) {
            // Non-FB function call statement with EN/ENO
            const { enExpr, enoVar, filteredArgs } = this.extractEnEno(
              stmt.call.arguments,
            );
            const modifiedCall: FunctionCallExpression = {
              ...stmt.call,
              arguments: filteredArgs,
            };
            const callExpr = this.generateFunctionCallExpression(modifiedCall);
            this.emitEnEnoWrapper(indent, enExpr, enoVar, (bi) => {
              this.emit(`${bi}${callExpr};`);
            });
          } else {
            this.emit(`${indent}${this.generateExpression(stmt.call)};`);
          }
        }
        break;
      }
      case "IfStatement":
        this.generateIfStatement(stmt, indent);
        isCompound = true;
        break;
      case "CaseStatement":
        this.generateCaseStatement(stmt, indent);
        isCompound = true;
        break;
      case "ForStatement":
        this.generateForStatement(stmt, indent);
        isCompound = true;
        break;
      case "WhileStatement":
        this.generateWhileStatement(stmt, indent);
        isCompound = true;
        break;
      case "RepeatStatement":
        this.generateRepeatStatement(stmt, indent);
        isCompound = true;
        break;
      case "ExitStatement": {
        const top = this.loopExitLabelStack[this.loopExitLabelStack.length - 1];
        if (top) {
          top.used = true;
          this.emit(`${indent}goto ${top.name};`);
        } else {
          // EXIT outside a loop is invalid IEC ST; emit defensive break
          // rather than crash codegen.
          this.emit(`${indent}break;`);
        }
        break;
      }
      case "ReturnStatement":
        this.generateReturnStatement(indent);
        break;
      case "ExternalCodePragma":
        this.generateExternalCodePragma(stmt, indent);
        break;
      case "DeleteStatement":
        this.emit(
          `${indent}strucpp::iec_delete(${this.generateExpression(stmt.pointer)});`,
        );
        break;
      case "AssertCall":
        // Assert calls only appear in test files, not in normal source compilation
        break;
      default: {
        const _exhaustive: never = stmt;
        throw new Error(
          `Unhandled statement kind: ${(_exhaustive as Statement).kind}`,
        );
      }
    }
    if (!isCompound) {
      this.recordLineMapping(stmt.sourceSpan.startLine, cppStartLine);
    }
  }

  /**
   * Generate code for an assignment statement.
   * ST: target := value;  →  C++: target = value;
   */
  private generateAssignmentStatement(
    stmt: AssignmentStatement,
    indent: string,
  ): void {
    // Check for property write: m.Speed := 75 → m.set_Speed(75)
    const propWrite = this.detectPropertyWrite(stmt.target);
    if (propWrite) {
      const value = this.generateExpression(stmt.value);
      this.emit(
        `${indent}${propWrite.objectCode}set_${propWrite.propertyName}(${value});`,
      );
      return;
    }

    // Composite / array shared-global WRITE (VAR_EXTERNAL to a composite
    // VAR_GLOBAL): take the global's own mutex and write the canonical directly
    // through with_lock. The RHS is computed into a temp first, so any
    // composite-global reads in it take + release their locks before we take the
    // target's lock — at most one global lock is ever held at a time.
    if (
      stmt.target.kind === "VariableExpression" &&
      !stmt.target.isDereference &&
      this.compositeExternals.has(stmt.target.name.toUpperCase())
    ) {
      this.emitCompositeGlobalWrite(stmt.target, stmt.value, indent);
      return;
    }

    // Bit access write: var.N := value → var = (var & ~(1ULL << N)) | ((value ? 1ULL : 0ULL) << N)
    // Uses 1ULL (64-bit) to avoid UB when bit index >= 32 (e.g., LWORD.33)
    if (
      stmt.target.kind === "VariableExpression" &&
      stmt.target.fieldAccess.length > 0 &&
      /^\d+$/.test(stmt.target.fieldAccess[stmt.target.fieldAccess.length - 1]!)
    ) {
      const bitIdx =
        stmt.target.fieldAccess[stmt.target.fieldAccess.length - 1]!;
      // Build the base variable (without the bit index)
      const baseVar: VariableExpression = {
        ...stmt.target,
        fieldAccess: stmt.target.fieldAccess.slice(0, -1),
      };
      // Also trim the accessChain if present
      if (stmt.target.accessChain) {
        const trimmed = this.trimLastFieldFromAccessChain(
          stmt.target.accessChain,
        );
        if (trimmed) {
          baseVar.accessChain = trimmed;
        } else {
          delete baseVar.accessChain;
        }
      }
      const baseCode = this.generateExpression(baseVar);
      const value = this.generateExpression(stmt.value);
      this.emit(
        `${indent}${baseCode} = (${baseCode} & ~(1ULL << ${bitIdx})) | ((${value} ? 1ULL : 0ULL) << ${bitIdx});`,
      );
      return;
    }

    // EN/ENO on function call assignment:
    // result := func(EN := cond, args..., ENO => eno_var);
    // → if (cond) { result = func(args); eno_var = true; } else { eno_var = false; }
    if (
      stmt.value.kind === "FunctionCallExpression" &&
      this.hasEnEno(stmt.value.arguments)
    ) {
      const { enExpr, enoVar, filteredArgs } = this.extractEnEno(
        stmt.value.arguments,
      );
      const target = this.generateExpression(stmt.target);
      const modifiedCall: FunctionCallExpression = {
        ...stmt.value,
        arguments: filteredArgs,
      };
      const callExpr = this.generateFunctionCallExpression(modifiedCall);
      this.emitEnEnoWrapper(indent, enExpr, enoVar, (bi) => {
        this.emit(`${bi}${target} = ${callExpr};`);
      });
      return;
    }

    // VAR_EXTERNAL scalar write → lock the shared global and set its value via
    // the pointer. (Struct/array/FB-instance external writes go through
    // with_lock at their emission sites.)
    if (
      stmt.target.kind === "VariableExpression" &&
      stmt.target.fieldAccess.length === 0 &&
      !stmt.target.isDereference &&
      this.programExternals.has(stmt.target.name.toUpperCase())
    ) {
      const value = this.generateExpression(stmt.value);
      this.emit(`${indent}${stmt.target.name}->write(${value});`);
      return;
    }

    const target = this.generateExpression(stmt.target);
    const isInterfaceTarget =
      stmt.target.kind === "VariableExpression" &&
      this.isInterfaceTypeRef({
        name:
          this.currentScopeVarTypes.get(stmt.target.name.toUpperCase()) ??
          stmt.target.name,
      });
    const value = isInterfaceTarget
      ? this.generatePointerExpression(stmt.value)
      : this.generateExpression(stmt.value);

    // For interface-returning methods, convert assignment to result var into return statement
    if (
      this.interfaceReturnMethod &&
      this.currentFunctionName &&
      target === `${this.currentFunctionName}_result`
    ) {
      const pointerValue = this.generatePointerExpression(stmt.value);
      this.emit(`${indent}return ${pointerValue};`);
      return;
    }

    this.emit(`${indent}${target} = ${value};`);
  }

  /**
   * Emit a write to a composite / array shared global (VAR_EXTERNAL to a
   * composite VAR_GLOBAL) under the global's own mutex via with_lock. The RHS is
   * hoisted to a temp BEFORE the lock is taken so its own composite-global reads
   * (each a self-contained with_lock) release before this write's lock is
   * acquired — guaranteeing at most one global lock held at a time. Handles
   * whole-object, field/element, and bit writes (the bit read-modify-write runs
   * inside the single lock, so it is atomic). The lock compiles out on
   * non-STRUCPP_THREADED builds (the guard lives inside GlobalVar::with_lock).
   */
  private emitCompositeGlobalWrite(
    target: VariableExpression,
    valueExpr: Expression,
    indent: string,
  ): void {
    const nameUpper = target.name.toUpperCase();
    const ptr = this.resolveVariableBaseName(target.name);
    const tmp = `__gwv_${this.tempVarCounter++}`;
    const value = this.generateExpression(valueExpr);
    this.emit(`${indent}auto ${tmp} = ${value};`);

    const lastField = target.fieldAccess[target.fieldAccess.length - 1];
    const isBitWrite =
      target.fieldAccess.length > 0 && /^\d+$/.test(lastField ?? "");

    if (isBitWrite) {
      // Base without the trailing bit index, rendered on the lock lambda param.
      const baseVar: VariableExpression = {
        ...target,
        fieldAccess: target.fieldAccess.slice(0, -1),
      };
      if (target.accessChain) {
        const trimmed = this.trimLastFieldFromAccessChain(target.accessChain);
        if (trimmed) baseVar.accessChain = trimmed;
        else delete baseVar.accessChain;
      }
      const lv = this.renderAccessTail("(*__glk)", baseVar, nameUpper);
      this.emit(
        `${indent}${ptr}->with_lock([&](auto* __glk){ ${lv} = (${lv} & ~(1ULL << ${lastField})) | ((${tmp} ? 1ULL : 0ULL) << ${lastField}); });`,
      );
      return;
    }

    const lv = this.renderAccessTail("(*__glk)", target, nameUpper);
    this.emit(
      `${indent}${ptr}->with_lock([&](auto* __glk){ ${lv} = ${tmp}; });`,
    );
  }

  /**
   * Generate code for a REF= rebind. The lowering depends on the target's
   * reference kind, because the two runtime wrappers expose different APIs:
   *
   *   REFERENCE TO (IEC_REFERENCE_TO)  →  target.bind(source);
   *   REF_TO       (IEC_REF_TO)        →  target = REF(source);
   *
   * IEC_REF_TO has no bind() — it rebinds via assignment from REF()/ADR() —
   * so emitting bind() unconditionally (the old behaviour) failed to compile
   * for REF_TO targets.
   */
  private generateRefAssignStatement(
    stmt: RefAssignStatement,
    indent: string,
  ): void {
    const target = this.generateExpression(stmt.target);
    // REF= to the current method's result variable for a REFERENCE TO
    // user-defined return type is a pointer assignment, not a bind() call.
    const isMethodResultRef =
      stmt.target.kind === "VariableExpression" &&
      this.currentFunctionName !== undefined &&
      stmt.target.name.toUpperCase() ===
        this.currentFunctionName.toUpperCase() &&
      this.currentFunctionReturnsReferenceToUserDefined;
    if (isMethodResultRef) {
      const sourcePtr = this.generatePointerExpression(stmt.source);
      this.emit(`${indent}${target} = ${sourcePtr};`);
      return;
    }
    const targetKind =
      stmt.target.kind === "VariableExpression"
        ? this.currentScopeVarRefKinds.get(stmt.target.name.toUpperCase())
        : undefined;
    // REF= 0 / REF= NULL unbinds a reference.
    const isNullSource =
      stmt.source.kind === "LiteralExpression" &&
      (stmt.source.literalType === "NULL" ||
        (stmt.source.literalType === "INT" &&
          (stmt.source.value === 0 ||
            (typeof stmt.source.value === "string" &&
              parseInt(stmt.source.value, 10) === 0))));
    if (isNullSource) {
      if (targetKind === "ref_to") {
        this.emit(`${indent}${target} = IEC_NULL;`);
      } else {
        // REFERENCE_TO and any other reference-like target bind to NULL.
        this.emit(`${indent}${target}.bind(IEC_NULL);`);
      }
      return;
    }
    const source = this.generateExpression(stmt.source);
    if (targetKind === "ref_to") {
      this.emit(`${indent}${target} = REF(${source});`);
    } else {
      // REFERENCE_TO (and the default) rebind via bind().
      this.emit(`${indent}${target}.bind(${source});`);
    }
  }

  /**
   * Generate code for an external code pragma.
   * The code content is emitted AS-IS to the output.
   */
  private generateExternalCodePragma(
    pragma: ExternalCodePragma,
    indent: string,
  ): void {
    // Split the code into lines and emit each with proper indentation
    const lines = pragma.code.split(/\r?\n/);
    for (const line of lines) {
      // Emit the line with base indentation
      // The code is emitted AS-IS, but we add the base indent for consistency
      if (line.trim() === "") {
        this.emit("");
      } else {
        this.emit(`${indent}${line}`);
      }
    }
  }

  // ===========================================================================
  // Control Flow Statement Generation (Phase 3.2)
  // ===========================================================================

  /**
   * Generate code for an IF statement.
   * ST: IF/ELSIF/ELSE → C++: if/else if/else
   */
  private generateIfStatement(stmt: IfStatement, indent: string): void {
    const ifLine = this.currentLine;
    this.emit(`${indent}if (${this.generateExpression(stmt.condition)}) {`);
    this.recordLineMapping(stmt.sourceSpan.startLine, ifLine);
    this.generateStatements(stmt.thenStatements, indent + this.options.indent);

    for (const elsif of stmt.elsifClauses) {
      this.emitLineDirective(elsif.sourceSpan.startLine);
      const elsifLine = this.currentLine;
      this.emit(
        `${indent}} else if (${this.generateExpression(elsif.condition)}) {`,
      );
      this.recordLineMapping(elsif.sourceSpan.startLine, elsifLine);
      this.generateStatements(elsif.statements, indent + this.options.indent);
    }

    if (stmt.elseStatements.length > 0) {
      // Map ELSE to the `} else {` line. Use endLine-1 as an approximation
      // for the ELSE keyword line (one line before END_IF).
      // The ELSE doesn't have its own AST node, so we derive from context.
      let elseStLine: number | undefined;
      if (stmt.elsifClauses.length > 0) {
        elseStLine =
          stmt.elsifClauses[stmt.elsifClauses.length - 1]!.sourceSpan.endLine +
          1;
      } else if (stmt.thenStatements.length > 0) {
        elseStLine =
          stmt.thenStatements[stmt.thenStatements.length - 1]!.sourceSpan
            .endLine + 1;
      }
      if (elseStLine !== undefined) {
        this.emitLineDirective(elseStLine);
      }
      const elseLine = this.currentLine;
      this.emit(`${indent}} else {`);
      if (elseStLine !== undefined) {
        this.recordLineMapping(elseStLine, elseLine);
      }
      this.generateStatements(
        stmt.elseStatements,
        indent + this.options.indent,
      );
    }

    this.emitLineDirective(stmt.sourceSpan.endLine);
    const closingLine = this.currentLine;
    this.emit(`${indent}}`);
    this.recordLineMapping(stmt.sourceSpan.endLine, closingLine);
  }

  /**
   * Generate code for a CASE statement.
   * ST: CASE/OF → C++: switch/case with range expansion
   */
  private generateCaseStatement(stmt: CaseStatement, indent: string): void {
    const switchLine = this.currentLine;
    this.emit(`${indent}switch (${this.generateExpression(stmt.selector)}) {`);
    this.recordLineMapping(stmt.sourceSpan.startLine, switchLine);
    const innerIndent = indent + this.options.indent;
    const bodyIndent = innerIndent + this.options.indent;

    for (const caseElement of stmt.cases) {
      this.emitLineDirective(caseElement.sourceSpan.startLine);
      const caseLabelLine = this.currentLine;
      for (const label of caseElement.labels) {
        if (label.end) {
          // Range: expand to individual case labels
          const startVal = this.evaluateLiteralInt(label.start);
          const endVal = this.evaluateLiteralInt(label.end);
          if (startVal !== undefined && endVal !== undefined) {
            for (let i = startVal; i <= endVal; i++) {
              this.emit(`${innerIndent}case ${i}:`);
            }
          } else {
            // Fallback: emit as comment with expression
            this.emit(
              `${innerIndent}case ${this.generateExpression(label.start)}: // range to ${this.generateExpression(label.end)}`,
            );
          }
        } else {
          this.emit(
            `${innerIndent}case ${this.generateExpression(label.start)}:`,
          );
        }
      }
      this.recordLineMapping(caseElement.sourceSpan.startLine, caseLabelLine);
      this.generateStatements(caseElement.statements, bodyIndent);
      this.emit(`${bodyIndent}break;`);
    }

    if (stmt.elseStatements.length > 0) {
      this.emit(`${innerIndent}default:`);
      this.generateStatements(stmt.elseStatements, bodyIndent);
      this.emit(`${bodyIndent}break;`);
    }

    this.emitLineDirective(stmt.sourceSpan.endLine);
    const closingLine = this.currentLine;
    this.emit(`${indent}}`);
    this.recordLineMapping(stmt.sourceSpan.endLine, closingLine);
  }

  /**
   * Generate code for an ADVANCE_TIME(duration) statement.
   * Used in both normal program bodies and test blocks to advance the
   * simulated current time by the given TIME expression (nanoseconds).
   */
  private generateAdvanceTime(
    call: FunctionCallExpression,
    indent: string,
  ): void {
    if (call.arguments.length !== 1 || call.arguments[0]!.isOutput) {
      this.emit(
        `${indent}static_assert(false, "ADVANCE_TIME requires one input duration");`,
      );
      return;
    }
    const duration = this.generateExpression(call.arguments[0]!.value);
    this.emit(
      `${indent}strucpp::__CURRENT_TIME_NS += static_cast<int64_t>(${duration});`,
    );
  }

  /**
   * Generate code for a FOR statement.
   *
   * IEC 61131-3 evaluates the start, end and step expressions once at loop
   * entry. The generated C++ captures end and step in temporaries so the loop
   * condition and increment do not re-evaluate them on every iteration.
   */
  private generateForStatement(stmt: ForStatement, indent: string): void {
    // In function bodies, the control variable may be the function name (IEC ST return variable)
    let varName = stmt.controlVariable;
    if (
      this.currentFunctionName &&
      varName.toUpperCase() === this.currentFunctionName.toUpperCase()
    ) {
      varName = `${this.currentFunctionName}_result`;
    }
    const start = this.generateExpression(stmt.start);
    const endExpr = this.generateExpression(stmt.end);
    const endVal = this.evaluateLiteralInt(stmt.end);

    const stepExpr = stmt.step ? this.generateExpression(stmt.step) : "1";
    const stepVal = stmt.step ? this.evaluateLiteralInt(stmt.step) : 1;

    // IEC 61131-3 evaluates the end value and step once at loop entry.
    // Capture non-constant expressions in temporaries so the C++ for-loop
    // header does not re-evaluate them on every iteration.
    let endRef = endExpr;
    let stepRef = stepExpr;
    const needsEndTemp = endVal === undefined;
    const needsStepTemp = stepVal === undefined;
    const needsScopeBlock = needsEndTemp || needsStepTemp;

    const outerIndent = indent;
    const innerIndent = needsScopeBlock ? indent + this.options.indent : indent;

    if (needsScopeBlock) {
      this.emit(`${outerIndent}{`);
      if (needsEndTemp) {
        endRef = `__strucpp_for_end_${this.tempVarCounter++}`;
        this.emit(`${innerIndent}const auto ${endRef} = ${endExpr};`);
      }
      if (needsStepTemp) {
        stepRef = `__strucpp_for_step_${this.tempVarCounter++}`;
        this.emit(`${innerIndent}const auto ${stepRef} = ${stepExpr};`);
      }
    }

    const forLine = this.currentLine;
    if (needsStepTemp) {
      this.emit(
        `${innerIndent}for (${varName} = ${start}; (${stepRef} >= 0 ? ${varName} <= ${endRef} : ${varName} >= ${endRef}); ${varName} += ${stepRef}) {`,
      );
    } else if (stepVal !== undefined && stepVal < 0) {
      this.emit(
        `${innerIndent}for (${varName} = ${start}; ${varName} >= ${endRef}; ${varName} += ${stepRef}) {`,
      );
    } else {
      const increment =
        stepVal === 1 ? `${varName}++` : `${varName} += ${stepRef}`;
      this.emit(
        `${innerIndent}for (${varName} = ${start}; ${varName} <= ${endRef}; ${increment}) {`,
      );
    }
    this.recordLineMapping(stmt.sourceSpan.startLine, forLine);

    const exitLabel = {
      name: `__strucpp_loop_exit_${this.loopExitLabelCounter++}`,
      used: false,
    };
    this.loopExitLabelStack.push(exitLabel);
    this.generateStatements(stmt.body, innerIndent + this.options.indent);
    this.loopExitLabelStack.pop();
    this.emitLineDirective(stmt.sourceSpan.endLine);
    const closingLine = this.currentLine;
    this.emit(`${innerIndent}}`);
    if (exitLabel.used) this.emit(`${innerIndent}${exitLabel.name}: ;`);
    if (needsScopeBlock) {
      this.emit(`${outerIndent}}`);
    }
    this.recordLineMapping(stmt.sourceSpan.endLine, closingLine);
  }

  /**
   * Generate code for a WHILE statement.
   * ST: WHILE condition DO → C++: while (condition)
   */
  private generateWhileStatement(stmt: WhileStatement, indent: string): void {
    const whileLine = this.currentLine;
    this.emit(`${indent}while (${this.generateExpression(stmt.condition)}) {`);
    this.recordLineMapping(stmt.sourceSpan.startLine, whileLine);
    const exitLabel = {
      name: `__strucpp_loop_exit_${this.loopExitLabelCounter++}`,
      used: false,
    };
    this.loopExitLabelStack.push(exitLabel);
    this.generateStatements(stmt.body, indent + this.options.indent);
    this.loopExitLabelStack.pop();
    this.emitLineDirective(stmt.sourceSpan.endLine);
    const closingLine = this.currentLine;
    this.emit(`${indent}}`);
    if (exitLabel.used) this.emit(`${indent}${exitLabel.name}: ;`);
    this.recordLineMapping(stmt.sourceSpan.endLine, closingLine);
  }

  /**
   * Generate code for a REPEAT statement.
   * ST: REPEAT ... UNTIL condition → C++: do { ... } while (!(condition))
   */
  private generateRepeatStatement(stmt: RepeatStatement, indent: string): void {
    const doLine = this.currentLine;
    this.emit(`${indent}do {`);
    this.recordLineMapping(stmt.sourceSpan.startLine, doLine);
    const exitLabel = {
      name: `__strucpp_loop_exit_${this.loopExitLabelCounter++}`,
      used: false,
    };
    this.loopExitLabelStack.push(exitLabel);
    this.generateStatements(stmt.body, indent + this.options.indent);
    this.loopExitLabelStack.pop();
    this.emitLineDirective(stmt.sourceSpan.endLine);
    const untilLine = this.currentLine;
    this.emit(
      `${indent}} while (!(${this.generateExpression(stmt.condition)}));`,
    );
    if (exitLabel.used) this.emit(`${indent}${exitLabel.name}: ;`);
    this.recordLineMapping(stmt.sourceSpan.endLine, untilLine);
  }

  /**
   * Generate code for a RETURN statement.
   * In functions: return functionName_result;
   * In programs/FBs: return;
   */
  private generateReturnStatement(indent: string): void {
    if (this.interfaceReturnMethod) {
      // Interface-returning methods return an interface pointer. A bare `RETURN;`
      // returns a pointer to the current instance.
      this.emit(`${indent}return this;`);
    } else if (
      this.currentFunctionName &&
      this.currentFunctionReturnsReferenceToUserDefined
    ) {
      // A REFERENCE TO return must be bound before the method exits. If the
      // method body hits a `RETURN;` before the REF= assignment, fail cleanly
      // instead of dereferencing a null pointer.
      const resultVar = `${this.currentFunctionName}_result`;
      this.emit(`${indent}if (${resultVar} == nullptr) {`);
      this.emit(
        `        strucpp::iec_null_reference_fault("Unbound REFERENCE TO return value in method '${this.currentFunctionName}'");`,
      );
      this.emit(`${indent}}`);
      this.emit(`${indent}return *${resultVar};`);
    } else if (this.currentFunctionName) {
      this.emit(`${indent}return ${this.currentFunctionName}_result;`);
    } else {
      this.emit(`${indent}return;`);
    }
  }

  /**
   * Evaluate an expression as a literal integer value (for CASE ranges and FOR step direction).
   * Returns undefined if the expression is not a compile-time integer constant.
   */
  private evaluateLiteralInt(expr: Expression): number | undefined {
    if (expr.kind === "LiteralExpression" && expr.literalType === "INT") {
      return typeof expr.value === "number"
        ? expr.value
        : parseInt(String(expr.value), 10);
    }
    if (
      expr.kind === "UnaryExpression" &&
      expr.operator === "-" &&
      expr.operand.kind === "LiteralExpression"
    ) {
      const val = this.evaluateLiteralInt(expr.operand);
      return val !== undefined ? -val : undefined;
    }
    return undefined;
  }

  /**
   * Generate code for a list of statements.
   */
  private generateStatements(
    stmts: Statement[],
    indent: string = "    ",
  ): void {
    for (const stmt of stmts) {
      this.generateStatement(stmt, indent);
    }
  }

  // ===========================================================================
  // Expression Generation (Phase 3.1)
  // ===========================================================================

  /**
   * Generate C++ code for an expression.
   * Returns the C++ expression as a string.
   */
  protected generateExpression(expr: Expression): string {
    switch (expr.kind) {
      case "LiteralExpression":
        return this.generateLiteralExpression(expr);
      case "VariableExpression":
        return this.generateVariableExpression(expr);
      case "BinaryExpression":
        return this.generateBinaryExpression(expr);
      case "UnaryExpression":
        return this.generateUnaryExpression(expr);
      case "ParenthesizedExpression":
        return `(${this.generateExpression(expr.expression)})`;
      case "FunctionCallExpression":
        return this.generateFunctionCallExpression(expr);
      case "MethodCallExpression":
        return this.generateMethodCallExpression(expr);
      case "RefExpression":
        return `REF(${this.generateExpression(expr.operand)})`;
      case "DrefExpression":
        return `${this.generateExpression(expr.operand)}.deref()`;
      case "NewExpression": {
        const cppType = this.typeCodeGen.mapTypeToCpp(expr.allocationType.name);
        if (expr.arraySize) {
          return `strucpp::iec_new_array<${cppType}>(${this.generateExpression(expr.arraySize)})`;
        }
        return `strucpp::iec_new<${cppType}>()`;
      }
      case "ArrayLiteralExpression": {
        const elements = expr.elements.map((e) => this.generateExpression(e));
        return `{${elements.join(", ")}}`;
      }
      case "QueryInterfaceExpression": {
        return this.generateQueryInterfaceExpression(expr);
      }
      case "VarInfoExpression": {
        return this.generateVarInfoExpression(expr);
      }
    }
    throw new Error("Unsupported expression kind");
  }

  /**
   * Generate C++ for a __VARINFO(variable) expression.
   *
   * Builds a compile-time strucpp::VAR_INFO descriptor from the target
   * variable's resolved type and declaration metadata.
   */
  private generateVarInfoExpression(expr: VarInfoExpression): string {
    const arg = expr.argument;
    const symbolName = this.generateVarInfoSymbol(arg);

    const cached = this.varInfoDescriptorCache.get(symbolName);
    if (cached) return cached;

    const access = this.resolveVarInfoAccess(arg);
    const { baseDecl, baseBlock, finalDecl, finalType, byteOffsetExpr } =
      access;

    // Resolve the final target type (after field/array access) from the
    // type-checker annotation, then fall back to the declaration's type name.
    let targetType: IECType | undefined = finalType ?? arg.resolvedType;
    const declaration = finalDecl;
    if (!targetType && declaration) {
      targetType = this.resolveTypeByName(declaration.type.name);
    }

    let typeClassName = "TYPE_NONE";
    let typeName = "TYPE_NONE";
    let bitSizeExpr = "0u";
    let elemBitSizeExpr = "0u";
    let numElements = 0;
    let baseTypeClassName = "TYPE_BOOL";

    const compositeBitSize = (cppType: string): string =>
      `static_cast<uint32_t>(strucpp::iec_sizeof<${cppType}>::value * 8u)`;

    if (targetType?.typeKind === "array") {
      const arr = targetType as ArrayType;
      typeClassName = "TYPE_ARRAY";
      typeName = "ARRAY";
      numElements = 1;
      for (const dim of arr.dimensions) {
        numElements *= Math.max(1, dim.end - dim.start + 1);
      }
      const baseTypeClass = resolveTypeClass(arr.elementType);
      baseTypeClassName = TYPE_CLASS_NAME.get(baseTypeClass) ?? "TYPE_NONE";
      const elemKind = arr.elementType.typeKind;
      const elemName = declaration?.type.elementTypeName;
      const isCompositeElement =
        elemKind === "struct" ||
        elemKind === "functionBlock" ||
        elemKind === "program" ||
        (elemKind === "elementary" &&
          elemName !== undefined &&
          (this.isCompositeTypeName(elemName) ||
            this.isRuntimeSizedElementaryTypeName(elemName)));
      if (elemName && isCompositeElement) {
        // Composite array elements: SIZEOF must include padding and match the
        // actual Array1D<...> storage layout.
        bitSizeExpr = compositeBitSize(this.mapTypeRefToCpp(declaration.type));
        elemBitSizeExpr = compositeBitSize(this.mapVarTypeToCpp(elemName));
      } else {
        const elemBits = this.getTypeBitsForIECType(arr.elementType);
        bitSizeExpr = `${numElements * elemBits}u`;
        elemBitSizeExpr = `${elemBits}u`;
      }
    } else if (
      declaration?.type.arrayDimensions &&
      declaration.type.arrayDimensions.length > 0 &&
      declaration.type.elementTypeName
    ) {
      // Inline ARRAY [...] OF T uses a synthetic __INLINE_ARRAY_<T> elementary
      // type in the type-checker; recover the real shape from the declaration.
      const elementType = this.resolveTypeByName(
        declaration.type.elementTypeName,
      );
      numElements = 1;
      for (const dim of declaration.type.arrayDimensions) {
        numElements *= Math.max(1, dim.end - dim.start + 1);
      }
      typeClassName = "TYPE_ARRAY";
      typeName = "ARRAY";
      const baseTypeClass = elementType
        ? resolveTypeClass(elementType)
        : TYPE_CLASS.TYPE_NONE;
      baseTypeClassName = TYPE_CLASS_NAME.get(baseTypeClass) ?? "TYPE_NONE";
      const elemKind = elementType?.typeKind;
      const elemName = declaration.type.elementTypeName;
      const isCompositeElement =
        elemKind === "struct" ||
        elemKind === "functionBlock" ||
        elemKind === "program" ||
        (elemKind === "elementary" &&
          (this.isCompositeTypeName(elemName) ||
            this.isRuntimeSizedElementaryTypeName(elemName)));
      if (elementType && isCompositeElement) {
        bitSizeExpr = compositeBitSize(this.mapTypeRefToCpp(declaration.type));
        elemBitSizeExpr = compositeBitSize(this.mapVarTypeToCpp(elemName));
      } else {
        const elemBits = elementType
          ? this.getTypeBitsForIECType(elementType)
          : 0;
        bitSizeExpr = `${numElements * elemBits}u`;
        elemBitSizeExpr = `${elemBits}u`;
      }
    } else if (targetType) {
      const typeClass = resolveTypeClass(targetType);
      typeClassName = TYPE_CLASS_NAME.get(typeClass) ?? "TYPE_NONE";
      typeName = typeNameUtil(targetType);
      const isComposite =
        targetType.typeKind === "struct" ||
        targetType.typeKind === "functionBlock" ||
        targetType.typeKind === "program" ||
        (targetType.typeKind === "elementary" &&
          declaration !== undefined &&
          (this.isCompositeTypeName(declaration.type.name) ||
            this.isRuntimeSizedElementaryTypeName(declaration.type.name)));
      if (isComposite) {
        const cppType = declaration
          ? this.mapTypeRefToCpp(declaration.type)
          : typeNameUtil(targetType);
        bitSizeExpr = compositeBitSize(cppType);
      } else {
        bitSizeExpr = `${this.getTypeBitsForIECType(targetType)}u`;
      }
    }

    const comment = declaration?.comment ?? "";

    const address = this.inferVarInfoAddressFields(
      baseDecl,
      baseBlock,
      symbolName,
    );
    if (byteOffsetExpr !== "0") {
      address.byteOffset =
        address.byteOffset === "0"
          ? byteOffsetExpr
          : `(${address.byteOffset}) + (${byteOffsetExpr})`;
    }

    const id = this.varInfoSymbolIds.get(symbolName) ?? ++this.varInfoCounter;
    const descriptorName = `__strucpp_varinfo_${id}`;

    const fields = [
      `/*BYTEADDRESS=*/ IEC_DWORD(${this.formatHex(address.byteAddress)}u)`,
      `/*BYTEOFFSET=*/ IEC_DINT(${address.byteOffset})`,
      `/*AREA=*/ IEC_INT(${address.area})`,
      `/*BITNR=*/ IEC_INT(${address.bitNr})`,
      `/*BITSIZE=*/ IEC_UDINT(${bitSizeExpr})`,
      `/*BITADDRESS=*/ IEC_UDINT(${address.bitAddress}u)`,
      `/*TYPECLASS=*/ IEC_TYPE_CLASS(strucpp::__SYSTEM::TYPE_CLASS::${typeClassName})`,
      `/*TYPENAME=*/ strucpp::IECString<79>("${this.escapeCString(typeName)}")`,
      `/*NUMELEMENTS=*/ IEC_UDINT(${numElements}u)`,
      `/*BASETYPECLASS=*/ IEC_TYPE_CLASS(strucpp::__SYSTEM::TYPE_CLASS::${baseTypeClassName})`,
      `/*ELEMBITSIZE=*/ IEC_UDINT(${elemBitSizeExpr})`,
      `/*MEMORYAREA=*/ IEC_MEMORY_AREA(strucpp::__SYSTEM::MEMORY_AREA::${address.memoryAreaName})`,
      `/*SYMBOL=*/ strucpp::IECString<39>("${this.escapeCString(symbolName)}")`,
      `/*COMMENT=*/ strucpp::IECString<79>("${this.escapeCString(comment)}")`,
    ];

    const result = `([&]() -> strucpp::VAR_INFO { static const strucpp::VAR_INFO ${descriptorName} = { ${fields.join(", ")} }; return ${descriptorName}; })()`;
    this.varInfoDescriptorCache.set(symbolName, result);
    return result;
  }

  /**
   * Find the VarDeclaration and owning VarBlock for a variable referenced by a
   * __VARINFO expression. Searches all POU, global and configuration var blocks
   * in the AST. VAR_EXTERNAL declarations resolve to the matching global if one
   * exists; otherwise they are treated as global references.
   */
  private findVarInfo(
    name: string,
  ): { decl: VarDeclaration; block: VarBlock } | undefined {
    if (!this.ast) return undefined;
    const nameUpper = name.toUpperCase();

    const pouBlocks: VarBlock[] = [];
    for (const prog of this.ast.programs) pouBlocks.push(...prog.varBlocks);
    for (const func of this.ast.functions) pouBlocks.push(...func.varBlocks);
    for (const fb of this.ast.functionBlocks) {
      pouBlocks.push(...fb.varBlocks);
      for (const method of fb.methods) pouBlocks.push(...method.varBlocks);
    }
    for (const iface of this.ast.interfaces) {
      for (const method of iface.methods) pouBlocks.push(...method.varBlocks);
    }

    let externalMatch: { decl: VarDeclaration; block: VarBlock } | undefined;
    for (const block of pouBlocks) {
      for (const decl of block.declarations) {
        if (decl.names.some((n) => n.toUpperCase() === nameUpper)) {
          if (block.blockType === "VAR_EXTERNAL") {
            externalMatch = { decl, block };
          } else {
            return { decl, block };
          }
        }
      }
    }

    const globalBlocks: VarBlock[] = [...this.ast.globalVarBlocks];
    for (const config of this.ast.configurations) {
      globalBlocks.push(...config.varBlocks);
    }

    for (const block of globalBlocks) {
      for (const decl of block.declarations) {
        if (decl.names.some((n) => n.toUpperCase() === nameUpper)) {
          return { decl, block };
        }
      }
    }

    return externalMatch;
  }

  /**
   * Infer the address and memory-area fields for a __VARINFO descriptor.
   * Located variables (AT %I/%Q/%M) get real byte/bit addresses; all other
   * variables use synthetic stable IDs derived from their qualified symbol.
   */
  private inferVarInfoAddressFields(
    declaration: VarDeclaration | undefined,
    block: VarBlock | undefined,
    symbolName: string,
  ): {
    area: number;
    memoryAreaName: string;
    bitNr: number;
    bitAddress: number;
    byteAddress: number;
    byteOffset: string;
  } {
    const byteAddress = this.generateVarInfoByteAddress(symbolName);

    if (declaration?.address) {
      const parsed = parseLocatedAddress(declaration.address);
      if (parsed) {
        const realByteAddress = parsed.byteIndex;
        const realByteOffset = parsed.byteIndex;
        const realBitAddress = parsed.byteIndex * 8 + parsed.bitIndex;
        const realBitNr = parsed.size === "Bit" ? parsed.bitIndex : -1;
        switch (parsed.area) {
          case "Input":
            return {
              area: 2,
              memoryAreaName: "MEM_INPUT",
              bitNr: realBitNr,
              bitAddress: realBitAddress,
              byteAddress: realByteAddress,
              byteOffset: realByteOffset.toString(),
            };
          case "Output":
            return {
              area: 3,
              memoryAreaName: "MEM_OUTPUT",
              bitNr: realBitNr,
              bitAddress: realBitAddress,
              byteAddress: realByteAddress,
              byteOffset: realByteOffset.toString(),
            };
          case "Memory":
          default:
            return {
              area: 1,
              memoryAreaName: "MEM_MEMORY",
              bitNr: realBitNr,
              bitAddress: realBitAddress,
              byteAddress: realByteAddress,
              byteOffset: realByteOffset.toString(),
            };
        }
      }
    }

    let memoryAreaName = "MEM_LOCAL";
    let area = -1;
    if (block) {
      if (block.blockType === "VAR_GLOBAL") {
        memoryAreaName = block.isRetain ? "MEM_RETAIN" : "MEM_GLOBAL";
        area = 0;
      } else if (block.blockType === "VAR_EXTERNAL") {
        memoryAreaName = "MEM_GLOBAL";
        area = 0;
      }
    }

    return {
      area,
      memoryAreaName,
      bitNr: -1,
      bitAddress: 0,
      byteAddress,
      byteOffset: "0",
    };
  }

  /**
   * Resolve a __VARINFO variable expression, walking field access and array
   * subscript chains to find the final field declaration, its IEC type, and
   * a C++ byte-offset expression.
   */
  private resolveVarInfoAccess(arg: VariableExpression): {
    baseDecl: VarDeclaration | undefined;
    baseBlock: VarBlock | undefined;
    finalDecl: VarDeclaration | undefined;
    finalType: IECType | undefined;
    byteOffsetExpr: string;
  } {
    const baseInfo = this.findVarInfo(arg.name);
    const baseDecl = baseInfo?.decl;
    const baseBlock = baseInfo?.block;
    let currentDecl: VarDeclaration | undefined = baseDecl;
    let currentTypeName = baseDecl?.type.name ?? "";
    let finalDecl: VarDeclaration | undefined = baseDecl;
    let finalType: IECType | undefined = undefined;
    let byteOffsetExpr = "0";

    const steps = arg.accessChain ?? [];
    if (steps.length === 0 && arg.resolvedType) {
      finalType = arg.resolvedType;
    }

    for (const step of steps) {
      if (!currentDecl) break;
      if (step.kind === "field") {
        const fieldDecl = this.findFieldDeclaration(currentTypeName, step.name);
        if (!fieldDecl) break;

        const memberInfo = this.getCompositeMemberInfo(
          currentTypeName,
          step.name,
        );
        const fieldOffset =
          memberInfo !== undefined
            ? `strucpp::iec_struct_member_offset<${memberInfo.index}, ${memberInfo.memberTypes.join(", ")}>::value`
            : "0";
        byteOffsetExpr =
          byteOffsetExpr === "0"
            ? fieldOffset
            : `(${byteOffsetExpr}) + ${fieldOffset}`;

        currentDecl = fieldDecl;
        finalDecl = fieldDecl;
        currentTypeName = fieldDecl.type.name;
        finalType = this.resolveTypeByName(currentTypeName);
      } else if (step.kind === "subscript") {
        const arrayInfo = this.getInlineArrayElementInfo(currentDecl);
        if (!arrayInfo) break;

        const indexExpr =
          step.indices.length > 0
            ? this.generateExpression(step.indices[0]!)
            : "0";
        const elementSizeExpr = `strucpp::iec_sizeof<${arrayInfo.elementCppType}>::value`;
        const subExpr = `(${indexExpr} - ${arrayInfo.lowerBound}) * ${elementSizeExpr}`;
        byteOffsetExpr =
          byteOffsetExpr === "0" ? subExpr : `(${byteOffsetExpr}) + ${subExpr}`;

        currentDecl = {
          ...currentDecl,
          type: {
            ...currentDecl.type,
            name: arrayInfo.elementTypeName,
            arrayDimensions: undefined,
            elementTypeName: undefined,
          },
        } as unknown as VarDeclaration;
        currentTypeName = arrayInfo.elementTypeName;
        finalDecl = currentDecl;
        finalType = this.resolveTypeByName(currentTypeName);
      } else if (step.kind === "dereference") {
        // Cannot compute a compile-time offset through a pointer dereference.
        break;
      }
    }

    return { baseDecl, baseBlock, finalDecl, finalType, byteOffsetExpr };
  }

  /**
   * Look up the VarDeclaration for a field of a struct, FB, or program type.
   */
  private findFieldDeclaration(
    typeName: string,
    fieldName: string,
  ): VarDeclaration | undefined {
    const upper = typeName.toUpperCase();
    const fieldUpper = fieldName.toUpperCase();

    for (const td of this.ast?.types ?? []) {
      if (
        td.name.toUpperCase() === upper &&
        td.definition.kind === "StructDefinition"
      ) {
        for (const field of td.definition.fields) {
          if (field.names.some((n) => n.toUpperCase() === fieldUpper)) {
            return field;
          }
        }
      }
    }

    for (const fb of this.ast?.functionBlocks ?? []) {
      if (fb.name.toUpperCase() === upper) {
        for (const block of fb.varBlocks) {
          if (block.blockType === "VAR_EXTERNAL") continue;
          for (const decl of block.declarations) {
            if (decl.names.some((n) => n.toUpperCase() === fieldUpper)) {
              return decl;
            }
          }
        }
      }
    }

    for (const prog of this.ast?.programs ?? []) {
      if (prog.name.toUpperCase() === upper) {
        for (const block of prog.varBlocks) {
          if (block.blockType === "VAR_EXTERNAL") continue;
          for (const decl of block.declarations) {
            if (decl.names.some((n) => n.toUpperCase() === fieldUpper)) {
              return decl;
            }
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Return the ordered C++ member types of a struct/FB/program type and the
   * index of the named field. Used to compute a CODESYS-logical byte offset.
   */
  private getCompositeMemberInfo(
    typeName: string,
    fieldName: string,
  ): { memberTypes: string[]; index: number } | undefined {
    const upper = typeName.toUpperCase();
    const fieldUpper = fieldName.toUpperCase();

    let index = -1;
    const memberTypes: string[] = [];

    for (const td of this.ast?.types ?? []) {
      if (
        td.name.toUpperCase() === upper &&
        td.definition.kind === "StructDefinition"
      ) {
        for (const field of td.definition.fields) {
          for (const name of field.names) {
            if (index === -1 && name.toUpperCase() === fieldUpper) {
              index = memberTypes.length;
            }
            memberTypes.push(this.mapMemberTypeToCpp(field.type));
          }
        }
        break;
      }
    }

    if (index === -1 && memberTypes.length === 0) {
      const pou =
        this.ast?.functionBlocks.find((f) => f.name.toUpperCase() === upper) ??
        this.ast?.programs.find((p) => p.name.toUpperCase() === upper);
      if (pou) {
        for (const block of pou.varBlocks) {
          if (block.blockType === "VAR_EXTERNAL") continue;
          for (const decl of block.declarations) {
            for (const name of decl.names) {
              if (index === -1 && name.toUpperCase() === fieldUpper) {
                index = memberTypes.length;
              }
              memberTypes.push(this.mapMemberTypeToCpp(decl.type));
            }
          }
        }
      }
    }

    if (index === -1) return undefined;
    return { memberTypes, index };
  }

  /**
   * Map a VarDeclaration type to the C++ member type used for offset/size
   * calculations. Matches the types emitted for struct/FB/program fields.
   */
  private mapMemberTypeToCpp(typeRef: {
    name: string;
    maxLength?: number | string;
    referenceKind?: string;
    arrayDimensions?: Array<{ start: number; end: number }>;
    elementTypeName?: string;
    elementReferenceKind?: string;
  }): string {
    return this.mapTypeRefToCpp(typeRef);
  }

  /**
   * For an array-typed VarDeclaration or array type, return the element type
   * name, its C++ type, and the lower bound of the first dimension.
   */
  private getInlineArrayElementInfo(decl: VarDeclaration):
    | {
        elementTypeName: string;
        elementCppType: string;
        lowerBound: number;
      }
    | undefined {
    if (
      decl.type.arrayDimensions &&
      decl.type.arrayDimensions.length > 0 &&
      decl.type.elementTypeName
    ) {
      return {
        elementTypeName: decl.type.elementTypeName,
        elementCppType: this.mapVarTypeToCpp(decl.type.elementTypeName),
        lowerBound: decl.type.arrayDimensions[0]!.start,
      };
    }

    const resolved = this.resolveTypeByName(decl.type.name);
    if (resolved?.typeKind === "array") {
      const arr = resolved as ArrayType;
      const elementTypeName = typeNameUtil(arr.elementType);
      return {
        elementTypeName,
        elementCppType: this.mapVarTypeToCpp(elementTypeName),
        lowerBound: arr.dimensions[0]?.start ?? 0,
      };
    }

    return undefined;
  }

  /**
   * Resolve a type name to an IECType for __VARINFO metadata.
   */
  private resolveTypeByName(name: string): IECType | undefined {
    const upper = name.toUpperCase();
    if (ELEMENTARY_TYPES[upper]) {
      return ELEMENTARY_TYPES[upper];
    }
    const systemType = getSystemType(name);
    if (systemType) return systemType;
    const resolved = this.symbolTables.lookupType(upper)?.resolvedType;
    if (resolved?.typeKind === "elementary") {
      // If the name is a TYPE alias to another elementary (e.g. MyInt : INT),
      // resolve to the base elementary type so __VARINFO reports the correct
      // TypeClass / BitSize instead of TYPE_USERDEF.
      const aliasBase = this.resolveElementaryAlias(name);
      if (aliasBase && aliasBase.name.toUpperCase() !== upper) {
        return this.resolveTypeByName(aliasBase.name);
      }
    }
    return resolved ?? undefined;
  }

  /**
   * True if `typeName` denotes a user-defined struct, function block or
   * program — i.e. a composite whose BitSize should be derived from the
   * generated C++ class size, not from an elementary bit width table.
   */
  private isCompositeTypeName(name: string): boolean {
    const upper = name.toUpperCase();
    if (ELEMENTARY_TYPES[upper]) return false;
    if (getSystemType(name)) return false;
    if (this.knownFBTypes.has(upper) || this.knownProgramTypes.has(upper)) {
      return true;
    }
    const typeSymbol = this.symbolTables.lookupType(upper);
    if (!typeSymbol) return false;
    const defKind = (
      typeSymbol.declaration as { definition?: { kind: string } } | undefined
    )?.definition?.kind;
    return (
      defKind === "StructDefinition" ||
      defKind === "FunctionBlockDefinition" ||
      defKind === "ProgramDefinition"
    );
  }

  /**
   * True if `typeName` is an elementary type whose logical byte size depends
   * on a per-declaration maximum length (STRING / WSTRING). BitSize for these
   * must be computed from the generated IECStringVar<IECWStringVar<N>> type.
   */
  private isRuntimeSizedElementaryTypeName(name: string): boolean {
    const upper = name.toUpperCase();
    return upper === "STRING" || upper === "WSTRING";
  }

  /**
   * True if `typeName` denotes the synthetic __SYSTEM.VAR_INFO type.
   */
  private isVarInfoTypeName(typeName: string | undefined): boolean {
    return (
      typeName !== undefined &&
      (typeName.toUpperCase() === "__SYSTEM.VAR_INFO" ||
        typeName.toUpperCase() === "VAR_INFO")
    );
  }

  /**
   * Return the C++ type name for a __SYSTEM.VAR_INFO field.
   */
  private varInfoFieldTypeName(field: string): string | undefined {
    const systemType = getSystemType("__SYSTEM.VAR_INFO");
    if (systemType?.typeKind !== "struct") return undefined;
    const st = systemType as import("../frontend/ast.js").StructType;
    const fu = field.toUpperCase();
    for (const [fname, ftype] of st.fields) {
      if (fname.toUpperCase() === fu) {
        return typeNameUtil(ftype);
      }
    }
    return undefined;
  }

  /**
   * Compute the logical bit size for an IECType.
   */
  private getTypeBitsForIECType(type: IECType): number {
    switch (type.typeKind) {
      case "elementary":
        return getTypeBits((type as ElementaryType).name) ?? 0;
      case "enum":
        return 32;
      case "reference": {
        const pointerTypes = ["POINTER", "REF_TO", "REFERENCE_TO"];
        const typeName = typeNameUtil(type);
        if (pointerTypes.some((p) => typeName.toUpperCase().startsWith(p))) {
          return 32;
        }
        return 32;
      }
      case "array": {
        const arr = type as ArrayType;
        let elements = 1;
        for (const dim of arr.dimensions) {
          elements *= Math.max(1, dim.end - dim.start + 1);
        }
        const elemBits = this.getTypeBitsForIECType(arr.elementType);
        return elements * elemBits;
      }
      default:
        return 0;
    }
  }

  /**
   * Build a human-readable symbol string for a __VARINFO argument.
   */
  private generateVarInfoSymbol(arg: VariableExpression): string {
    const parts: string[] = [arg.name];
    for (const step of arg.accessChain ?? []) {
      if (step.kind === "field") {
        parts.push(step.name);
      } else if (step.kind === "subscript") {
        parts[parts.length - 1] = `${parts[parts.length - 1]}[]`;
      }
    }
    return parts.join(".");
  }

  /**
   * Allocate a synthetic byte-address handle for a __VARINFO descriptor.
   * The ID is assigned from a sorted list of all __VARINFO symbols so the
   * output is byte-identical regardless of source order.
   */
  private generateVarInfoByteAddress(symbolName: string): number {
    const id = this.varInfoSymbolIds.get(symbolName) ?? 0;
    return 0xca000000 + id;
  }

  /**
   * Pre-scan the AST for all __VARINFO calls, collect their qualified symbols,
   * and assign stable IDs from a sorted ordering.
   */
  private buildVarInfoSymbolIds(ast: CompilationUnit): void {
    const expressions = this.collectVarInfoExpressions(ast);
    const symbolSet = new Set<string>();
    for (const expr of expressions) {
      symbolSet.add(this.generateVarInfoSymbol(expr.argument));
    }
    const sorted = [...symbolSet].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      this.varInfoSymbolIds.set(sorted[i]!, i + 1);
    }
  }

  /**
   * Recursively collect every VarInfoExpression in the AST.
   */
  private collectVarInfoExpressions(
    node: unknown,
    result: VarInfoExpression[] = [],
    visited = new Set<unknown>(),
  ): VarInfoExpression[] {
    if (node === null || typeof node !== "object") return result;
    if (visited.has(node)) return result;
    visited.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        this.collectVarInfoExpressions(item, result, visited);
      }
    } else {
      const obj = node as Record<string, unknown>;
      if (obj.kind === "VarInfoExpression") {
        result.push(obj as unknown as VarInfoExpression);
      }
      for (const key of Object.keys(obj)) {
        if (key === "sourceSpan") continue;
        this.collectVarInfoExpressions(obj[key], result, visited);
      }
    }
    return result;
  }

  /** Format a number as a C++ hex literal. */
  private formatHex(n: number): string {
    return `0x${Math.abs(n).toString(16).toUpperCase()}`;
  }

  /** Escape a string for use in a C string literal. */
  private escapeCString(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  /**
   * Generate an interface pointer expression.
   * For interface variables this is the variable itself; for FB instances or
   * THIS^ it is the address of the object; for null literals it is nullptr.
   */
  protected isInterfaceTypeRef(typeRef: {
    name: string;
    elementTypeName?: string;
  }): boolean {
    if (this.knownInterfaceTypes.has(typeRef.name.toUpperCase())) return true;
    if (
      typeRef.elementTypeName &&
      this.knownInterfaceTypes.has(typeRef.elementTypeName.toUpperCase())
    )
      return true;
    return false;
  }

  protected generateInitializer(
    typeRef: {
      name: string;
      elementTypeName?: string;
    },
    expr: Expression,
  ): string {
    if (this.isInterfaceTypeRef(typeRef)) {
      return this.generatePointerExpression(expr);
    }
    return this.generateExpression(expr);
  }

  protected generatePointerExpression(expr: Expression): string {
    if (expr.kind === "LiteralExpression") {
      const lit = expr;
      if (
        lit.value === 0 ||
        lit.value === "0" ||
        lit.rawValue?.toUpperCase() === "NULL"
      ) {
        return "nullptr";
      }
      // Other literals are not valid interface pointer sources
      return this.generateExpression(expr);
    }

    if (expr.kind === "ParenthesizedExpression") {
      return this.generatePointerExpression(expr.expression);
    }

    if (expr.kind === "NewExpression") {
      // __NEW returns T* which is already a pointer
      return this.generateExpression(expr);
    }

    if (expr.kind === "VariableExpression") {
      const ve = expr;
      const nameUpper = ve.name.toUpperCase();
      if (this.currentScopeInoutFBPointers.has(nameUpper)) {
        // VAR_IN_OUT FB instances are stored as pointers already.
        return this.getVariableBase(ve);
      }
      if (this.currentScopeInoutArrayPointers.has(nameUpper)) {
        // VAR_IN_OUT arrays are stored as pointers to Array1D already.
        return this.getVariableBase(ve);
      }
      if (this.currentScopeVarIsArray.has(nameUpper)) {
        // Local/member array passed by reference: emit address of the Array1D object.
        return `&${this.generateExpression(expr)}`;
      }
      const typeName =
        nameUpper === "THIS"
          ? this.currentFBName
          : this.currentScopeVarTypes.get(nameUpper);
      if (typeName && this.knownInterfaceTypes.has(typeName.toUpperCase())) {
        return this.generateExpression(expr);
      }
      if (
        nameUpper === "THIS" &&
        ve.fieldAccess.length === 0 &&
        ve.subscripts.length === 0 &&
        (ve.isDereference ||
          !ve.accessChain ||
          (ve.accessChain.length === 1 &&
            ve.accessChain[0]!.kind === "dereference"))
      ) {
        return "this";
      }
      if (
        typeName &&
        (this.knownFBTypes.has(typeName.toUpperCase()) ||
          this.knownProgramTypes.has(typeName.toUpperCase()))
      ) {
        return `&${this.generateExpression(expr)}`;
      }
      if (ve.isDereference && typeName) {
        // POINTER TO / REF_TO dereference: p^ yields an object, take its address
        return `&(${this.generateExpression(expr)})`;
      }
    }

    const inferred = this.inferExprType(expr);
    if (inferred) {
      const inferredUpper = inferred.toUpperCase();
      if (this.knownInterfaceTypes.has(inferredUpper)) {
        return this.generateExpression(expr);
      }
      if (
        this.knownFBTypes.has(inferredUpper) ||
        this.knownProgramTypes.has(inferredUpper)
      ) {
        return `&(${this.generateExpression(expr)})`;
      }
    }

    // Fallback: address of whatever expression was generated
    return `&(${this.generateExpression(expr)})`;
  }

  /**
   * Generate C++ for a __QUERYINTERFACE(source, target) expression.
   * Calls strucpp::query_interface<TargetInterface>(sourcePtr, targetVar).
   */
  private generateQueryInterfaceExpression(
    expr: QueryInterfaceExpression,
  ): string {
    const targetType = this.inferExprType(expr.target);
    const targetCppType = targetType ?? "void";

    const sourcePtr = this.generatePointerExpression(expr.source);
    const targetExpr = this.generateExpression(expr.target);

    return `strucpp::query_interface<${targetCppType}>(${sourcePtr}, ${targetExpr})`;
  }

  /**
   * Generate C++ for a literal expression.
   */
  private generateLiteralExpression(expr: LiteralExpression): string {
    // Handle typed literals: BYTE#255 → static_cast<IEC_BYTE>(255)
    if (expr.typePrefix) {
      const upperPrefix = expr.typePrefix.toUpperCase();
      const hashIdx = expr.rawValue.indexOf("#");
      const valuePart = expr.rawValue.substring(hashIdx + 1);
      if (upperPrefix === "STRING") {
        const inner = valuePart.replace(/^'|'$/g, "");
        const escaped = this.translateIECString(inner);
        return `IEC_STRING("${escaped}")`;
      }
      if (upperPrefix === "WSTRING") {
        const inner = valuePart.replace(/^["']|["']$/g, "");
        const escaped = this.translateIECString(inner);
        return `IEC_WSTRING(u"${escaped}")`;
      }
      const cppType = `IEC_${expr.typePrefix}`;
      const cppValue = iecBaseToCppLiteral(valuePart);
      return `static_cast<${cppType}>(${cppValue})`;
    }

    switch (expr.literalType) {
      case "BOOL":
        return expr.value === true ||
          expr.value === "TRUE" ||
          expr.rawValue?.toUpperCase() === "TRUE"
          ? "true"
          : "false";
      case "INT": {
        return this.formatIntegerLiteral(expr.rawValue, expr.value as number);
      }
      case "REAL": {
        const str = String(expr.value);
        // Ensure real literals have a decimal point (but not for scientific notation)
        return str.includes(".") || /[eE]/.test(str) ? str : str + ".0";
      }
      case "STRING": {
        // rawValue includes surrounding single quotes: 'hello' → strip them.
        // Wrap in IEC_STRING(...) so the literal can be passed directly to
        // standard functions (LEFT/RIGHT/MID/CONCAT/FIND/etc.) that expect an
        // IECStringVar/IECString argument.
        const inner = expr.rawValue.replace(/^'|'$/g, "");
        const escaped = this.translateIECString(inner);
        return `IEC_STRING("${escaped}")`;
      }
      case "WSTRING": {
        // IEC WSTRING literals are double-quoted in source; strip either
        // form for safety. Wrap in IEC_WSTRING(...) so the literal binds to
        // the WSTRING overloads of the standard string functions.
        const wInner = expr.rawValue.replace(/^["']|["']$/g, "");
        const wEscaped = this.translateIECString(wInner);
        return `IEC_WSTRING(u"${wEscaped}")`;
      }
      case "TIME": {
        const timeVal = parseTimeLiteral(String(expr.value));
        return `${timeVal.nanoseconds}LL`;
      }
      case "DATE":
        // DATE: int64 days since Unix epoch (UTC).  `iec_date.hpp`
        // stores DATE as days (see `DT_FROM_DATE_AND_TOD`'s
        // `iec_unwrap(date) * DT_NS_PER_DAY` math).  Lowering to ns
        // here would break every conversion / arithmetic helper.
        return `${parseDateLiteralToDays(String(expr.value))}LL`;
      case "TIME_OF_DAY":
        // TOD: int64 nanoseconds since midnight.
        return `${parseTodLiteralToNs(String(expr.value))}LL`;
      case "DATE_AND_TIME":
        // DT: int64 nanoseconds since Unix epoch (UTC).
        return `${parseDtLiteralToNs(String(expr.value))}LL`;
      case "LTIME":
        // LTIME: int64 nanoseconds.
        return `${parseTimeLiteral(String(expr.value)).nanoseconds}LL`;
      case "LDATE":
        // LDATE: int64 days since Unix epoch (UTC), same representation as DATE.
        return `${parseDateLiteralToDays(String(expr.value))}LL`;
      case "LTOD":
        // LTOD: int64 nanoseconds since midnight, same representation as TOD.
        return `${parseTodLiteralToNs(String(expr.value))}LL`;
      case "LDT":
        // LDT: int64 nanoseconds since Unix epoch (UTC), same representation as DT.
        return `${parseDtLiteralToNs(String(expr.value))}LL`;
      case "NULL":
        return "IEC_NULL";
      default:
        return String(expr.value);
    }
  }

  /**
   * Translate IEC 61131-3 $-escape sequences to C++ escape sequences.
   * Handles: $N/$n (newline), $L/$l (line feed), $R/$r (CR), $T/$t (tab),
   * $P/$p (form feed), $$ (literal $), $' (single quote), $XX (hex byte),
   * '' (doubled single quote), and C++ escaping for backslash and double-quote.
   */

  private formatIntegerLiteral(rawValue: string, value: number): string {
    // Based literals (16#FF, 8#77, 2#1010) → C++ notation; plain decimals use numeric value
    const upper = rawValue.toUpperCase().replace(/_/g, "");
    if (
      upper.startsWith("16#") ||
      upper.startsWith("8#") ||
      upper.startsWith("2#")
    ) {
      return iecBaseToCppLiteral(rawValue);
    }
    return String(value);
  }

  private translateIECString(inner: string): string {
    let result = "";
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (ch === "$" && i + 1 < inner.length) {
        const next = inner[i + 1]!;
        switch (next.toUpperCase()) {
          case "N":
          case "L":
            result += "\\n";
            i++;
            break;
          case "R":
            result += "\\r";
            i++;
            break;
          case "T":
            result += "\\t";
            i++;
            break;
          case "P":
            result += "\\f";
            i++;
            break;
          case "$":
            result += "$";
            i++;
            break;
          case "'":
            result += "'";
            i++;
            break;
          default:
            // $XX hex escape: two hex digits
            if (
              i + 2 < inner.length &&
              /^[0-9A-Fa-f]{2}$/.test(inner.substring(i + 1, i + 3))
            ) {
              result += "\\x" + inner.substring(i + 1, i + 3);
              i += 2;
            } else {
              // Unknown $-escape, pass through
              result += "\\\\$";
            }
            break;
        }
      } else if (ch === "'" && i + 1 < inner.length && inner[i + 1] === "'") {
        // ST doubled-quote → single quote
        result += "'";
        i++;
      } else if (ch === "\\") {
        result += "\\\\";
      } else if (ch === '"') {
        result += '\\"';
      } else {
        result += ch;
      }
    }
    return result;
  }

  /**
   * Resolve the unwrapped C++ base name for a variable expression, ignoring
   * any VAR_IN_OUT FB-pointer dereference. Used by both value and pointer
   * generation so the wrapping decision is made in one place.
   */
  private getVariableBase(expr: VariableExpression): string {
    const nameUpper = expr.name.toUpperCase();
    if (
      this.currentFunctionName &&
      nameUpper === this.currentFunctionName.toUpperCase()
    ) {
      return `${this.currentFunctionName}_result`;
    }
    const mangledName = this.varInstMangledNames.get(nameUpper);
    if (mangledName) return mangledName;
    const memberMangled = this.memberMangledNames.get(nameUpper);
    if (memberMangled) return memberMangled;
    return this.resolveVariableBaseName(expr.name);
  }

  /**
   * Generate C++ for a variable expression.
   */
  private generateVariableExpression(expr: VariableExpression): string {
    const nameUpper = expr.name.toUpperCase();

    // CODESYS __SYSTEM qualified enum access: __SYSTEM.TYPE_CLASS.TYPE_BOOL
    if (nameUpper === "__SYSTEM") {
      const path =
        expr.accessChain?.length === 2 &&
        expr.accessChain.every((s) => s.kind === "field")
          ? expr.accessChain.map((s) => s.name)
          : expr.fieldAccess.length === 2
            ? expr.fieldAccess
            : undefined;
      if (path) {
        return `__SYSTEM::${path[0]}::${path[1]}`;
      }
    }

    // Composite shared global (struct / array / function-block) accessed in a
    // body: reach its canonical value directly through the GlobalVar pointer
    // (`g->value` / `g->value.field` / `g->value.field.N`). The per-global mutex
    // is intentionally bypassed for composites — they are shared within a single
    // (bus-cycle) task, e.g. a SoftMotion AXIS_REF_SM3 driven by its bridge and
    // the MC_* blocks in the same scan. Cross-task composite sharing (needing a
    // lock spanning a whole field/call access) remains a follow-up. The base is
    // set to `g->value` below (see the `result` assignment); field/subscript/bit
    // access then builds on it.

    // VAR_EXTERNAL scalar read → lock the shared global and return its value.
    // read() yields the real IEC type, so it stays deduction-friendly in
    // std-lib templates (NOT/ADD/...). Composite externals use `->value`
    // directly (handled at the base below), not read().
    if (
      this.programExternals.has(nameUpper) &&
      !this.compositeExternals.has(nameUpper) &&
      expr.fieldAccess.length === 0 &&
      !expr.isDereference
    ) {
      return `${expr.name}->read()`;
    }

    // Composite / array shared-global READ (VAR_EXTERNAL to a composite
    // VAR_GLOBAL). Take the global's own mutex and read the canonical value
    // directly through with_lock — a field/element read copies only that
    // sub-value, never the whole struct. The lock lives inside
    // GlobalVar::with_lock (compiled out when not STRUCPP_THREADED), and each
    // with_lock is self-contained (acquire → return → release), so several
    // composite-global reads in one expression are sequential, never nested.
    if (this.compositeExternals.has(nameUpper) && !expr.isDereference) {
      const ptr = this.resolveVariableBaseName(expr.name);
      const inner = this.renderAccessTail("(*__glk)", expr, nameUpper);
      return `${ptr}->with_lock([&](auto* __glk){ return ${inner}; })`;
    }

    // Handle THIS reference
    if (nameUpper === "THIS") {
      // THIS^ (dereference) with no field access → (*this)
      if (expr.isDereference && expr.fieldAccess.length === 0) {
        return "(*this)";
      }
      // THIS.member or THIS^.member → this->member
      // Check if last field is a property → this->get_Prop()
      let result = "this->";
      if (expr.fieldAccess.length > 0) {
        let currentType = this.currentFBName;
        for (let i = 0; i < expr.fieldAccess.length; i++) {
          const field = expr.fieldAccess[i]!;
          const isLast = i === expr.fieldAccess.length - 1;
          if (isLast) {
            const propName = this.resolvePropertyName(currentType, field);
            if (propName) {
              result += `get_${propName}()`;
              return result;
            }
          }
          const fieldType = this.resolveMemberType(currentType, field);
          const fieldCppName = this.needsFieldMangling(
            field,
            fieldType,
            currentType,
          )
            ? `${field}_`
            : field;
          if (i > 0) result += ".";
          result += fieldCppName;
          if (!isLast) {
            currentType = fieldType;
          }
        }
      }
      return result;
    }

    // Handle SUPER reference → BaseClass::member
    // Check if last field is a property → BaseClass::get_Prop()
    if (nameUpper === "SUPER" && this.currentFBExtends) {
      let result = `${this.currentFBExtends}::`;
      if (expr.fieldAccess.length > 0) {
        let currentType: string | undefined = this.currentFBExtends;
        for (let i = 0; i < expr.fieldAccess.length; i++) {
          const field = expr.fieldAccess[i]!;
          const isLast = i === expr.fieldAccess.length - 1;
          if (isLast) {
            const propName = this.resolvePropertyName(currentType, field);
            if (propName) {
              result += `get_${propName}()`;
              return result;
            }
          }
          const fieldType = this.resolveMemberType(currentType, field);
          const fieldCppName = this.needsFieldMangling(
            field,
            fieldType,
            currentType,
          )
            ? `${field}_`
            : field;
          if (i > 0) result += ".";
          result += fieldCppName;
          if (!isLast) {
            currentType = fieldType;
          }
        }
      }
      return result;
    }

    // In function/method bodies, references to the function/method name redirect to the result variable
    let result = this.getVariableBase(expr);
    // VAR_IN_OUT FB instances are stored as pointers; dereference when the
    // variable is used as an object/value.
    if (
      this.currentScopeInoutFBPointers.has(nameUpper) ||
      this.currentScopeInoutArrayPointers.has(nameUpper)
    ) {
      result = `(*${result})`;
    }

    // Bare enum member: Stopped → Irrigation_State::Stopped
    // Only qualify if the name is NOT a declared variable in the current scope
    // (a local variable named RED should not be rewritten as Color::RED).
    const enumEntry = this.enumMemberToType.get(nameUpper);
    if (
      enumEntry?.typeName &&
      !this.currentScopeVarTypes.has(nameUpper) &&
      expr.fieldAccess.length === 0 &&
      (!expr.accessChain || expr.accessChain.length === 0)
    ) {
      return `${enumEntry.typeName}::${expr.name}`;
    }

    // Enum qualified access: TrafficState.RED → TrafficState::RED
    if (this.enumTypeMembers.has(nameUpper)) {
      if (
        expr.accessChain &&
        expr.accessChain.length === 1 &&
        expr.accessChain[0]!.kind === "field"
      ) {
        return `${expr.name}::${expr.accessChain[0]!.name}`;
      }
      if (expr.fieldAccess.length === 1) {
        return `${expr.name}::${expr.fieldAccess[0]}`;
      }
    }

    return this.renderAccessTail(result, expr, nameUpper);
  }

  /**
   * Render an expression's access chain (subscripts / field access / bit access /
   * dereference) onto a given base string. Factored out of
   * generateVariableExpression so the same access logic can be rendered onto a
   * different base — e.g. `(*p)` inside a composite shared-global `with_lock`
   * lambda.
   */
  private renderAccessTail(
    base: string,
    expr: VariableExpression,
    nameUpper: string,
  ): string {
    let result = base;

    // Use ordered access chain when available (preserves interleaving)
    if (expr.accessChain && expr.accessChain.length > 0) {
      return this.generateAccessChain(result, expr.accessChain, nameUpper);
    }

    // Legacy path: flat subscripts/fieldAccess/dereference (no interleaving)
    // Subscripts (array access). Use the bounds-checked .at() accessor (1D and
    // 2D+) so an out-of-range index raises a clean fault — throw on exception
    // targets (caught by the runtime, stops the faulting task), or
    // iec_runtime_fault(ArrayBounds) on -fno-exceptions MCU targets — instead of
    // the unchecked operator[]/operator() that silently corrupts memory.
    if (expr.subscripts.length > 1) {
      const args = expr.subscripts.map((sub) => this.generateExpression(sub));
      result += `.at(${args.join(", ")})`;
    } else {
      for (const sub of expr.subscripts) {
        result += `.at(${this.generateExpression(sub)})`;
      }
    }

    // Field access (struct members) — detect property reads and bit access on last field
    if (expr.fieldAccess.length > 0) {
      let currentType = this.currentScopeVarTypes.get(nameUpper);
      for (let i = 0; i < expr.fieldAccess.length; i++) {
        const field = expr.fieldAccess[i]!;
        const isLast = i === expr.fieldAccess.length - 1;
        // Bit access: numeric field like .0, .15, .31 → ((var >> N) & 1)
        if (/^\d+$/.test(field)) {
          result = `((static_cast<uint64_t>(${result}) >> ${field}) & 1)`;
          continue;
        }
        // CODESYS __SYSTEM.VAR_INFO fields are emitted in uppercase.
        if (this.isVarInfoTypeName(currentType)) {
          result += `.${field.toUpperCase()}`;
          if (!isLast) {
            currentType = this.varInfoFieldTypeName(field);
          }
          continue;
        }
        if (isLast) {
          const propName = this.resolvePropertyName(currentType, field);
          if (propName) {
            result += `.get_${propName}()`;
            continue;
          }
        }
        // Check if this field needs mangling (name == type or interface method in parent)
        const fieldType = this.resolveMemberType(currentType, field);
        const fieldCppName = this.needsFieldMangling(
          field,
          fieldType,
          currentType,
        )
          ? `${field}_`
          : field;
        result += `.${fieldCppName}`;
        if (!isLast) {
          currentType = fieldType;
        }
      }
    }

    // Dereference (^ operator → pointer dereference)
    if (expr.isDereference) {
      result = `(*${result})`;
    }

    return result;
  }

  /**
   * Generate C++ code from an ordered access chain.
   * Handles correct interleaving of field accesses, subscripts, and dereferences.
   *
   * Key rules:
   * - field after subscript: use -> (because Array operator[] returns IECVar<T>&)
   * - field after field: use .
   * - field after dereference: use .
   * - subscript of 1 index: use [idx]
   * - subscript of 2+ indices: use (idx1, idx2) (multidim Array)
   * - dereference: wrap in (*...)
   */
  private generateAccessChain(
    base: string,
    chain: AccessStep[],
    baseNameUpper: string,
  ): string {
    let result = base;
    let currentType = this.currentScopeVarTypes.get(baseNameUpper);

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!;
      const isLast = i === chain.length - 1;

      switch (step.kind) {
        case "field": {
          // Bit access: numeric field like .0, .15, .31
          if (/^\d+$/.test(step.name)) {
            result = `((static_cast<uint64_t>(${result}) >> ${step.name}) & 1)`;
            continue;
          }
          // CODESYS __SYSTEM.VAR_INFO fields are emitted in uppercase.
          if (this.isVarInfoTypeName(currentType)) {
            result += `.${step.name.toUpperCase()}`;
            currentType = this.varInfoFieldTypeName(step.name);
            break;
          }
          // Property access on the last step
          if (isLast) {
            const propName = this.resolvePropertyName(currentType, step.name);
            if (propName) {
              result += `.get_${propName}()`;
              return result;
            }
          }
          const fieldType = this.resolveMemberType(currentType, step.name);
          const fieldCppName = this.needsFieldMangling(
            step.name,
            fieldType,
            currentType,
          )
            ? `${step.name}_`
            : step.name;
          // Array elements store T directly — always use . for field access
          result += `.${fieldCppName}`;
          currentType = fieldType;
          break;
        }
        case "subscript": {
          // Bounds-checked .at() (not operator[]/operator()): an out-of-range
          // IEC array index raises a clean fault — `throw` on exception targets
          // (the runtime v4 dispatcher catches it and stops just the faulting
          // task) and iec_runtime_fault(IecFault::ArrayBounds) on -fno-exceptions
          // MCU targets. operator[] stays unchecked+constexpr for the debug-table
          // generator's &arr[i] address-of expressions; POU bodies use .at().
          if (step.indices.length > 1) {
            const args = step.indices.map((idx) =>
              this.generateExpression(idx),
            );
            result += `.at(${args.join(", ")})`;
          } else if (step.indices.length === 1) {
            result += `.at(${this.generateExpression(step.indices[0]!)})`;
          }
          // After indexing an array, subsequent field/method accesses apply to
          // the element type, so update currentType for correct mangling and
          // property/method resolution.
          if (this.ast && currentType) {
            const elemType = resolveArrayElementType(currentType, this.ast);
            if (elemType) {
              currentType = elemType;
            }
          }
          break;
        }
        case "dereference": {
          result = `(*${result})`;
          break;
        }
      }
    }

    return result;
  }

  /**
   * Operator mapping from ST to C++.
   */
  private static readonly BINARY_OP_MAP: Record<string, string> = {
    "+": "+",
    "-": "-",
    "*": "*",
    "/": "/",
    MOD: "%",
    AND: "&",
    AND_THEN: "&&",
    OR: "|",
    OR_ELSE: "||",
    XOR: "^",
    "=": "==",
    "<>": "!=",
    "<": "<",
    ">": ">",
    "<=": "<=",
    ">=": ">=",
  };

  /**
   * Generate C++ for a binary expression.
   */
  private generateBinaryExpression(expr: BinaryExpression): string {
    const left = this.generateExpression(expr.left);
    const right = this.generateExpression(expr.right);

    // Power operator needs special handling
    if (expr.operator === "**") {
      return `std::pow(static_cast<double>(${left}), static_cast<double>(${right}))`;
    }

    const cppOp = CodeGenerator.BINARY_OP_MAP[expr.operator] ?? expr.operator;

    // IEC 61131-3 AND/OR/XOR are always bitwise. C++ bitwise & | ^ and the
    // short-circuit forms && || have different precedence than comparison
    // operators, unlike ST where AND/OR have lower precedence. Parenthesize
    // operands to preserve the correct evaluation order.
    if (
      expr.operator === "AND" ||
      expr.operator === "AND_THEN" ||
      expr.operator === "OR" ||
      expr.operator === "OR_ELSE" ||
      expr.operator === "XOR"
    ) {
      return `(${left}) ${cppOp} (${right})`;
    }

    return `${left} ${cppOp} ${right}`;
  }

  /**
   * Generate C++ for a unary expression.
   */
  private generateUnaryExpression(expr: UnaryExpression): string {
    const operand = this.generateExpression(expr.operand);

    switch (expr.operator) {
      case "NOT": {
        // NOT on non-BOOL ANY_BIT types must use bitwise complement (~)
        const opType = this.inferExprType(expr.operand);
        if (opType) {
          const cat = getTypeCategory(opType.toUpperCase());
          if (cat === "BIT" && opType.toUpperCase() !== "BOOL") {
            return `~${operand}`;
          }
        }
        return `!${operand}`;
      }
      case "-":
        return `-${operand}`;
      case "+":
        return `+${operand}`;
    }
  }

  /**
   * Generate C++ for a method call expression (chained method calls).
   * e.g., fb.method1(args).method2(args) → fb.method1(args).method2(args)
   */
  private generateMethodCallExpression(expr: MethodCallExpression): string {
    const obj = this.generateExpression(expr.object);
    const args = expr.arguments
      .map((a) => this.generateExpression(a.value))
      .join(", ");
    // Try type-specific resolution first (avoids collisions when two FBs share a method name)
    // Try type-specific resolution first (avoids collisions when two FBs share a method name)
    const objType = this.inferExprType(expr.object);
    const resolvedName = objType
      ? this.resolveMethodName(objType, expr.methodName)
      : this.resolveMethodNameGlobal(expr.methodName);
    if (objType && this.knownInterfaceTypes.has(objType.toUpperCase())) {
      // Interface pointer: guard against null before dispatch so a failed
      // __QUERYINTERFACE (or an uninitialised interface variable) cannot be
      // dereferenced. The lambda evaluates the object expression exactly once.
      // ST `itfPtr^.Method()` is a pointer dereference; use the pointer itself
      // for dispatch, since the interface value lives behind it.
      const ptrObj = this.interfacePointerObject(expr.object, objType) ?? obj;
      return `([&](auto&& __itf){ if (!__itf) strucpp::iec_null_reference_fault("Null interface pointer in call to '${resolvedName}'"); return __itf->${resolvedName}(${args}); }(${ptrObj}))`;
    }
    return `${obj}.${resolvedName}(${args})`;
  }

  /**
   * For an interface method call like `itfPtr^.Method()`, the object
   * expression is a pointer dereference. The underlying pointer should be
   * used for the null-guarded dispatch lambda. Returns the C++ expression for
   * the pointer if the object is a dereference of a pointer/reference to the
   * given interface type, otherwise undefined.
   */
  private interfacePointerObject(
    expr: Expression,
    _interfaceType: string,
  ): string | undefined {
    // Explicit DREF(ptr).Method() — the operand is already the pointer.
    if (expr.kind === "DrefExpression") {
      return this.generateExpression(expr.operand);
    }
    if (expr.kind === "ParenthesizedExpression") {
      return this.interfacePointerObject(expr.expression, _interfaceType);
    }
    if (expr.kind !== "VariableExpression") return undefined;

    let isDeref = false;
    const baseExpr: VariableExpression = { ...expr, isDereference: false };
    if (expr.isDereference) {
      isDeref = true;
    }
    if (
      expr.accessChain &&
      expr.accessChain.length > 0 &&
      expr.accessChain[expr.accessChain.length - 1]!.kind === "dereference"
    ) {
      isDeref = true;
      const chain = [...expr.accessChain];
      chain.pop();
      if (chain.length === 0) {
        delete baseExpr.accessChain;
      } else {
        baseExpr.accessChain = chain;
      }
    }
    if (!isDeref) return undefined;

    // Generate the pointer expression without the final ^ dereference.
    // The caller already verified the object expression resolves to an
    // interface type, so the base must be a pointer/reference to it.
    return this.generateExpression(baseExpr);
  }

  // ===========================================================================
  // Implicit type widening / argument coercion helpers
  // ===========================================================================

  /**
   * Returns true when `source` can be implicitly widened to `target`.
   * Covers same-category widening (BYTE→DWORD), BIT→INT crossover (BYTE→INT),
   * and integer→REAL promotion.
   */
  private canImplicitWiden(source: string, target: string): boolean {
    return isImplicitlyConvertible(source, target);
  }

  /**
   * Lightweight type inference for an expression using the current scope's
   * variable type map. Returns the IEC type name (upper case) or undefined.
   */
  private inferExprType(expr: Expression): string | undefined {
    // Use pre-computed type from semantic analysis when available.
    // Unwrap POINTER TO / REF_TO / REFERENCE TO so callers see the FB,
    // interface, or elementary type being pointed to.
    if (expr.resolvedType) {
      const baseTypeName = (type: IECType): string | undefined => {
        if (type.typeKind === "reference") {
          const refType = type as import("../frontend/ast.js").ReferenceType;
          if (refType.referencedType) {
            return baseTypeName(refType.referencedType);
          }
        }
        return typeNameUtil(type);
      };
      const name = baseTypeName(expr.resolvedType);
      if (name) return name.toUpperCase();
    }
    // Fallback to ad-hoc inference for standalone codegen (tests without semantic analysis)
    switch (expr.kind) {
      case "VariableExpression": {
        // Walk the full access chain (subscripts, ^, fields) so that
        // `observers[1].Update()` resolves to the element FB type and
        // `p^.Start()` resolves to the pointed FB type.
        // `this.ast` is only required for array element resolution; field
        // resolution can fall back to the library FB metadata cache.
        const ast = this.ast;
        let currentType = this.currentScopeVarTypes.get(
          expr.name.toUpperCase(),
        );
        if (!currentType) return undefined;

        const applyStep = (
          type: string,
          step: AccessStep,
        ): string | undefined => {
          switch (step.kind) {
            case "field":
              return this.resolveMemberType(type, step.name);
            case "subscript":
              if (!ast) return undefined;
              return resolveArrayElementType(type, ast);
            case "dereference":
              // The stored base type already represents the pointed/referred value.
              return type;
          }
        };

        if (expr.accessChain && expr.accessChain.length > 0) {
          for (const step of expr.accessChain) {
            const next = applyStep(currentType, step);
            if (!next) return undefined;
            currentType = next;
          }
        } else {
          for (let i = 0; i < expr.subscripts.length; i++) {
            if (!ast) return undefined;
            const elem = resolveArrayElementType(currentType, ast);
            if (!elem) return undefined;
            currentType = elem;
          }
          for (const field of expr.fieldAccess ?? []) {
            const next = this.resolveMemberType(currentType, field);
            if (!next) return undefined;
            currentType = next;
          }
          // `isDereference` does not change the type: the stored base type already
          // represents the pointed/referred value.
        }
        return currentType.toUpperCase();
      }
      case "LiteralExpression": {
        if (expr.typePrefix) return expr.typePrefix.toUpperCase();
        // Map literal types to IEC names
        switch (expr.literalType) {
          case "INT":
            return "INT";
          case "REAL":
            return "REAL";
          case "BOOL":
            return "BOOL";
          case "STRING":
            return "STRING";
          case "TIME":
            return "TIME";
          case "LTIME":
            return "LTIME";
          case "DATE":
            return "DATE";
          case "LDATE":
            return "LDATE";
          case "TIME_OF_DAY":
            return "TIME_OF_DAY";
          case "LTOD":
            return "LTOD";
          case "DATE_AND_TIME":
            return "DATE_AND_TIME";
          case "LDT":
            return "LDT";
          case "WSTRING":
            return "WSTRING";
          default:
            return undefined;
        }
      }
      case "UnaryExpression":
        return this.inferExprType(expr.operand);
      case "BinaryExpression": {
        // For bitwise/arithmetic ops, infer from operands
        const lt = this.inferExprType(expr.left);
        const rt = this.inferExprType(expr.right);
        // Prefer variable types over literal types
        if (lt && rt) {
          const lBits = getTypeBits(lt) ?? 0;
          const rBits = getTypeBits(rt) ?? 0;
          return rBits > lBits ? rt : lt;
        }
        return lt ?? rt;
      }
      case "FunctionCallExpression": {
        const fnUpper = expr.functionName.toUpperCase();
        // Dotted method call: Prefix.Method() — resolve method return type
        const dotIdx = fnUpper.indexOf(".");
        if (dotIdx > 0 && this.ast) {
          const prefix = fnUpper.substring(0, dotIdx);
          const methodName = fnUpper.substring(dotIdx + 1);
          const prefixType = this.currentScopeVarTypes.get(prefix);
          if (prefixType) {
            const fb = this.ast.functionBlocks.find(
              (f) => f.name.toUpperCase() === prefixType.toUpperCase(),
            );
            if (fb) {
              const method = fb.methods.find(
                (m) => m.name.toUpperCase() === methodName,
              );
              if (method?.returnType) {
                return method.returnType.name.toUpperCase();
              }
            }
          }
        }
        // Check user-defined functions
        if (this.ast) {
          const funcDecl = this.ast.functions.find(
            (f) => f.name.toUpperCase() === fnUpper,
          );
          if (funcDecl) return funcDecl.returnType?.name.toUpperCase();
        }
        // Check conversion functions (INT_TO_REAL → REAL)
        const conv = this.stdRegistry.resolveConversion(fnUpper);
        if (conv) return conv.toType.toUpperCase();
        // Check std functions with specific return type
        const std = this.stdRegistry.lookup(fnUpper);
        if (std?.specificReturnType)
          return std.specificReturnType.toUpperCase();
        // For generic functions returning a common type across value arguments
        // (e.g. ADD, AND, MUX, SEL, LIMIT), infer the harmonized common type so
        // the type system matches the C++ that will actually be emitted.  Strip
        // EN/ENO implicit parameters first — they are not part of the value
        // argument list and must not influence the common type.
        if (
          std &&
          (std.returnMatchesFirstParam || stdFuncReturnsCommonType(std)) &&
          expr.arguments.length > 0
        ) {
          const valueArgs = expr.arguments.filter((a) => !isEnEnoArgument(a));
          const canComputeCommon =
            shouldHarmonizeStdFuncArgs(std, valueArgs.length) ||
            stdFuncReturnsCommonType(std);
          if (canComputeCommon && valueArgs.length > 0) {
            const range = getHarmonizableRange(std, valueArgs.length);
            if (range) {
              const argTypes = valueArgs.map((a) =>
                this.inferExprType(a.value),
              );
              const bareFlags = valueArgs.map((a) => isBareLiteral(a.value));
              const computeCommon = stdFuncReturnsCommonType(std)
                ? resolveSelectionCommonType
                : resolveHarmonizedCommonType;
              const common = computeCommon(
                argTypes,
                bareFlags,
                range.start,
                range.end,
              );
              if (common) return common;
            }
          }
          if (std.returnMatchesFirstParam && valueArgs.length > 0) {
            return this.inferExprType(valueArgs[0]!.value);
          }
        }
        return undefined;
      }
      case "MethodCallExpression": {
        // Resolve object type → find FB declaration → find method → return type.
        // Recursing through `inferExprType` handles array elements, pointer
        // dereferences, field access and chained method calls.
        const objType = this.inferExprType(expr.object);
        if (objType && this.ast) {
          const fb = this.ast.functionBlocks.find(
            (f) => f.name.toUpperCase() === objType.toUpperCase(),
          );
          if (fb) {
            const method = fb.methods.find(
              (m) => m.name.toUpperCase() === expr.methodName.toUpperCase(),
            );
            if (method?.returnType) {
              return method.returnType.name.toUpperCase();
            }
          }
        }
        return undefined;
      }
      case "ParenthesizedExpression":
        return this.inferExprType(expr.expression);
      default:
        return undefined;
    }
  }

  /**
   * Build a CODESYS AnyType descriptor for a function-call argument.
   * The type-class id is taken from the argument's resolved IEC type.
   */
  private buildAnyTypeDescriptor(expr: Expression, valueCode: string): string {
    const typeClass = this.getTypeClassLiteral(expr);
    return `strucpp::make_any_type<${typeClass}>(${valueCode})`;
  }

  /**
   * Return the C++ __SYSTEM.TYPE_CLASS enum literal for an expression,
   * or TYPE_NONE when the type cannot be determined.
   */
  private getTypeClassLiteral(expr: Expression): string {
    let resolved = expr.resolvedType;
    if (!resolved) {
      const inferred = this.inferExprType(expr);
      if (inferred) {
        resolved = {
          typeKind: "elementary",
          name: inferred,
          sizeBits: 0,
        } as IECType;
      }
    }
    const typeClassNum =
      resolved !== undefined ? resolveTypeClass(resolved) : undefined;
    const memberName =
      typeClassNum !== undefined
        ? TYPE_CLASS_NAME.get(typeClassNum)
        : undefined;
    if (memberName) {
      return `strucpp::__SYSTEM::TYPE_CLASS::${memberName}`;
    }
    return `strucpp::__SYSTEM::TYPE_CLASS::TYPE_NONE`;
  }

  /**
   * Wrap positional or named arguments whose formal parameter is an IEC
   * generic type group (ANY, ANY_BIT, ...) in a runtime AnyType descriptor.
   * Modifies `args` in place.
   */
  private wrapAnyTypeArgs(
    args: string[],
    argExprs: (Argument | undefined)[],
    paramTypes: string[],
  ): void {
    for (let i = 0; i < args.length && i < paramTypes.length; i++) {
      if (!isGenericTypeName(paramTypes[i]!.toUpperCase())) continue;
      const argExpr = argExprs[i]?.value;
      if (!argExpr) continue; // omitted/default argument
      args[i] = this.buildAnyTypeDescriptor(argExpr, args[i]!);
    }
  }

  /**
   * Extract ordered parameter types from a user-defined function declaration.
   * Returns undefined if function not found.
   */
  private getParamTypes(funcName: string): string[] | undefined {
    if (!this.ast) return undefined;
    const nameUpper = funcName.toUpperCase();
    const funcDecl = this.ast.functions.find(
      (f) => f.name.toUpperCase() === nameUpper,
    );
    if (!funcDecl) return undefined;
    const types: string[] = [];
    for (const block of funcDecl.varBlocks) {
      if (
        block.blockType === "VAR_INPUT" ||
        block.blockType === "VAR_IN_OUT" ||
        block.blockType === "VAR_OUTPUT"
      ) {
        for (const decl of block.declarations) {
          for (let i = 0; i < decl.names.length; i++) {
            types.push(decl.type.name.toUpperCase());
          }
        }
      }
    }
    return types.length > 0 ? types : undefined;
  }

  /**
   * Apply implicit widening casts to a list of argument strings for a
   * user-defined function call. Modifies `args` in place.
   */
  private coerceUserFuncArgs(
    args: string[],
    argExprs: (Argument | undefined)[],
    paramTypes: string[],
  ): void {
    for (let i = 0; i < args.length && i < paramTypes.length; i++) {
      const argExpr = argExprs[i];
      if (!argExpr) continue; // padded temp vars / defaults have no expr
      const expr = argExpr.value;
      const argType = this.inferExprType(expr);
      if (!argType) continue;
      const paramType = paramTypes[i]!;
      if (argType === paramType) continue;
      // Generic function parameters are lowered to C++ templates, so they
      // must not be static_cast to a non-existent IEC_<ANY_...> type.
      if (isGenericTypeName(paramType.toUpperCase())) continue;
      // Bare literals (no typePrefix) are untyped — always castable to param type
      if (isBareLiteral(expr) || this.canImplicitWiden(argType, paramType)) {
        args[i] = `static_cast<IEC_${paramType}>(${args[i]})`;
      }
    }
  }

  /**
   * Wrap a temporal-typed argument with the right `*_TO_MS` helper
   * before it's handed to a numeric / bit-string `TO_*` conversion.
   *
   * Why this lives in codegen and not in the runtime:
   *  - `IEC_TIME`, `IEC_LTIME`, `IEC_TOD`, `IEC_LTOD`, `IEC_DT`,
   *    `IEC_LDT`, `IEC_DATE`, `IEC_LDATE` are all
   *    `using ... = IECVar<int64_t>` aliases in `iec_var.hpp` — they
   *    collapse to the same C++ type after preprocessing.
   *  - A runtime overload `TO_UINT(IEC_TIME)` therefore CANNOT be
   *    distinguished from `TO_UINT(IEC_DATE)` by the C++ compiler;
   *    both bind to the same generic template and the raw `int64_t`
   *    underlying value gets `static_cast`ed straight to the target
   *    integer (low 16 / 32 bits of a nanosecond count for TIME).
   *  - The IEC type label only survives at the language layer.  So
   *    the scaling has to happen at the call site, before the type
   *    identity is erased.
   *
   * Scaling chosen (matches `TO_TIME(integer)`'s established
   * "integer means milliseconds" convention from OSCAT/CODESYS):
   *  - TIME / LTIME → `TIME_TO_MS`           (ns since 0   → ms)
   *  - TOD / TIME_OF_DAY / LTOD / LTIME_OF_DAY → `TOD_TO_MS`
   *    (ns since midnight  → ms since midnight, [0, 86_400_000))
   *  - DT / DATE_AND_TIME / LDT / LDATE_AND_TIME → `DT_TO_MS`
   *    (ns since epoch  → ms since epoch)
   *  - DATE / LDATE: NOT scaled — DATE is already stored as whole
   *    days, and "days since 1970-01-01" is the natural integer
   *    answer for `DATE_TO_INT` / etc.  Callers wanting a different
   *    unit can compose with `DATE_TO_DAYS` (today, the identity).
   *
   * No wrap on temporal-target conversions (`TO_TIME(TIME)`,
   * `INT_TO_TIME(ms)`, etc.) — those are either pass-through (same
   * family) or handled by the existing `TO_TIME(integer)` runtime
   * template which scales ms→ns going the other way.  No wrap on
   * non-temporal sources either (the generic numeric path already
   * does the right thing).
   */
  private wrapTemporalArgForNumericConversion(
    argExpr: string,
    fromTypeUpper: string,
    toTypeUpper: string,
  ): string {
    // Only the numeric / bit-string targets — temporal targets stay
    // pass-through and STRING targets need a separate format pipeline
    // (out of scope for this helper).
    if (!NUMERIC_OR_BIT_CONVERSION_TARGETS.has(toTypeUpper)) {
      return argExpr;
    }
    if (fromTypeUpper === "TIME" || fromTypeUpper === "LTIME") {
      return `TIME_TO_MS(${argExpr})`;
    }
    if (
      fromTypeUpper === "TOD" ||
      fromTypeUpper === "TIME_OF_DAY" ||
      fromTypeUpper === "LTOD" ||
      fromTypeUpper === "LTIME_OF_DAY"
    ) {
      return `TOD_TO_MS(${argExpr})`;
    }
    if (
      fromTypeUpper === "DT" ||
      fromTypeUpper === "DATE_AND_TIME" ||
      fromTypeUpper === "LDT" ||
      fromTypeUpper === "LDATE_AND_TIME"
    ) {
      return `DT_TO_MS(${argExpr})`;
    }
    return argExpr;
  }

  /**
   * Add a codegen-level error tied to an expression's source location.
   */
  private addCodegenError(message: string, expr?: Expression): void {
    const span = expr?.sourceSpan;
    const err: (typeof this.codegenErrors)[0] = { message };
    if (span?.startLine !== undefined) err.line = span.startLine;
    if (span?.startCol !== undefined) err.column = span.startCol;
    if (span?.file !== undefined) err.file = span.file;
    this.codegenErrors.push(err);
  }

  /**
   * For std-lib template functions (LIMIT, MAX, MIN, MUX, ADD, MUL, etc.)
   * where the value parameters share a generic constraint, cast all value
   * arguments to a single common IEC type so C++ template deduction succeeds
   * and sign is preserved.  If no common type exists (e.g. LINT mixed with
   * ULINT) a codegen error is recorded instead of emitting code that will not
   * compile.
   */
  private harmonizeStdFuncArgs(
    args: string[],
    argExprs: FunctionCallExpression["arguments"],
    stdFunc: StdFunctionDescriptor,
  ): void {
    // EN/ENO are implicit control parameters, not value operands; they must not
    // take part in common-type selection or be cast to a value type.
    const valueIndices: number[] = [];
    for (let i = 0; i < argExprs.length && i < args.length; i++) {
      if (!isEnEnoArgument(argExprs[i]!)) valueIndices.push(i);
    }

    const valueCount = valueIndices.length;
    const range = getHarmonizableRange(stdFunc, valueCount);
    if (!range || !shouldHarmonizeStdFuncArgs(stdFunc, valueCount)) return;

    const argTypes: (string | undefined)[] = valueIndices.map((idx) =>
      this.inferExprType(argExprs[idx]!.value),
    );

    // If we cannot infer a type for any value argument, leave the call as-is
    // and let the C++ compiler handle it.  This avoids false positives when
    // the type checker has not resolved a symbol (e.g. library string ops).
    let hasUnknown = false;
    for (let i = range.start; i < range.end; i++) {
      if (!argTypes[i]) {
        hasUnknown = true;
        break;
      }
    }
    if (hasUnknown) return;

    const isBare: boolean[] = [];
    for (let i = range.start; i < range.end; i++) {
      isBare[i] = isBareLiteral(argExprs[valueIndices[i]!]!.value);
    }

    // Pick the common IEC type, treating bare literals as untyped placeholders
    // that take on the type of the non-bare operands when those all agree.
    // Selection functions (MUX) can fall back to the unsigned common type.
    const computeCommon = stdFuncReturnsCommonType(stdFunc)
      ? resolveSelectionCommonType
      : resolveHarmonizedCommonType;
    const commonType = computeCommon(argTypes, isBare, range.start, range.end);

    if (!commonType) {
      const argTypeList = argTypes
        .slice(range.start, range.end)
        .map((t) => t ?? "UNKNOWN")
        .join(", ");
      this.addCodegenError(
        `Cannot unify argument types for ${stdFunc.cppName}(${argTypeList}) — no common IEC type can represent all values without loss`,
        argExprs[valueIndices[range.start]!]?.value,
      );
      return;
    }

    const commonCat = getTypeCategory(commonType);
    for (let i = range.start; i < range.end; i++) {
      const t = argTypes[i];
      if (!t) continue;
      const exprCat = getTypeCategory(t);
      const bare = isBare[i]!;

      if (t === commonType && !bare) continue;

      // Don't truncate a REAL literal by casting it to an integer type.
      if (bare && exprCat === "REAL" && commonCat !== "REAL") {
        continue;
      }

      const rawIdx = valueIndices[i]!;
      args[rawIdx] = `static_cast<IEC_${commonType}>(${args[rawIdx]})`;
    }
  }

  /**
   * Generate C++ for a function call expression.
   * Handles: dotted method calls (THIS.method, SUPER.method, instance.method),
   * standard functions, *_TO_* conversions, DELETE->DELETE_STR mapping,
   * named argument reordering, and user-defined function calls.
   */
  protected generateFunctionCallExpression(
    expr: FunctionCallExpression,
  ): string {
    // Handle dotted method calls: THIS.method, SUPER.method, instance.method
    if (expr.functionName.includes(".")) {
      const dotIdx = expr.functionName.indexOf(".");
      const prefix = expr.functionName.substring(0, dotIdx);
      const methodName = expr.functionName.substring(dotIdx + 1);
      const args = expr.arguments.map((arg) =>
        this.generateExpression(arg.value),
      );

      // Resolve method name case from declaration
      const varType = this.currentScopeVarTypes.get(prefix.toUpperCase());
      const resolvedMethod = varType
        ? this.resolveMethodName(varType, methodName)
        : this.resolveMethodNameGlobal(methodName);

      if (prefix.toUpperCase() === "THIS") {
        return `this->${resolvedMethod}(${args.join(", ")})`;
      } else if (prefix.toUpperCase() === "SUPER" && this.currentFBExtends) {
        return `${this.currentFBExtends}::${resolvedMethod}(${args.join(", ")})`;
      } else {
        // instance.method() call; interface pointers use ->
        const prefixUpper = prefix.toUpperCase();
        const prefixType = this.currentScopeVarTypes.get(prefixUpper);
        const isInterfacePointer =
          prefixType && this.knownInterfaceTypes.has(prefixType.toUpperCase());
        // VAR_IN_OUT FB-instance members are stored as C++ pointers and must be
        // dereferenced when used as the object of a method call.
        const mangledPrefix =
          this.varInstMangledNames.get(prefixUpper) ??
          this.memberMangledNames.get(prefixUpper) ??
          this.resolveVariableBaseName(prefix);
        const prefixExpr = this.currentScopeInoutFBPointers.has(prefixUpper)
          ? `(*${mangledPrefix})`
          : mangledPrefix;
        if (isInterfacePointer) {
          return `([&](auto* __itf){ if (!__itf) strucpp::iec_null_reference_fault("Null interface pointer in call to '${resolvedMethod}'"); return __itf->${resolvedMethod}(${args.join(", ")}); }(${prefixExpr}))`;
        }
        return `${prefixExpr}.${resolvedMethod}(${args.join(", ")})`;
      }
    }

    const nameUpper = expr.functionName.toUpperCase();

    // SUPER^() — parent body call
    if (nameUpper === "SUPER" && this.currentFBExtends) {
      const args = expr.arguments.map((arg) =>
        this.generateExpression(arg.value),
      );
      return `${this.currentFBExtends}::operator()(${args.join(", ")})`;
    }

    // 0. ADR(x) → &(x) (CODESYS address-of operator)
    if (nameUpper === "ADR") {
      const args = expr.arguments.map((arg) =>
        this.generateExpression(arg.value),
      );
      return `&(${args[0] ?? ""})`;
    }

    // 0a. REF_LINK(x) → REF(x) — callable form of the REF() reference operator
    // (REF is a reserved token and can't take the graphical EN/IN/ENO call
    // form). Assigning the result to a REF_TO variable binds it.
    if (nameUpper === "REF_LINK") {
      const args = expr.arguments.map((arg) =>
        this.generateExpression(arg.value),
      );
      return `REF(${args[0] ?? ""})`;
    }

    // 0b. LOWER_BOUND/UPPER_BOUND(arr, dim) → arr.lower_bound() / arr.upper_bound()
    if (nameUpper === "LOWER_BOUND" || nameUpper === "UPPER_BOUND") {
      const method =
        nameUpper === "LOWER_BOUND" ? "lower_bound" : "upper_bound";
      const arrExpr = this.generateExpression(expr.arguments[0]!.value);
      if (expr.arguments.length >= 2) {
        const dimExpr = this.generateExpression(expr.arguments[1]!.value);
        return `${arrExpr}.${method}(${dimExpr})`;
      }
      return `${arrExpr}.${method}()`;
    }

    // 1. Check for *_TO_* conversion pattern (e.g., INT_TO_REAL -> TO_REAL)
    const conversion = this.stdRegistry.resolveConversion(nameUpper);
    if (conversion) {
      const args = expr.arguments.map((arg, idx) => {
        const generated = this.generateExpression(arg.value);
        if (idx !== 0) return generated;
        // Type-aware scaling for temporal sources.  See the helper for
        // the full rationale — short version: the C++ runtime aliases
        // every temporal type to `IECVar<int64_t>` (so a `TIME` and a
        // `DATE` are literally the same C++ type after compilation),
        // and the only place that still knows "this expression is a
        // TIME" is the codegen layer.  We have to wrap the argument
        // with `TIME_TO_MS` / `TOD_TO_MS` / `DT_TO_MS` here, otherwise
        // `TO_UINT(time_var)` lowers to a `static_cast<uint16_t>(raw_ns)`
        // and the user sees the low 16 bits of the nanosecond count
        // instead of the milliseconds they asked for.
        return this.wrapTemporalArgForNumericConversion(
          generated,
          conversion.fromType.toUpperCase(),
          conversion.toType.toUpperCase(),
        );
      });
      return `${conversion.cppName}(${args.join(", ")})`;
    }

    // 2. SIZEOF(typeName) / XSIZEOF(typeName) - CODESYS allows SIZEOF(INT),
    // SIZEOF(MyStruct), XSIZEOF(INT), XSIZEOF(MyStruct), etc. When the
    // argument is a bare identifier that is not a variable in scope, treat it
    // as a type and emit a compile-time iec_sizeof constant.
    const firstArg =
      expr.arguments.length === 1 ? expr.arguments[0]?.value : undefined;
    if (
      (nameUpper === "SIZEOF" || nameUpper === "XSIZEOF") &&
      firstArg &&
      firstArg.kind === "VariableExpression"
    ) {
      const arg = firstArg;
      if (
        arg.fieldAccess.length === 0 &&
        (!arg.accessChain || arg.accessChain.length === 0)
      ) {
        const argNameUpper = arg.name.toUpperCase();
        if (
          !this.currentScopeVarTypes.has(argNameUpper) &&
          !this.currentScopeVarRefKinds.has(argNameUpper)
        ) {
          const isType =
            isElementaryType(argNameUpper) ||
            this.isUserDefinedType(arg.name) ||
            this.enumTypeMembers.has(argNameUpper) ||
            argNameUpper === "STRING" ||
            argNameUpper === "WSTRING";
          if (isType) {
            const cppType = this.mapVarTypeToCpp(arg.name);
            return nameUpper === "SIZEOF"
              ? `IEC_UDINT(iec_sizeof<${cppType}>::value)`
              : `IEC_XWORD(iec_sizeof<${cppType}>::value)`;
          }
        }
      }
    }

    // 3. Check for standard function (may have different cppName)
    const stdFunc = this.stdRegistry.lookup(nameUpper);
    if (stdFunc) {
      const isRealRoundingFunc =
        nameUpper === "ROUND" ||
        nameUpper === "TRUNC" ||
        nameUpper === "TRUNC_INT";
      const args = expr.arguments.map((arg, idx) => {
        let generated = this.generateExpression(arg.value);
        // Untyped real literals like ROUND(1.5) are C++ doubles and would be
        // ambiguous between the IEC_REAL and IEC_LREAL overloads. Force the
        // float IEC_REAL overload so the generated C++ compiles.
        if (
          isRealRoundingFunc &&
          idx === 0 &&
          arg.value.kind === "LiteralExpression" &&
          arg.value.literalType === "REAL" &&
          !arg.value.typePrefix
        ) {
          generated = `IEC_REAL(${generated}f)`;
        }
        // For the bare `TO_xxx(temporal_var)` spelling, `nameUpper` is
        // a registered std function (not a `*_TO_*` form) so the source
        // type isn't in the name — infer it from the argument's IEC
        // type and apply the same temporal→ms wrap as the conversion
        // branch above.  Conversion std functions advertise
        // `isConversion: true` and carry the target in
        // `specificReturnType`, so we have everything needed without
        // adding a new schema field.
        if (idx === 0 && stdFunc.isConversion && stdFunc.specificReturnType) {
          const fromType = this.inferExprType(arg.value);
          if (fromType) {
            generated = this.wrapTemporalArgForNumericConversion(
              generated,
              fromType.toUpperCase(),
              stdFunc.specificReturnType.toUpperCase(),
            );
          }
        }
        return generated;
      });
      this.harmonizeStdFuncArgs(args, expr.arguments, stdFunc);
      return `${stdFunc.cppName}(${args.join(", ")})`;
    }

    // 3. Check for named arguments that may need reordering
    const hasNamedArgs = expr.arguments.some((arg) => arg.name !== undefined);
    if (hasNamedArgs && this.ast) {
      const reordered = this.reorderNamedArguments(expr);
      if (reordered) {
        const args = reordered.map((r) => r.expr);
        const argExprs = reordered.map((r) => r.arg);
        const paramTypes = this.getParamTypes(nameUpper);
        if (paramTypes) {
          this.coerceUserFuncArgs(args, argExprs, paramTypes);
          this.wrapAnyTypeArgs(args, argExprs, paramTypes);
        }
        return `${expr.functionName}(${args.join(", ")})`;
      }
    }

    // 4. Default: emit as-is (with output argument validation)
    const args = expr.arguments.map((arg) => {
      const generated = this.generateExpression(arg.value);
      if (arg.isOutput && arg.value.kind !== "VariableExpression") {
        this.codegenWarnings.push({
          message: `Output argument '${arg.name ?? ""}' should be a variable, not an expression`,
          line: arg.sourceSpan.startLine,
          column: arg.sourceSpan.startCol,
          file: arg.sourceSpan.file,
        });
      }
      return generated;
    });

    // Pad missing trailing VAR_OUTPUT/VAR_IN_OUT params with temp variables
    if (this.ast) {
      const funcDecl = this.ast.functions.find(
        (f) => f.name.toUpperCase() === nameUpper,
      );
      if (funcDecl) {
        const paramInfo: Array<{ blockType: string; typeName: string }> = [];
        for (const block of funcDecl.varBlocks) {
          if (
            block.blockType === "VAR_INPUT" ||
            block.blockType === "VAR_IN_OUT" ||
            block.blockType === "VAR_OUTPUT"
          ) {
            for (const decl of block.declarations) {
              for (let ni = 0; ni < decl.names.length; ni++) {
                paramInfo.push({
                  blockType: block.blockType,
                  typeName: decl.type.name,
                });
              }
            }
          }
        }
        while (args.length < paramInfo.length) {
          const param = paramInfo[args.length]!;
          if (
            param.blockType === "VAR_OUTPUT" ||
            param.blockType === "VAR_IN_OUT"
          ) {
            args.push(this.emitOutputTempVar(param.typeName));
          } else {
            args.push(this.getDefaultValue(param.typeName));
          }
        }
      }
    }

    // Apply implicit widening casts and wrap ANY/ANY_* arguments with the
    // CODESYS AnyType descriptor for user-defined function calls.
    const paramTypes = this.getParamTypes(nameUpper);
    if (paramTypes) {
      this.coerceUserFuncArgs(args, expr.arguments, paramTypes);
      this.wrapAnyTypeArgs(args, expr.arguments, paramTypes);
    }

    return `${expr.functionName}(${args.join(", ")})`;
  }

  /**
   * Reorder named arguments to match function declaration parameter order.
   * Positional args are placed first (in declaration order, skipping named slots),
   * then named args fill their declared slots. Unfilled parameters get default values.
   * Returns null if function not found in AST.
   */
  private reorderNamedArguments(
    expr: FunctionCallExpression,
  ): Array<{ expr: string; arg: Argument | undefined }> | null {
    if (!this.ast) return null;

    // Find the function declaration in the AST
    const funcDecl = this.ast.functions.find(
      (f) => f.name.toUpperCase() === expr.functionName.toUpperCase(),
    );
    if (!funcDecl) return null;

    // Build parameter info from VAR_INPUT, VAR_IN_OUT, VAR_OUTPUT blocks
    const params: Array<{
      name: string;
      typeName: string;
      blockType: string;
      defaultExpr?: string;
    }> = [];
    for (const block of funcDecl.varBlocks) {
      if (
        block.blockType === "VAR_INPUT" ||
        block.blockType === "VAR_IN_OUT" ||
        block.blockType === "VAR_OUTPUT"
      ) {
        for (const decl of block.declarations) {
          for (const name of decl.names) {
            const entry: {
              name: string;
              typeName: string;
              blockType: string;
              defaultExpr?: string;
            } = {
              name: name.toUpperCase(),
              typeName: decl.type.name,
              blockType: block.blockType,
            };
            if (decl.initialValue) {
              entry.defaultExpr = this.generateInitializer(
                decl.type,
                decl.initialValue,
              );
            }
            params.push(entry);
          }
        }
      }
    }

    // Build set of parameter slots claimed by named arguments
    // (skip implicit EN/ENO — handled separately by EN/ENO codegen logic)
    const namedArgs = new Map<
      string,
      { expr: string; arg: Argument; isOutput: boolean }
    >();
    const claimedSlots = new Set<string>();
    for (const arg of expr.arguments) {
      if (arg.name !== undefined) {
        const upperName = arg.name.toUpperCase();
        if (upperName === "EN" || upperName === "ENO") continue;
        namedArgs.set(upperName, {
          expr: this.generateExpression(arg.value),
          arg,
          isOutput: arg.isOutput,
        });
        claimedSlots.add(upperName);

        // Validate output argument is a variable
        if (arg.isOutput && arg.value.kind !== "VariableExpression") {
          this.codegenWarnings.push({
            message: `Output argument '${arg.name}' should be a variable, not an expression`,
            line: arg.sourceSpan.startLine,
            column: arg.sourceSpan.startCol,
            file: arg.sourceSpan.file,
          });
        }
      }
    }

    // Warn about named args that don't match any declared parameter,
    // and check for direction mismatches (=> on VAR_INPUT)
    const paramLookup = new Map(params.map((p) => [p.name, p]));
    for (const [argName, argInfo] of namedArgs) {
      const param = paramLookup.get(argName);
      if (!param) {
        const span = expr.sourceSpan;
        this.codegenWarnings.push({
          message: `Named argument '${argName}' does not match any parameter of function '${expr.functionName}'`,
          line: span.startLine,
          column: span.startCol,
          file: span.file,
        });
      } else if (argInfo.isOutput && param.blockType === "VAR_INPUT") {
        const span = expr.sourceSpan;
        this.codegenWarnings.push({
          message: `Output argument '=>' used for input parameter '${param.name.toLowerCase()}' — did you mean ':='?`,
          line: span.startLine,
          column: span.startCol,
          file: span.file,
        });
      }
    }

    // Collect positional args (preserving source order)
    const positionalArgs: { expr: string; arg: Argument }[] = [];
    for (const arg of expr.arguments) {
      if (arg.name === undefined) {
        positionalArgs.push({ expr: this.generateExpression(arg.value), arg });
      }
    }

    // Assign positional args to unclaimed parameter slots (in declaration order)
    const result: Array<
      { expr: string; arg: Argument | undefined } | undefined
    > = Array.from({ length: params.length }, () => undefined);
    let positionalIdx = 0;
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      if (claimedSlots.has(param.name)) {
        // This slot is reserved for a named arg - skip it for positional fill
        continue;
      }
      if (positionalIdx < positionalArgs.length) {
        result[i] = positionalArgs[positionalIdx]!;
        positionalIdx++;
      }
    }

    // Fill named arg slots
    for (let i = 0; i < params.length; i++) {
      const param = params[i]!;
      const named = namedArgs.get(param.name);
      if (named !== undefined) {
        result[i] = { expr: named.expr, arg: named.arg };
      }
    }

    // Fill any remaining unfilled slots with defaults (or temp vars for output params)
    for (let i = 0; i < params.length; i++) {
      if (result[i] === undefined) {
        const param = params[i]!;
        if (
          param.blockType === "VAR_OUTPUT" ||
          param.blockType === "VAR_IN_OUT"
        ) {
          result[i] = {
            expr: this.emitOutputTempVar(param.typeName),
            arg: undefined,
          };
        } else {
          result[i] = {
            expr: param.defaultExpr ?? this.getDefaultValue(param.typeName),
            arg: undefined,
          };
        }
      }
    }

    return result.map((v) => {
      if (v !== undefined) return v;
      // Should be unreachable; every slot is filled above.
      return { expr: "", arg: undefined };
    });
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Emit a temporary variable declaration for an omitted VAR_OUTPUT/VAR_IN_OUT argument.
   * The temp is emitted before the current statement line (since generateExpression()
   * runs before the statement's emit() call). Returns the temp variable name.
   */
  private emitOutputTempVar(typeName: string): string {
    const name = `__output_tmp_${this.tempVarCounter++}`;
    const cppType = this.mapVarTypeToCpp(typeName);
    this.emit(`${this.currentStatementIndent}${cppType} ${name};`);
    return name;
  }

  /**
   * Check if a type name refers to a known function block type.
   */
  private isFBType(typeName: string): boolean {
    return this.knownFBTypes.has(typeName.toUpperCase());
  }

  /**
   * VAR_IN_OUT parameters that are FB or interface types are stored as C++
   * pointers and passed by pointer; primitive/structured inouts keep copy-in/copy-out.
   */
  private isPointerInoutType(typeName: string): boolean {
    const upper = typeName.toUpperCase();
    return this.isFBType(typeName) || this.knownInterfaceTypes.has(upper);
  }

  /**
   * Returns true when a TypeReference is a REFERENCE TO a user-defined
   * (FB / struct / program) type. CODESYS method chaining relies on these
   * returning a reference to the object rather than an IEC_REFERENCE_TO wrapper.
   */
  private isReferenceToUserDefined(typeRef: {
    name: string;
    referenceKind: ReferenceKind;
  }): boolean {
    if (typeRef.referenceKind !== "reference_to") return false;
    const upper = typeRef.name.toUpperCase();
    return (
      this.knownFBTypes.has(upper) ||
      this.knownStructTypes.has(upper) ||
      this.knownProgramTypes.has(upper)
    );
  }

  /**
   * Map a method return type to C++. For REFERENCE TO a user-defined type this
   * is a C++ reference (e.g. StringBuilder&); otherwise the normal wrapper.
   */
  private mapMethodReturnTypeToCpp(typeRef: {
    name: string;
    referenceKind: ReferenceKind;
  }): string {
    if (this.isReferenceToUserDefined(typeRef)) {
      const upper = typeRef.name.toUpperCase();
      const baseType = this.knownProgramTypes.has(upper)
        ? `Program_${typeRef.name}`
        : typeRef.name;
      return `${baseType}&`;
    }
    return this.mapTypeRefToCpp({
      name: typeRef.name,
      referenceKind: typeRef.referenceKind,
    });
  }

  /**
   * Map the hidden result variable type for a method. For REFERENCE TO a
   * user-defined type the variable is a pointer that is dereferenced on return.
   */
  private mapMethodResultVarType(typeRef: {
    name: string;
    referenceKind: ReferenceKind;
  }): string {
    if (this.isReferenceToUserDefined(typeRef)) {
      const upper = typeRef.name.toUpperCase();
      const baseType = this.knownProgramTypes.has(upper)
        ? `Program_${typeRef.name}`
        : typeRef.name;
      return `${baseType}*`;
    }
    return this.mapTypeRefToCpp({
      name: typeRef.name,
      referenceKind: typeRef.referenceKind,
    });
  }

  /**
   * When `typeName` (a member's declared type) is also the name of a sibling
   * member in the same scope, return the C++ elaborated-type-specifier keyword
   * (`class `/`struct `) needed so the bare type name isn't resolved to the data
   * member. Returns "" when there's no shadowing or the type isn't a composite.
   */
  private elaboratedTagIfShadowed(
    typeName: string,
    memberNames: Set<string>,
  ): string {
    const u = typeName.toUpperCase();
    if (!memberNames.has(u)) return "";
    // Enums are emitted as `using IEC_X = IEC_ENUM<X>` aliases, which cannot be
    // named with an elaborated `struct`/`class` specifier. They also never need
    // disambiguation here because the member is already mangled (name_).
    if (this.enumTypeMembers.has(u)) return "";
    if (this.knownFBTypes.has(u)) return "class ";
    if (this.knownStructTypes.has(u)) return "struct ";
    return "";
  }

  /**
   * Check if a type name refers to a known interface type.
   */
  public isInterfaceType(typeName: string): boolean {
    return this.knownInterfaceTypes.has(typeName.toUpperCase());
  }

  /**
   * Resolve the declared case of a method name given the type and method name.
   * Returns the declared name if found, or the original name if not.
   */
  private resolveMethodName(typeName: string, methodName: string): string {
    const key = `${typeName.toUpperCase()}.${methodName.toUpperCase()}`;
    return this.methodNameMap.get(key) ?? methodName;
  }

  /**
   * Resolve method name case by searching all known types.
   * Used when the object type is not easily determined (e.g., chained calls).
   */
  private resolveMethodNameGlobal(methodName: string): string {
    const upper = methodName.toUpperCase();
    for (const [key, declaredName] of this.methodNameMap) {
      if (key.endsWith(`.${upper}`)) {
        return declaredName;
      }
    }
    return methodName;
  }

  /**
   * Resolve a property name from the property name map.
   * Returns the declared property name if the field is a property, undefined otherwise.
   */
  private resolvePropertyName(
    typeName: string | undefined,
    fieldName: string,
  ): string | undefined {
    if (!typeName) return undefined;
    const key = `${typeName.toUpperCase()}.${fieldName.toUpperCase()}`;
    return this.propertyNameMap.get(key);
  }

  /**
   * Resolve the type of a member field on a given FB or struct type.
   * Used for chained access like ctrl.motor.Speed where we need to know
   * motor's type to check if Speed is a property.
   */
  protected resolveMemberType(
    typeName: string | undefined,
    memberName: string,
  ): string | undefined {
    if (!typeName) return undefined;
    if (this.ast) {
      const result = resolveFieldTypeUtil(typeName, memberName, this.ast);
      if (result) return result;
    }
    // Fallback: check library FB field types
    return this.libraryFBFieldTypes.get(
      `${typeName.toUpperCase()}.${memberName.toUpperCase()}`,
    );
  }

  /**
   * Detect if an assignment target is a property write (e.g., m.Speed := 75).
   * Returns the object code prefix and property name if so, undefined otherwise.
   */
  private detectPropertyWrite(
    target: Expression,
  ): { objectCode: string; propertyName: string } | undefined {
    if (target.kind !== "VariableExpression") return undefined;
    const expr = target;
    if (expr.fieldAccess.length === 0) return undefined;

    const nameUpper = expr.name.toUpperCase();
    const lastField = expr.fieldAccess[expr.fieldAccess.length - 1]!;

    // Resolve the type at the point just before the last field
    let currentType: string | undefined;
    if (nameUpper === "THIS") currentType = this.currentFBName;
    else if (nameUpper === "SUPER") currentType = this.currentFBExtends;
    else currentType = this.currentScopeVarTypes.get(nameUpper);

    for (let i = 0; i < expr.fieldAccess.length - 1; i++) {
      if (!currentType) break;
      currentType = this.resolveMemberType(currentType, expr.fieldAccess[i]!);
    }

    if (!currentType) return undefined;
    const propName = this.resolvePropertyName(currentType, lastField);
    if (!propName) return undefined;

    // Build the object code (everything except the last field)
    let objectCode: string;
    if (nameUpper === "THIS") {
      objectCode = "this->";
      let ct: string | undefined = this.currentFBName;
      for (let i = 0; i < expr.fieldAccess.length - 1; i++) {
        const f = expr.fieldAccess[i]!;
        const ft = this.resolveMemberType(ct, f);
        objectCode += (this.needsFieldMangling(f, ft, ct) ? `${f}_` : f) + ".";
        ct = ft;
      }
    } else if (nameUpper === "SUPER" && this.currentFBExtends) {
      objectCode = this.currentFBExtends + "::";
      let ct: string | undefined = this.currentFBExtends;
      for (let i = 0; i < expr.fieldAccess.length - 1; i++) {
        const f = expr.fieldAccess[i]!;
        const ft = this.resolveMemberType(ct, f);
        objectCode += (this.needsFieldMangling(f, ft, ct) ? `${f}_` : f) + ".";
        ct = ft;
      }
    } else {
      // Generate a VariableExpression with fieldAccess trimmed to all-but-last
      // Also trim the accessChain if present
      const baseExpr: VariableExpression = {
        ...expr,
        fieldAccess: expr.fieldAccess.slice(0, -1),
      };
      if (expr.accessChain) {
        const trimmed = this.trimLastFieldFromAccessChain(expr.accessChain);
        if (trimmed) {
          baseExpr.accessChain = trimmed;
        } else {
          delete baseExpr.accessChain;
        }
      }
      objectCode = this.generateVariableExpression(baseExpr) + ".";
    }

    return { objectCode, propertyName: propName };
  }

  /**
   * Remove the last field step from an access chain (for bit access / property trim).
   * Returns undefined if the chain becomes empty.
   */
  private trimLastFieldFromAccessChain(
    chain: AccessStep[],
  ): AccessStep[] | undefined {
    const trimmed = [...chain];
    for (let i = trimmed.length - 1; i >= 0; i--) {
      if (trimmed[i]!.kind === "field") {
        trimmed.splice(i, 1);
        break;
      }
    }
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /**
   * Check if a type name refers to any user-defined type (FB, interface, or struct/UDT).
   * These types should NOT get the IEC_ prefix.
   */
  protected isUserDefinedType(typeName: string): boolean {
    const upper = typeName.toUpperCase();
    return (
      this.knownFBTypes.has(upper) ||
      this.knownInterfaceTypes.has(upper) ||
      this.knownStructTypes.has(upper) ||
      this.knownProgramTypes.has(upper)
    );
  }

  /**
   * Populate the sets of VAR_IN_OUT pointer members for the current FB scope.
   * Call after enterScope() so all FB member types are known.
   */
  private setFBInoutFBPointers(
    varBlocks: CompilationUnit["programs"][0]["varBlocks"],
  ): void {
    this.currentScopeInoutFBPointers.clear();
    this.currentScopeInoutArrayPointers.clear();
    for (const block of varBlocks) {
      if (block.blockType !== "VAR_IN_OUT") continue;
      for (const decl of block.declarations) {
        if (
          decl.type.arrayDimensions !== undefined ||
          decl.type.elementTypeName !== undefined
        ) {
          for (const name of decl.names) {
            this.currentScopeInoutArrayPointers.add(name.toUpperCase());
          }
          continue;
        }
        if (this.isFBType(decl.type.name)) {
          for (const name of decl.names) {
            this.currentScopeInoutFBPointers.add(name.toUpperCase());
          }
        }
      }
    }
  }

  /**
   * Enter a new scope for code generation. Populates currentScopeVarTypes
   * from the variable blocks of a program or function block, then adds
   * VAR_GLOBAL declarations. When names collide, local declarations shadow
   * global declarations.
   */
  private enterScope(
    varBlocks: CompilationUnit["programs"][0]["varBlocks"],
  ): void {
    this.currentScopeVarTypes.clear();
    this.currentScopeVarRefKinds.clear();
    this.currentScopeInoutFBPointers.clear();
    this.currentScopeInoutArrayPointers.clear();
    this.currentScopeVarIsArray.clear();
    this.memberMangledNames.clear();

    // Initialize with global declarations so local declarations can shadow them.
    // This lets a program/FB invoke a global function-block instance by name.
    for (const block of this.ast?.globalVarBlocks ?? []) {
      for (const decl of block.declarations) {
        for (const name of decl.names) {
          this.currentScopeVarTypes.set(name.toUpperCase(), decl.type.name);
          if (
            decl.type.referenceKind !== undefined &&
            decl.type.referenceKind !== "none"
          ) {
            this.currentScopeVarRefKinds.set(
              name.toUpperCase(),
              decl.type.referenceKind,
            );
          }
        }
      }
    }

    for (const block of varBlocks) {
      for (const decl of block.declarations) {
        const cppType = this.isUserDefinedType(decl.type.name)
          ? decl.type.name
          : `IEC_${decl.type.name}`;
        for (const name of decl.names) {
          this.currentScopeVarTypes.set(name.toUpperCase(), decl.type.name);
          if (
            decl.type.arrayDimensions !== undefined ||
            decl.type.elementTypeName !== undefined
          ) {
            this.currentScopeVarIsArray.add(name.toUpperCase());
          }
          if (
            decl.type.referenceKind !== undefined &&
            decl.type.referenceKind !== "none"
          ) {
            this.currentScopeVarRefKinds.set(
              name.toUpperCase(),
              decl.type.referenceKind,
            );
          }
          // Detect member name collisions with type name (GCC -Wchanges-meaning)
          if (
            this.isUserDefinedType(decl.type.name) &&
            name.toUpperCase() === cppType.toUpperCase()
          ) {
            this.memberMangledNames.set(name.toUpperCase(), `${name}_`);
          }
          // Detect member name collisions with interface method names
          if (this.currentFBInterfaceMethods.has(name.toUpperCase())) {
            this.memberMangledNames.set(name.toUpperCase(), `${name}_`);
          }
        }
      }
    }
  }

  /**
   * Exit the current scope, clearing variable type tracking.
   */
  private exitScope(): void {
    this.currentScopeVarTypes.clear();
    this.currentScopeVarIsArray.clear();
  }

  /**
   * Topologically sort function blocks so that FBs containing instances of
   * other FBs are emitted after their dependencies (Kahn's algorithm).
   */
  private topologicalSortFBs(
    fbs: CompilationUnit["functionBlocks"],
  ): CompilationUnit["functionBlocks"] {
    if (fbs.length <= 1) return fbs;

    // Build name → FB mapping
    const fbMap = new Map<string, (typeof fbs)[0]>();
    for (const fb of fbs) {
      fbMap.set(fb.name.toUpperCase(), fb);
    }

    // Build adjacency: fbName → set of FB names it depends on (has as members)
    const deps = new Map<string, Set<string>>();
    for (const fb of fbs) {
      const fbDeps = new Set<string>();
      for (const block of fb.varBlocks) {
        for (const decl of block.declarations) {
          const typeName = decl.type.name.toUpperCase();
          if (fbMap.has(typeName) && typeName !== fb.name.toUpperCase()) {
            fbDeps.add(typeName);
          }
        }
      }
      // Also check EXTENDS (parent FB must come first)
      if (fb.extends) {
        const parentUpper = fb.extends.toUpperCase();
        if (fbMap.has(parentUpper)) {
          fbDeps.add(parentUpper);
        }
      }
      deps.set(fb.name.toUpperCase(), fbDeps);
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    for (const fb of fbs) {
      inDegree.set(
        fb.name.toUpperCase(),
        deps.get(fb.name.toUpperCase())!.size,
      );
    }

    const queue: string[] = [];
    for (const [name, degree] of inDegree) {
      if (degree === 0) queue.push(name);
    }

    const sorted: (typeof fbs)[0][] = [];
    while (queue.length > 0) {
      const name = queue.shift()!;
      sorted.push(fbMap.get(name)!);

      // Reduce in-degree for FBs that depend on this one
      for (const [fbName, fbDeps] of deps) {
        if (fbDeps.has(name)) {
          fbDeps.delete(name);
          const newDeg = inDegree.get(fbName)! - 1;
          inDegree.set(fbName, newDeg);
          if (newDeg === 0) queue.push(fbName);
        }
      }
    }

    // If cycle detected, append remaining in original order
    if (sorted.length < fbs.length) {
      for (const fb of fbs) {
        if (!sorted.includes(fb)) {
          sorted.push(fb);
        }
      }
    }

    return sorted;
  }

  /**
   * Check if a function call statement is actually an FB invocation.
   * Returns the FB type name if it is, undefined otherwise.
   */
  private getFBInvocationType(functionName: string): string | undefined {
    const varType = this.currentScopeVarTypes.get(functionName.toUpperCase());
    if (
      varType &&
      (this.isFBType(varType) ||
        this.knownProgramTypes.has(varType.toUpperCase()))
    ) {
      return varType;
    }
    return undefined;
  }

  /**
   * Generate code for an FB invocation.
   * Pattern: assign inputs → call operator() → capture outputs
   */
  /**
   * Extract implicit EN/ENO arguments from a function/FB call.
   * Returns the EN condition expression, ENO target variable, and the
   * remaining arguments with EN/ENO stripped out.
   */
  private extractEnEno(args: Argument[]): {
    enExpr: string | null;
    enoVar: string | null;
    filteredArgs: Argument[];
  } {
    let enExpr: string | null = null;
    let enoVar: string | null = null;
    const filteredArgs: Argument[] = [];

    for (const arg of args) {
      const nameUpper = arg.name?.toUpperCase();
      if (nameUpper === "EN" && !arg.isOutput) {
        enExpr = this.generateExpression(arg.value);
      } else if (nameUpper === "ENO" && arg.isOutput) {
        enoVar = this.generateExpression(arg.value);
      } else {
        filteredArgs.push(arg);
      }
    }

    return { enExpr, enoVar, filteredArgs };
  }

  /**
   * Check if a function call argument list contains EN or ENO implicit parameters.
   */
  private hasEnEno(args: Argument[]): boolean {
    return args.some((a) => {
      const n = a.name?.toUpperCase();
      return (n === "EN" && !a.isOutput) || (n === "ENO" && a.isOutput);
    });
  }

  /**
   * Emit an EN/ENO wrapper around a body-emitting callback.
   *
   * Two ENO sinks are reflected uniformly:
   *   - `enoVar`              — the caller's `ENO => var` binding, if any.
   *   - `instanceEnoTarget`   — the FB instance's implicit ENO member
   *                             (e.g. `inst.ENO`), passed for FB calls so
   *                             `IF inst.ENO THEN ...` reads the right
   *                             value.  null for plain function calls.
   *
   * Both sinks are written every time so they can't carry stale values
   * across calls.  Per IEC 61131-3 §6.4.1.3, ENO defaults to TRUE when
   * EN is omitted — so an unguarded call writes TRUE to every sink it
   * has, which also overwrites any FALSE left behind by a prior gated
   * invocation.
   */
  private emitEnEnoWrapper(
    indent: string,
    enExpr: string | null,
    enoVar: string | null,
    emitBody: (bodyIndent: string) => void,
    instanceEnoTarget: string | null = null,
  ): void {
    const targets = [enoVar, instanceEnoTarget].filter(
      (t): t is string => t !== null,
    );
    const writeTargets = (atIndent: string, value: boolean): void => {
      for (const t of targets) {
        this.emit(`${atIndent}${t} = ${value};`);
      }
    };

    if (enExpr !== null) {
      const bodyIndent = indent + this.options.indent;
      this.emit(`${indent}if (${enExpr}) {`);
      emitBody(bodyIndent);
      writeTargets(bodyIndent, true);
      this.emit(`${indent}} else {`);
      writeTargets(bodyIndent, false);
      this.emit(`${indent}}`);
    } else {
      emitBody(indent);
      writeTargets(indent, true);
    }
  }

  private generateFBInvocation(
    call: FunctionCallExpression,
    indent: string,
  ): void {
    const rawName = this.resolveVariableBaseName(call.functionName);

    // Calling a function-block instance that is a shared global: not yet
    // supported (see generateVariableExpression for the rationale). An FB call
    // mutates instance state and reads its outputs across several emitted
    // lines; doing that safely needs a single with_lock() spanning the whole
    // call, which is a follow-up phase. Fail loudly.
    if (this.compositeExternals.has(call.functionName.toUpperCase())) {
      throw new Error(
        `Shared global '${call.functionName}' is a function-block instance and ` +
          `is invoked in a program body. Calling a shared function-block global ` +
          `is not yet supported in the mutex-based shared-global model — scalar ` +
          `globals only for now.`,
      );
    }

    const instanceName =
      this.memberMangledNames.get(rawName.toUpperCase()) ?? rawName;

    // Extract implicit EN/ENO parameters
    const { enExpr, enoVar, filteredArgs } = this.extractEnEno(call.arguments);

    // Resolve FB type for positional argument mapping
    const fbTypeName = this.currentScopeVarTypes.get(rawName.toUpperCase());
    const inputParamNames = fbTypeName
      ? this.fbInputParams.get(fbTypeName.toUpperCase())
      : undefined;

    const inoutParams = fbTypeName
      ? this.fbInoutParams.get(fbTypeName.toUpperCase())
      : undefined;

    // Assign input parameters (named or positional)
    let positionalIndex = 0;
    for (const arg of filteredArgs) {
      if (arg.isOutput) continue;

      const argName = arg.name;
      const isInout =
        argName && inoutParams && inoutParams.has(argName.toUpperCase());
      if (isInout) {
        const inoutKey = `${fbTypeName!.toUpperCase()}.${argName.toUpperCase()}`;
        const inoutTypeName = this.fbInoutParamTypes.get(inoutKey);
        const isInoutArray = this.fbInoutParamIsArray.get(inoutKey);
        // FB/interface/array-typed VAR_IN_OUT is passed by pointer; primitive
        // scalars keep the existing copy-in/copy-out lowering.
        if (
          (inoutTypeName && this.isPointerInoutType(inoutTypeName)) ||
          isInoutArray
        ) {
          this.emit(
            `${indent}${instanceName}.${argName} = ${this.generatePointerExpression(arg.value)};`,
          );
        } else {
          this.emit(
            `${indent}${instanceName}.${argName} = ${this.generateExpression(arg.value)};`,
          );
        }
      } else if (arg.name) {
        // Named argument: assign directly
        this.emit(
          `${indent}${instanceName}.${arg.name} = ${this.generateExpression(arg.value)};`,
        );
      } else if (inputParamNames && positionalIndex < inputParamNames.length) {
        // Positional argument: map to VAR_INPUT by position
        const paramName = inputParamNames[positionalIndex];
        this.emit(
          `${indent}${instanceName}.${paramName} = ${this.generateExpression(arg.value)};`,
        );
        positionalIndex++;
      } else {
        // Positional argument without type info — emit as warning comment
        this.emit(
          `${indent}// WARNING: positional argument ${positionalIndex} could not be resolved`,
        );
        positionalIndex++;
      }
    }

    // Call the FB/program execution body, wrapped with EN/ENO logic.
    // Pass the FB instance's ENO field so source code can read
    // `inst.ENO` after the invocation and see the right value.
    this.emitEnEnoWrapper(
      indent,
      enExpr,
      enoVar,
      (bi) => {
        this.emitPOUCallLine(instanceName, call.functionName, bi);
      },
      `${instanceName}.ENO`,
    );

    // Copy VAR_IN_OUT parameters back to the caller's variables. For FB/interface
    // inouts the member is a pointer, so the caller's object is mutated in place
    // and no copy-out is needed. Primitive/structured inouts keep the existing
    // copy-in/copy-out lowering.
    if (inoutParams && inoutParams.size > 0) {
      for (const arg of filteredArgs) {
        if (arg.isOutput) continue;
        if (arg.name && inoutParams.has(arg.name.toUpperCase())) {
          const inoutKey = `${fbTypeName!.toUpperCase()}.${arg.name.toUpperCase()}`;
          const inoutTypeName = this.fbInoutParamTypes.get(inoutKey);
          const isInoutArray = this.fbInoutParamIsArray.get(inoutKey);
          if (
            (inoutTypeName && this.isPointerInoutType(inoutTypeName)) ||
            isInoutArray
          ) {
            continue;
          }
          this.emitCaptureToLvalue(
            arg.value,
            `${instanceName}.${arg.name}`,
            indent,
          );
        }
      }
    }

    // Capture output arguments (=> syntax), excluding ENO (already handled)
    for (const arg of filteredArgs) {
      if (arg.name && arg.isOutput) {
        this.emitCaptureToLvalue(
          arg.value,
          `${instanceName}.${arg.name}`,
          indent,
        );
      }
    }
  }

  /**
   * Emit `<target> = <source>` where `source` is an already-rendered C++
   * expression. If `target` is a composite / array shared global (VAR_EXTERNAL
   * to a composite VAR_GLOBAL), the write goes through the global's mutex via
   * with_lock (a with_lock read result is an rvalue and can't be assigned to).
   * Used for FB VAR_IN_OUT copy-back and `=>` output capture.
   */
  private emitCaptureToLvalue(
    target: Expression,
    source: string,
    indent: string,
  ): void {
    if (
      target.kind === "VariableExpression" &&
      !target.isDereference &&
      this.compositeExternals.has(target.name.toUpperCase())
    ) {
      const ptr = this.resolveVariableBaseName(target.name);
      const lv = this.renderAccessTail(
        "(*__glk)",
        target,
        target.name.toUpperCase(),
      );
      this.emit(
        `${indent}${ptr}->with_lock([&](auto* __glk){ ${lv} = ${source}; });`,
      );
      return;
    }
    // Scalar VAR_EXTERNAL capture → the shared global is a pointer, so its value
    // is read via `->read()` (an rvalue) and written via `->write()`. Assigning
    // to `->read()` fails to compile, so route the write through the pointer,
    // mirroring the scalar-external branch of generateAssignmentStatement.
    if (
      target.kind === "VariableExpression" &&
      target.fieldAccess.length === 0 &&
      !target.isDereference &&
      this.programExternals.has(target.name.toUpperCase())
    ) {
      this.emit(`${indent}${target.name}->write(${source});`);
      return;
    }
    this.emit(`${indent}${this.generateExpression(target)} = ${source};`);
  }

  /**
   * Collect all interface method names (UPPER case) for a FB's IMPLEMENTS list.
   */
  protected getInterfaceMethodNames(fb: {
    implements?: string[];
  }): Set<string> {
    const result = new Set<string>();
    if (!fb.implements) return result;
    for (const ifaceName of fb.implements) {
      const methods = this.interfaceMethodsByInterface.get(
        ifaceName.toUpperCase(),
      );
      if (methods) {
        for (const m of methods) result.add(m);
      }
    }
    return result;
  }

  /**
   * Collect the (UPPER, original) names of every interface implemented by a FB,
   * including interfaces inherited through interface EXTENDS and FB EXTENDS.
   */
  private getImplementedInterfaceNames(
    fb: CompilationUnit["functionBlocks"][0],
  ): Array<{ upper: string; original: string }> {
    const result: Array<{ upper: string; original: string }> = [];
    const seen = new Set<string>();
    const ifaceMap = new Map(
      this.ast!.interfaces.map((i) => [i.name.toUpperCase(), i] as const),
    );
    const fbMap = new Map(
      this.ast!.functionBlocks.map((f) => [f.name.toUpperCase(), f] as const),
    );
    const visit = (name: string) => {
      const upper = name.toUpperCase();
      if (seen.has(upper)) return;
      seen.add(upper);
      const iface = ifaceMap.get(upper);
      if (iface) {
        result.push({ upper, original: iface.name });
        if (iface.extends) {
          for (const e of iface.extends) visit(e);
        }
      }
    };
    const visitFB = (fbName: string) => {
      const f = fbMap.get(fbName.toUpperCase());
      if (!f) return;
      if (f.implements) {
        for (const ifaceName of f.implements) visit(ifaceName);
      }
      if (f.extends) visitFB(f.extends);
    };
    visitFB(fb.name);
    return result;
  }

  /**
   * If a member variable name collides with its C++ type name or an interface
   * method name (case-insensitive), append '_' to avoid C++ errors.
   * Populates memberMangledNames map and returns the (possibly mangled) name.
   */
  private mangleMemberIfNeeded(
    name: string,
    _cppType: string,
    stTypeName: string,
  ): string {
    // Variable name vs type name collision (GCC -Wchanges-meaning)
    if (this.isUserDefinedType(stTypeName)) {
      if (name.toUpperCase() === stTypeName.toUpperCase()) {
        const mangled = `${name}_`;
        this.memberMangledNames.set(name.toUpperCase(), mangled);
        return mangled;
      }
    }
    // Variable name vs interface method name collision
    if (this.currentFBInterfaceMethods.has(name.toUpperCase())) {
      const mangled = `${name}_`;
      this.memberMangledNames.set(name.toUpperCase(), mangled);
      return mangled;
    }
    return name;
  }

  /**
   * Check if a field access needs mangling — true when the field name collides
   * with its type name (GCC -Wchanges-meaning) or with an interface method name.
   */
  private needsFieldMangling(
    fieldName: string,
    fieldTypeName: string | undefined,
    parentTypeName?: string,
  ): boolean {
    // Field name vs type name collision
    if (
      fieldTypeName &&
      this.isUserDefinedType(fieldTypeName) &&
      fieldName.toUpperCase() === fieldTypeName.toUpperCase()
    ) {
      return true;
    }
    // Field name vs interface method name collision
    if (parentTypeName) {
      const ifaceMethods = this.fbInterfaceMethodNames.get(
        parentTypeName.toUpperCase(),
      );
      if (ifaceMethods?.has(fieldName.toUpperCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resolve the base name for a variable. Subclasses can override to add
   * prefixes (e.g., "s." for SETUP variables in test codegen).
   */
  protected resolveVariableBaseName(name: string): string {
    return name;
  }

  /**
   * Emit the call line for a POU (FB or program) invocation.
   * Subclasses can override to change the call pattern (e.g., ".run()" for programs).
   */
  protected emitPOUCallLine(
    instanceName: string,
    _rawName: string,
    indent: string,
  ): void {
    this.emit(`${indent}${instanceName}();`);
  }

  /**
   * Get the default value for a type.
   */
  private getDefaultValue(
    typeName: string,
    initialValue?: string,
    elementTypeName?: string,
  ): string {
    const upperType = typeName.toUpperCase();
    if (this.knownInterfaceTypes.has(upperType)) {
      if (initialValue) {
        const upperInit = initialValue.toUpperCase();
        if (upperInit === "0" || upperInit === "NULL") return "nullptr";
        return `&${initialValue}`;
      }
      return "nullptr";
    }
    // Generic ANY/ANY_* parameters are passed as strucpp::AnyType descriptors.
    if (isGenericTypeName(upperType)) {
      return "strucpp::AnyType()";
    }
    if (initialValue) {
      // Convert enum dot-notation (TRAFFICSTATE.RED) to C++ scoped access (TRAFFICSTATE::RED)
      const dotIdx = initialValue.indexOf(".");
      if (dotIdx > 0) {
        const prefix = initialValue.substring(0, dotIdx).toUpperCase();
        if (this.enumTypeMembers.has(prefix)) {
          return initialValue.replace(".", "::");
        }
      }
      // Bare enum initializer: Stopped → Irrigation_State::Stopped
      const bareEntry = this.enumMemberToType.get(initialValue.toUpperCase());
      if (bareEntry?.typeName) {
        return `${bareEntry.typeName}::${initialValue}`;
      }
      // Convert TIME/LTIME literals (T#30s, TIME#1m2s) to nanoseconds
      const upperInit = initialValue.toUpperCase();
      if (
        upperInit.startsWith("T#") ||
        upperInit.startsWith("TIME#") ||
        upperInit.startsWith("LTIME#") ||
        upperInit.startsWith("LT#")
      ) {
        const timeVal = parseTimeLiteral(initialValue);
        return `${timeVal.nanoseconds}LL`;
      }
      // Convert temporal calendar literals at the PROGRAM-init path —
      // FB initialisers route through `generateExpression` which
      // handles these in `generateLiteralExpression`, but PROGRAM VAR
      // initialisers come through this helper with the literal as a
      // raw string.  Without these branches the PROGRAM constructor
      // emits `D(DATE#1970-01-15)` verbatim and the C++ side fails
      // to compile.  Lowering rule matches the literal-expression
      // path: DATE → days, TOD → ns since midnight, DT → ns since
      // epoch.  Same rule the runtime helpers consume.
      if (
        upperInit.startsWith("D#") ||
        upperInit.startsWith("DATE#") ||
        upperInit.startsWith("LDATE#")
      ) {
        return `${parseDateLiteralToDays(initialValue)}LL`;
      }
      if (
        upperInit.startsWith("TOD#") ||
        upperInit.startsWith("TIME_OF_DAY#") ||
        upperInit.startsWith("LTOD#")
      ) {
        return `${parseTodLiteralToNs(initialValue)}LL`;
      }
      if (
        upperInit.startsWith("DT#") ||
        upperInit.startsWith("DATE_AND_TIME#") ||
        upperInit.startsWith("LDT#")
      ) {
        return `${parseDtLiteralToNs(initialValue)}LL`;
      }
      // Convert IEC BOOL literals to C++ bool literals
      if (upperInit === "TRUE") return "true";
      if (upperInit === "FALSE") return "false";
      // Handle typed string literals: STRING#'abc' and WSTRING#"abc".
      // The type prefix tells us the literal kind; the value part uses the
      // same quote conventions as untyped string literals.
      const typedStringMatch = initialValue.match(/^(STRING|WSTRING)#/i);
      if (typedStringMatch) {
        const valuePart = initialValue.substring(typedStringMatch[0].length);
        if (valuePart.startsWith("'") && valuePart.endsWith("'")) {
          const inner = valuePart.slice(1, -1);
          const escaped = this.translateIECString(inner);
          return `"${escaped}"`;
        }
        if (valuePart.startsWith('"') && valuePart.endsWith('"')) {
          const inner = valuePart.slice(1, -1);
          const escaped = this.translateIECString(inner);
          return `u"${escaped}"`;
        }
      }
      // Convert IEC string literals to the matching C++ literal shape:
      //   'foo' (STRING)  → "foo"  (const char*)
      //   "foo" (WSTRING) → u"foo" (const char16_t*, what IECWStringVar
      //                            binds to — `L"…"` is wchar_t and
      //                            32-bit on Linux/AVR, wrong type)
      // The two literal kinds are NOT interchangeable per IEC 61131-3;
      // a mismatch (e.g. WSTRING := 'foo') is a type error and is the
      // type-checker's responsibility, not codegen's. Codegen just
      // mirrors the literal it was handed.
      if (initialValue.startsWith("'") && initialValue.endsWith("'")) {
        const inner = initialValue.slice(1, -1);
        const escaped = this.translateIECString(inner);
        return `"${escaped}"`;
      }
      if (initialValue.startsWith('"') && initialValue.endsWith('"')) {
        const inner = initialValue.slice(1, -1);
        const escaped = this.translateIECString(inner);
        return `u"${escaped}"`;
      }
      // Lower IEC numeric literals (based 16#FF/8#17/2#1010, decimals
      // with underscore separators, typed prefixes like INT#5, optional
      // sign). PROGRAM/GLOBAL VAR initialisers arrive here as raw IEC
      // strings; without this they're emitted verbatim (`X(16#FF)`,
      // `X(1_000)`, `X(INT#5)`) and the C++ build fails. Mirrors the
      // expression-statement path (formatIntegerLiteral). Returns null
      // for non-numeric initialisers (enum names, constants), which then
      // pass through unchanged.
      const numeric = this.lowerNumericInitializer(initialValue);
      if (numeric !== null) {
        return numeric;
      }

      // Array aggregate initialisers (e.g. `[10, 20, 30, 40]`). Program and
      // global VAR initialisers arrive here as raw strings because the project
      // model serialises `initialValue`; convert them to C++ brace lists.
      if (
        initialValue.trim().startsWith("[") &&
        initialValue.trim().endsWith("]")
      ) {
        const elType =
          elementTypeName ?? this.extractInlineArrayElementType(typeName);
        return this.lowerArrayInitializer(initialValue, elType);
      }

      return initialValue;
    }

    if (upperType === "BOOL") return "false";
    if (upperType === "REAL" || upperType === "LREAL") return "0.0";
    if (upperType === "STRING") return '""';
    if (upperType === "WSTRING") return 'u""';

    // Check if it's an elementary type that uses numeric default
    const numericTypes = [
      "SINT",
      "INT",
      "DINT",
      "LINT",
      "USINT",
      "UINT",
      "UDINT",
      "ULINT",
      "BYTE",
      "WORD",
      "DWORD",
      "LWORD",
      "TIME",
      "DATE",
      "TOD",
      "DT",
      "LTIME",
      "LDATE",
      "LTOD",
      "LDT",
      "CHAR",
      "WCHAR",
    ];
    if (numericTypes.includes(upperType)) {
      return "0";
    }

    // User-defined types (structs, enums, arrays, subranges, type aliases)
    // use default initialization - return empty string to skip in initializer list
    return "";
  }

  /**
   * For inline ARRAY types, strip the synthetic `__INLINE_ARRAY_` prefix to
   * reveal the element type name (e.g. `__INLINE_ARRAY_DINT` -> `DINT`).
   * Nested arrays strip one prefix at a time.
   */
  private extractInlineArrayElementType(typeName: string): string | undefined {
    const prefix = "__INLINE_ARRAY_";
    if (typeName.toUpperCase().startsWith(prefix)) {
      return typeName.slice(prefix.length);
    }
    return undefined;
  }

  /**
   * Convert an IEC array aggregate literal string (e.g. `[10, 20, 30, 40]` or
   * `[[1,2], [3,4]]`) into a C++ brace-initialiser list. Each element is lowered
   * with `getDefaultValue` so typed literals, based numbers, strings, bools,
   * times, and nested arrays are handled uniformly.
   */
  private lowerArrayInitializer(
    initialValue: string,
    elementTypeName?: string,
  ): string {
    const trimmed = initialValue.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
      return trimmed;
    }
    const inner = trimmed.slice(1, -1).trim();
    if (inner.length === 0) {
      return "{}";
    }
    const elements = this.splitArrayElements(inner);
    const nestedElementType = elementTypeName
      ? this.extractInlineArrayElementType(elementTypeName)
      : undefined;
    const lowered = elements.map((el) => {
      const trimmedEl = el.trim();
      if (trimmedEl.startsWith("[")) {
        return this.getDefaultValue(
          elementTypeName ?? "",
          trimmedEl,
          nestedElementType,
        );
      }
      return this.getDefaultValue(elementTypeName ?? "", trimmedEl);
    });
    return `{${lowered.join(", ")}}`;
  }

  /**
   * Split a comma-separated list of IEC array elements, respecting nested
   * brackets and string quotes.
   */
  private splitArrayElements(inner: string): string[] {
    const elements: string[] = [];
    let depth = 0;
    let inString: string | undefined;
    let current = "";
    for (const ch of inner) {
      if (inString) {
        current += ch;
        if (ch === inString) {
          inString = undefined;
        }
        continue;
      }
      if (ch === "'" || ch === '"') {
        inString = ch;
        current += ch;
        continue;
      }
      if (ch === "[") {
        depth++;
      } else if (ch === "]") {
        depth--;
      }
      if (ch === "," && depth === 0) {
        elements.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim().length > 0) {
      elements.push(current.trim());
    }
    return elements;
  }

  /**
   * Lower an IEC numeric literal initializer string to a C++ literal.
   *
   * Handles based literals (16#FF, 8#17, 2#1010), decimals/reals with
   * IEC underscore separators (1_000, 16#FF_FF), an optional leading
   * sign (-5, +3), and an optional IEC type prefix (INT#5, BYTE#16#AB,
   * REAL#1.5). Reuses {@link iecBaseToCppLiteral}, the same helper the
   * expression path uses, so declaration initialisers and statement
   * bodies lower identically.
   *
   * Returns `null` when `raw` is not a recognised numeric literal, so
   * non-numeric initialisers (enum names, named constants) pass through
   * unchanged at the call site.
   */
  private lowerNumericInitializer(raw: string): string | null {
    let s = raw.trim();
    let sign = "";
    if (s.startsWith("-") || s.startsWith("+")) {
      sign = s[0]!;
      s = s.slice(1).trimStart();
    }
    // Strip an optional IEC type prefix (TYPE#...). The leading
    // identifier must start with a letter/underscore, which excludes
    // radix markers like `16#` whose left side is numeric.
    const typePrefix = /^[A-Za-z_][A-Za-z0-9_]*#(.+)$/.exec(s);
    if (typePrefix) {
      s = typePrefix[1]!;
    }
    const isNumeric =
      /^16#[0-9A-Fa-f][0-9A-Fa-f_]*$/.test(s) ||
      /^8#[0-7][0-7_]*$/.test(s) ||
      /^2#[01][01_]*$/.test(s) ||
      /^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eE][+-]?[0-9]+)?$/.test(s);
    if (!isNumeric) {
      return null;
    }
    return sign + iecBaseToCppLiteral(s);
  }

  /**
   * Collect all program instances from a configuration.
   */
  private collectProgramInstances(
    config: ConfigurationDecl,
  ): Array<{ instanceName: string; programType: string; taskName?: string }> {
    const instances: Array<{
      instanceName: string;
      programType: string;
      taskName?: string;
    }> = [];
    for (const resource of config.resources) {
      for (const task of resource.tasks) {
        for (const inst of task.programInstances) {
          instances.push(inst);
        }
      }
    }
    return instances;
  }

  /**
   * Count total tasks in a configuration.
   */
  private countTasks(config: ConfigurationDecl): number {
    let count = 0;
    for (const resource of config.resources) {
      count += resource.tasks.length;
    }
    return count;
  }

  /**
   * Collect a located variable for descriptor array generation.
   */
  private collectLocatedVar(
    varName: string,
    cppName: string,
    decl: VarDeclaration,
    programName: string,
    isGlobalVarWrapper: boolean = false,
  ): void {
    if (!decl.address) return;

    const parsed = parseLocatedAddress(decl.address);
    if (!parsed) return;

    this.locatedVars.push({
      varName,
      cppName,
      address: decl.address,
      area: parsed.area,
      size: parsed.size,
      byteIndex: parsed.byteIndex,
      bitIndex: parsed.bitIndex,
      typeName: decl.type.name,
      programName,
      isGlobalVarWrapper,
    });
  }

  /**
   * Collect a located variable from project model for descriptor array generation.
   */
  private collectLocatedVarFromModel(
    decl: {
      name: string;
      cppName?: string;
      typeName: string;
      address?: string;
      isGlobalVarWrapper?: boolean;
    },
    programName: string,
  ): void {
    if (!decl.address) return;

    const parsed = parseLocatedAddress(decl.address);
    if (!parsed) return;

    this.locatedVars.push({
      varName: decl.name,
      cppName: decl.cppName ?? decl.name,
      address: decl.address,
      area: parsed.area,
      size: parsed.size,
      byteIndex: parsed.byteIndex,
      bitIndex: parsed.bitIndex,
      typeName: decl.typeName,
      programName,
      isGlobalVarWrapper: decl.isGlobalVarWrapper ?? false,
    });
  }

  /**
   * Generate the located variables descriptor array in the header.
   */
  private generateLocatedVarsDeclaration(): void {
    // Library compilations (no PROGRAM, no CONFIGURATION — only FBs /
    // functions / types) must NOT emit these symbols, otherwise the
    // consumer's program would see two definitions when its preamble
    // includes the library. Top-level program builds always emit them so
    // the runtime sketch can reference `locatedVars` / `locatedVarsCount`
    // unconditionally — including when the user has zero `AT %...`
    // declarations (then we emit a 1-element placeholder array because
    // C++ disallows zero-length arrays at namespace scope; the sketch's
    // binding loop iterates `i < locatedVarsCount` so the placeholder is
    // never accessed at runtime).
    const hasPrograms =
      !!this.projectModel && this.projectModel.programs.size > 0;
    if (!hasPrograms) return;

    const isEmpty = this.locatedVars.length === 0;
    const arrayLen = isEmpty ? 1 : this.locatedVars.length;

    this.emitHeader(
      "// =============================================================================",
    );
    this.emitHeader("// Located Variables Descriptor Array");
    this.emitHeader(
      "// =============================================================================",
    );
    this.emitHeader("");
    this.emitHeader("/**");
    this.emitHeader(" * Located variable descriptors for runtime I/O binding.");
    this.emitHeader(
      " * The runtime iterates this array to bind variables to I/O image tables.",
    );
    this.emitHeader(" */");
    this.emitHeader("");

    // Forward declarations for program instances
    for (const locVar of this.locatedVars) {
      const scope =
        locVar.programName === "@config"
          ? "configuration"
          : `Program_${locVar.programName}`;
      this.emitHeader(
        `// Forward: ${locVar.varName} AT ${locVar.address} in ${scope}`,
      );
    }
    if (isEmpty) {
      this.emitHeader("// (no located variables — placeholder entry only)");
    }
    this.emitHeader("");

    // The actual array will be defined in the implementation file
    // and initialized in the constructor
    this.emitHeader(`extern LocatedVar locatedVars[${arrayLen}];`);
    this.emitHeader(
      `constexpr uint32_t locatedVarsCount = ${this.locatedVars.length};`,
    );
    this.emitHeader("");
    this.emitHeader(
      "// Initialize all located variable pointers after static initialization.",
    );
    this.emitHeader("void __init_global_located_pointers();");
    this.emitHeader("");
  }

  /**
   * Generate the located variables array definition in the implementation.
   */
  private generateLocatedVarsDefinition(): void {
    // Mirror the declaration's library-skip + placeholder logic.
    const hasPrograms =
      !!this.projectModel && this.projectModel.programs.size > 0;
    if (!hasPrograms) return;

    const isEmpty = this.locatedVars.length === 0;
    const arrayLen = isEmpty ? 1 : this.locatedVars.length;

    this.emit(
      "// =============================================================================",
    );
    this.emit("// Located Variables Descriptor Array");
    this.emit(
      "// =============================================================================",
    );
    this.emit("");
    this.emit(`LocatedVar locatedVars[${arrayLen}] = {`);

    if (isEmpty) {
      this.emit(
        `    { LocatedArea::Input, LocatedSize::Bit, 0, 0, {0, 0, 0}, nullptr }  // placeholder; locatedVarsCount is 0`,
      );
    } else {
      for (let i = 0; i < this.locatedVars.length; i++) {
        const locVar = this.locatedVars[i]!;
        const comma = i < this.locatedVars.length - 1 ? "," : "";
        this.emit(
          `    { LocatedArea::${locVar.area}, LocatedSize::${locVar.size}, ` +
            `${locVar.byteIndex}, ${locVar.bitIndex}, {0, 0, 0}, nullptr }${comma}  // ${locVar.varName} AT ${locVar.address}`,
        );
      }
    }

    this.emit("};");
    this.emit("");
  }

  /**
   * This program's contiguous slice [offset, offset+count) of the project-wide
   * locatedVars[] table. The table is built in program-iteration order, so a
   * single program's located vars are contiguous. Used by the STRUCPP_THREADED
   * located_range() override so the runtime can scope located I/O copy-in/out
   * to the owning task.
   */
  private locatedRangeForProgram(programName: string): {
    offset: number;
    count: number;
  } {
    let offset = -1;
    let count = 0;
    for (let i = 0; i < this.locatedVars.length; i++) {
      if (this.locatedVars[i]!.programName === programName) {
        if (offset < 0) offset = i;
        count++;
      }
    }
    return { offset: offset < 0 ? 0 : offset, count };
  }

  /**
   * Generate initialization code for located variable pointers.
   * Called from within a program constructor.
   */
  private generateLocatedVarPointerInit(
    programName: string,
    indent: string = "    ",
  ): void {
    const progVars = this.locatedVars.filter(
      (v) => v.programName === programName,
    );
    if (progVars.length === 0) return;

    this.emit(`${indent}// Initialize located variable pointers`);
    for (const locVar of progVars) {
      // Find the index of this variable in the global array
      const index = this.locatedVars.findIndex(
        (v) =>
          v.varName === locVar.varName && v.programName === locVar.programName,
      );
      if (index >= 0) {
        const memberAccess = locVar.isGlobalVarWrapper ? ".value" : "";
        this.emit(
          `${indent}locatedVars[${index}].pointer = ${locVar.cppName}${memberAccess}.raw_ptr();`,
        );
      }
    }
  }

  /**
   * Generate a program method that binds this program's located variable
   * descriptors to its member storage. Called from main() after all static
   * initialization is complete, avoiding dynamic-initialization-order races
   * with the global locatedVars[] array.
   */
  private generateBindLocatedVars(programName: string): void {
    const progVars = this.locatedVars.filter(
      (v) => v.programName === programName,
    );
    if (progVars.length === 0) return;

    this.emit(`void Program_${programName}::bind_located_vars() {`);
    for (const locVar of progVars) {
      const index = this.locatedVars.findIndex(
        (v) =>
          v.varName === locVar.varName && v.programName === locVar.programName,
      );
      if (index >= 0) {
        this.emit(
          `    locatedVars[${index}].pointer = this->${locVar.cppName}.raw_ptr();`,
        );
      }
    }
    this.emit("}");
    this.emit("");
  }

  /**
   * Generate a function that binds configuration / top-level global located
   * variable descriptors to their canonical storage. Called from main() after
   * all static initialization is complete.
   */
  private generateInitGlobalLocatedPointers(): void {
    const globals = this.locatedVars.filter((v) => v.programName === "@config");

    this.emit("void __init_global_located_pointers() {");
    for (const locVar of globals) {
      const index = this.locatedVars.findIndex(
        (v) =>
          v.varName === locVar.varName && v.programName === locVar.programName,
      );
      if (index >= 0) {
        const memberAccess = locVar.isGlobalVarWrapper ? ".value" : "";
        this.emit(
          `    locatedVars[${index}].pointer = ${locVar.cppName}${memberAccess}.raw_ptr();`,
        );
      }
    }
    this.emit("}");
    this.emit("");
  }

  /**
   * Emit a line to the implementation output.
   */
  protected emit(line: string): void {
    this.output.push(line);
    this.currentLine++;
  }

  /**
   * Emit a line to the header output.
   */
  private emitHeader(line: string): void {
    this.headerOutput.push(line);
    this.currentHeaderLine++;
  }

  /**
   * Emit a #line directive before implementation code for source-level debugging.
   */
  private emitLineDirective(stLine: number): void {
    if (this.options.lineDirectives) {
      const fn = (
        this.options.lineDirectiveFileName ?? this.options.fileName
      ).replaceAll("\\", "/");
      this.emit(`#line ${stLine} "${fn}"`);
    }
  }

  /**
   * Emit a #line directive before header code for source-level debugging.
   */
  private emitHeaderLineDirective(stLine: number): void {
    if (this.options.lineDirectives) {
      const fn = (
        this.options.lineDirectiveFileName ?? this.options.fileName
      ).replaceAll("\\", "/");
      this.emitHeader(`#line ${stLine} "${fn}"`);
    }
  }

  /**
   * Record a line mapping from ST to C++.
   * Used in Phase 3+ for debugging support.
   */
  private recordLineMapping(stLine: number, cppStartLine: number): void {
    // currentLine points to the *next* line to be emitted, so the last
    // emitted line is currentLine - 1.
    const lastEmittedLine = this.currentLine - 1;
    const existing = this.lineMap.get(stLine);
    if (existing !== undefined) {
      existing.cppEndLine = lastEmittedLine;
    } else {
      this.lineMap.set(stLine, {
        cppStartLine,
        cppEndLine: lastEmittedLine,
      });
    }
  }

  private recordHeaderLineMapping(
    stLine: number,
    headerStartLine: number,
  ): void {
    const lastEmittedHeaderLine = this.currentHeaderLine - 1;
    const existing = this.headerLineMap.get(stLine);
    if (existing !== undefined) {
      existing.cppEndLine = lastEmittedHeaderLine;
    } else {
      this.headerLineMap.set(stLine, {
        cppStartLine: headerStartLine,
        cppEndLine: lastEmittedHeaderLine,
      });
    }
  }
}

/**
 * Generate C++ code from a compilation unit.
 * Convenience function that creates a generator and runs code generation.
 */
export function generateCode(
  ast: CompilationUnit,
  symbolTables: SymbolTables,
  options?: Partial<CodeGenOptions>,
): CodeGenResult {
  const generator = new CodeGenerator(symbolTables, options);
  return generator.generate(ast);
}
