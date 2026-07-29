// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ REPL Main Generator
 *
 * Generates a main.cpp file that bootstraps the interactive PLC test REPL.
 * Takes the AST and ProjectModel to produce variable descriptors and program
 * instantiation code.
 */

import type {
  ArrayDefinition,
  CompilationUnit,
  Expression,
  TypeDeclaration,
  VarBlock,
} from "../frontend/ast.js";
import type { ProjectModel } from "../project-model.js";
import type { LineMapEntry } from "../types.js";
import { getProjectNamespace } from "../project-model.js";
import { isElementaryType } from "../semantic/type-registry.js";

/**
 * Escape ST source for embedding in a C++ raw string literal with delimiter STRUCPP_SRC.
 * If the source contains the closing sequence `)STRUCPP_SRC"`, replace it with a safe variant.
 */
function escapeRawStringLiteral(
  source: string,
  delimiter: string = "STRUCPP_SRC",
): string {
  // The closing delimiter is )DELIMITER" — if this appears in the source, mangle it
  let result = source;
  const closingSeq = `)${delimiter}"`;
  if (result.includes(closingSeq)) {
    result = result.replace(
      new RegExp(`\\)${delimiter}"`, "g"),
      `)${delimiter}_`,
    );
  }
  return result;
}

/**
 * Map of IEC type names to VarTypeTag enum values.
 */
const TYPE_TAG_MAP: Record<string, string> = {
  BOOL: "BOOL",
  SINT: "SINT",
  INT: "INT",
  DINT: "DINT",
  LINT: "LINT",
  USINT: "USINT",
  UINT: "UINT",
  UDINT: "UDINT",
  ULINT: "ULINT",
  REAL: "REAL",
  LREAL: "LREAL",
  BYTE: "BYTE",
  WORD: "WORD",
  DWORD: "DWORD",
  LWORD: "LWORD",
  TIME: "TIME",
  STRING: "STRING",
  WSTRING: "WSTRING",
  CHAR: "CHAR",
  WCHAR: "WCHAR",
  DATE: "DATE",
  TOD: "TOD",
  TIME_OF_DAY: "TOD",
  DT: "DT",
  DATE_AND_TIME: "DT",
  LTIME: "LTIME",
  LDATE: "LDATE",
  LTOD: "LTOD",
  LONG_TIME_OF_DAY: "LTOD",
  LDT: "LDT",
  LONG_DATE_AND_TIME: "LDT",
};

const DEFAULT_STRING_LENGTH = 254;

function isStringType(typeName: string): boolean {
  const upper = typeName.toUpperCase();
  return upper === "STRING" || upper === "WSTRING";
}

/**
 * Get the VarTypeTag for a given IEC type name.
 *
 * Non-default-length STRING/WSTRING are mapped to OTHER because the REPL
 * runtime helpers are currently specialized for the default 254-character
 * IEC_STRING/IEC_WSTRING aliases; casting a smaller/larger instance to those
 * fixed-width aliases reads/writes outside the variable's storage.
 */
function getTypeTag(
  typeName: string,
  isArray = false,
  maxLength?: number | string,
): string {
  if (isArray) return "ARRAY";
  const upper = typeName.toUpperCase();
  if (isStringType(typeName)) {
    if (maxLength !== undefined && maxLength !== DEFAULT_STRING_LENGTH) {
      return "OTHER";
    }
  }
  return TYPE_TAG_MAP[upper] ?? "OTHER";
}

/**
 * Convert an identifier to a valid C++ function-name fragment.
 */
function safeIdent(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Resolve a type name to its underlying TypeDeclaration definition, following aliases.
 */
function resolveTypeDeclaration(
  ast: CompilationUnit,
  name: string,
  visited = new Set<string>(),
): TypeDeclaration | undefined {
  const upper = name.toUpperCase();
  if (visited.has(upper)) return undefined;
  visited.add(upper);

  const decl = ast.types.find((t) => t.name.toUpperCase() === upper);
  if (!decl) return undefined;

  if (decl.definition.kind !== "TypeReference") {
    return decl;
  }

  return resolveTypeDeclaration(ast, decl.definition.name, visited);
}

/**
 * Resolve a type name to an ArrayDefinition, following aliases through TYPE blocks.
 */
function resolveArrayDefinition(
  ast: CompilationUnit,
  name: string,
  visited = new Set<string>(),
): ArrayDefinition | undefined {
  const decl = resolveTypeDeclaration(ast, name, visited);
  if (decl?.definition.kind === "ArrayDefinition") {
    return decl.definition;
  }
  return undefined;
}

/**
 * Resolve a type name to an elementary base type, following aliases and subranges.
 * Returns the elementary type name and optional STRING/WSTRING max length, or
 * undefined when the chain ends in a composite, enum, pointer/reference, or
 * unknown type.
 */
function resolveElementaryType(
  ast: CompilationUnit,
  name: string,
  visited = new Set<string>(),
): { name: string; maxLength?: number | string } | undefined {
  const upper = name.toUpperCase();
  if (visited.has(upper)) return undefined;
  visited.add(upper);

  if (isElementaryType(upper)) {
    return { name };
  }

  const decl = ast.types.find((t) => t.name.toUpperCase() === upper);
  if (!decl) return undefined;

  if (decl.definition.kind === "TypeReference") {
    const ref = decl.definition;
    if (ref.referenceKind && ref.referenceKind !== "none") {
      return undefined;
    }
    const resolved = resolveElementaryType(ast, ref.name, visited);
    if (!resolved) return undefined;
    if (ref.maxLength !== undefined) {
      return { ...resolved, maxLength: ref.maxLength };
    }
    return resolved;
  }

  if (decl.definition.kind === "SubrangeDefinition") {
    return resolveElementaryType(ast, decl.definition.baseType.name, visited);
  }

  return undefined;
}

/**
 * Return a human-readable kind label for a composite (non-elementary) type.
 * Returns undefined for types that are not known composites.
 */
function getCompositeLabel(
  ast: CompilationUnit,
  name: string,
  visited = new Set<string>(),
): string | undefined {
  const upper = name.toUpperCase();
  if (visited.has(upper)) return undefined;
  visited.add(upper);

  if (ast.functionBlocks.some((fb) => fb.name.toUpperCase() === upper)) {
    return "FB";
  }

  const decl = ast.types.find((t) => t.name.toUpperCase() === upper);
  if (!decl) return undefined;

  if (decl.definition.kind === "StructDefinition") {
    return "struct";
  }

  if (decl.definition.kind === "EnumDefinition") {
    return "enum";
  }

  if (decl.definition.kind === "TypeReference") {
    return getCompositeLabel(ast, decl.definition.name, visited);
  }

  return undefined;
}

function extractIntegerLiteral(expr: Expression): number | undefined {
  if (expr.kind !== "LiteralExpression") return undefined;
  if (typeof expr.value === "number" && Number.isFinite(expr.value)) {
    return expr.value;
  }
  if (typeof expr.value === "string") {
    const n = Number(expr.value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Extract constant integer bounds from an ArrayDefinition.
 * Returns undefined if any dimension is variable-length or non-constant.
 */
function getArrayBounds(
  def: ArrayDefinition,
): Array<{ start: number; end: number }> | undefined {
  const bounds: Array<{ start: number; end: number }> = [];
  for (const dim of def.dimensions) {
    if (dim.isVariableLength) return undefined;
    const start = dim.start ? extractIntegerLiteral(dim.start) : undefined;
    const end = dim.end ? extractIntegerLiteral(dim.end) : undefined;
    if (start === undefined || end === undefined) return undefined;
    bounds.push({ start, end });
  }
  return bounds;
}

interface ArrayInfo {
  dimensions: Array<{ start: number; end: number }>;
  elementTypeName: string;
  elementMaxLength?: number | string;
}

/**
 * Try to resolve an array variable to its dimensions and element type.
 * Works for inline arrays and named array type aliases.
 */
function resolveArrayInfo(
  v: VarInfo,
  ast: CompilationUnit,
): ArrayInfo | undefined {
  if (v.arrayDimensions && v.elementTypeName) {
    return {
      dimensions: v.arrayDimensions,
      elementTypeName: v.elementTypeName,
      ...(v.elementMaxLength !== undefined
        ? { elementMaxLength: v.elementMaxLength }
        : {}),
    };
  }

  const def = resolveArrayDefinition(ast, v.typeName);
  if (!def) return undefined;

  const dims = getArrayBounds(def);
  if (!dims) return undefined;

  return {
    dimensions: dims,
    elementTypeName: def.elementType.name,
    ...(def.elementType.maxLength !== undefined
      ? { elementMaxLength: def.elementType.maxLength }
      : {}),
  };
}

/**
 * Map an IEC elementary type name to its C++ wrapper type for use as an array element.
 */
function mapElementCppType(
  typeName: string,
  maxLength?: number | string,
): string | undefined {
  const upper = typeName.toUpperCase();

  if (upper === "STRING") {
    const len = maxLength ?? DEFAULT_STRING_LENGTH;
    return `strucpp::IECStringVar<${len}>`;
  }
  if (upper === "WSTRING") {
    const len = maxLength ?? DEFAULT_STRING_LENGTH;
    return `strucpp::IECWStringVar<${len}>`;
  }

  if (isElementaryType(upper)) {
    const tag = TYPE_TAG_MAP[upper] ?? upper;
    return `strucpp::IEC_${tag}`;
  }

  // User-defined composites (including enums) are not expanded at this level.
  return undefined;
}

interface VarInfo {
  name: string;
  typeName: string;
  isArray: boolean;
  maxLength?: number | string;
  arrayDimensions?: Array<{ start: number; end: number }>;
  elementTypeName?: string;
  elementMaxLength?: number | string;
  toStringFn?: string;
}

/**
 * Collect variable names and types from var blocks (only VAR, VAR_INPUT, VAR_OUTPUT).
 */
function collectVarsFromBlocks(
  varBlocks: VarBlock[],
  ast: CompilationUnit,
): VarInfo[] {
  const vars: VarInfo[] = [];
  for (const block of varBlocks) {
    // Include VAR, VAR_INPUT, VAR_OUTPUT — skip VAR_EXTERNAL, VAR_TEMP, VAR_IN_OUT
    if (
      block.blockType === "VAR" ||
      block.blockType === "VAR_INPUT" ||
      block.blockType === "VAR_OUTPUT"
    ) {
      for (const decl of block.declarations) {
        const hasInlineDims =
          decl.type.arrayDimensions !== undefined &&
          decl.type.arrayDimensions.length > 0;
        const isArray =
          hasInlineDims ||
          resolveArrayDefinition(ast, decl.type.name) !== undefined;
        for (const name of decl.names) {
          const entry: VarInfo = {
            name,
            typeName: decl.type.name,
            isArray,
          };
          if (decl.type.maxLength !== undefined) {
            entry.maxLength = decl.type.maxLength;
          }
          if (hasInlineDims) {
            if (decl.type.arrayDimensions) {
              entry.arrayDimensions = decl.type.arrayDimensions;
            }
            if (decl.type.elementTypeName) {
              entry.elementTypeName = decl.type.elementTypeName;
            }
            if (decl.type.maxLength !== undefined) {
              entry.elementMaxLength = decl.type.maxLength;
            }
          }
          vars.push(entry);
        }
      }
    }
  }
  return vars;
}

/**
 * Options for REPL main generation.
 */
export interface ReplMainGenOptions {
  /** Header filename to include (default: "generated.hpp") */
  headerFileName: string;
  /** Original ST source to embed in the binary for the `code` command */
  stSource?: string;
  /** Generated C++ implementation code to embed for side-by-side display */
  cppCode?: string;
  /** Generated C++ header code to embed for side-by-side display */
  headerCode?: string;
  /** Line mapping from ST to C++ implementation for side-by-side alignment */
  lineMap?: Map<number, LineMapEntry>;
  /** Line mapping from ST to C++ header for side-by-side alignment */
  headerLineMap?: Map<number, LineMapEntry>;
}

/**
 * Generate main.cpp source code for the interactive REPL.
 */
export function generateReplMain(
  ast: CompilationUnit,
  projectModel: ProjectModel,
  options: ReplMainGenOptions = { headerFileName: "generated.hpp" },
): string {
  const lines: string[] = [];
  const ns = getProjectNamespace(projectModel);

  // Includes
  lines.push(`#include "${options.headerFileName}"`);
  lines.push('#include "iec_repl.hpp"');
  lines.push('#include "iec_cyclic.hpp"');
  lines.push("");
  lines.push(`using namespace ${ns};`);
  lines.push("using strucpp::VarTypeTag;");
  lines.push("using strucpp::VarDescriptor;");
  lines.push("using strucpp::ProgramDescriptor;");
  lines.push("using strucpp::STLineMap;");
  lines.push("");

  // Embed ST source as raw string literal
  if (options.stSource) {
    const safeSource = escapeRawStringLiteral(options.stSource);
    lines.push(
      `static const char* g_st_source = R"STRUCPP_SRC(${safeSource})STRUCPP_SRC";`,
    );
  } else {
    lines.push("static const char* g_st_source = nullptr;");
  }
  lines.push("");

  // Embed C++ source as raw string literal (header + implementation combined)
  if (options.headerCode || options.cppCode) {
    const headerPart = options.headerCode ?? "";
    const cppPart = options.cppCode ?? "";
    const combined = headerPart + (headerPart && cppPart ? "\n" : "") + cppPart;
    const safeCpp = escapeRawStringLiteral(combined, "STRUCPP_CPP");
    lines.push(
      `static const char* g_cpp_source = R"STRUCPP_CPP(${safeCpp})STRUCPP_CPP";`,
    );
  } else {
    lines.push("static const char* g_cpp_source = nullptr;");
  }
  lines.push("");

  // Build merged line map (header lines + offset implementation lines)
  const headerLineCount = options.headerCode
    ? options.headerCode.split("\n").length
    : 0;
  const offset = headerLineCount > 0 && options.cppCode ? headerLineCount : 0;

  const mergedEntries: Array<
    [number, { cppStartLine: number; cppEndLine: number }]
  > = [];

  // Add header line map entries (no offset needed)
  if (options.headerLineMap) {
    for (const [stLine, entry] of options.headerLineMap) {
      mergedEntries.push([
        stLine,
        { cppStartLine: entry.cppStartLine, cppEndLine: entry.cppEndLine },
      ]);
    }
  }

  // Add implementation line map entries (with offset)
  if (options.lineMap) {
    for (const [stLine, entry] of options.lineMap) {
      const existing = mergedEntries.find((e) => e[0] === stLine);
      if (existing) {
        // ST line appears in both maps — extend the range
        existing[1].cppEndLine = entry.cppEndLine + offset;
      } else {
        mergedEntries.push([
          stLine,
          {
            cppStartLine: entry.cppStartLine + offset,
            cppEndLine: entry.cppEndLine + offset,
          },
        ]);
      }
    }
  }

  mergedEntries.sort((a, b) => a[0] - b[0]);

  // Embed merged line map as C struct array
  if (mergedEntries.length > 0) {
    lines.push("static STLineMap g_line_map[] = {");
    for (const [stLine, entry] of mergedEntries) {
      lines.push(
        `    {${stLine}, ${entry.cppStartLine}, ${entry.cppEndLine}},`,
      );
    }
    lines.push("};");
    lines.push(`static size_t g_line_map_count = ${mergedEntries.length};`);
  } else {
    lines.push("static STLineMap* g_line_map = nullptr;");
    lines.push("static size_t g_line_map_count = 0;");
  }
  lines.push("");

  const hasConfigurations = projectModel.configurations.length > 0;

  if (hasConfigurations) {
    generateWithConfiguration(lines, ast, projectModel);
  } else {
    generateStandalone(lines, ast, projectModel);
  }

  return lines.join("\n");
}

/**
 * Unified program info for REPL code generation.
 */
interface ProgramInfo {
  /** Display name for ProgramDescriptor */
  displayName: string;
  /** C++ expression for instance pointer (e.g. "prog_Main" or "config_Cfg.inst1") */
  instanceExpr: string;
  /** Name for the VarDescriptor array */
  varsDescName: string;
  /** Variables to expose in the REPL */
  vars: VarInfo[];
  /** Task interval in nanoseconds (0 = REPL applies 20ms default) */
  intervalNs: number;
}

/**
 * Emit per-variable to_string helpers for arrays and composite types.
 */
function emitToStringFunctions(
  lines: string[],
  programs: ProgramInfo[],
  ast: CompilationUnit,
): void {
  for (const prog of programs) {
    for (const v of prog.vars) {
      const fnName = `__strucpp_to_string_${safeIdent(prog.displayName)}_${safeIdent(v.name)}`;

      if (v.isArray) {
        const info = resolveArrayInfo(v, ast);
        if (!info) continue;

        const elementTag = getTypeTag(
          info.elementTypeName,
          false,
          info.elementMaxLength,
        );
        if (elementTag === "OTHER") continue;

        const elementCpp = mapElementCppType(
          info.elementTypeName,
          info.elementMaxLength,
        );
        if (!elementCpp) continue;

        const emitted = emitArrayToString(
          lines,
          fnName,
          elementCpp,
          elementTag,
          info.dimensions,
        );
        if (emitted) {
          v.toStringFn = fnName;
        }
      } else {
        const resolved = resolveElementaryType(ast, v.typeName);
        const tagName = resolved?.name ?? v.typeName;
        const maxLength = resolved?.maxLength ?? v.maxLength;
        const upper = tagName.toUpperCase();
        if (
          getTypeTag(tagName, false, maxLength) === "OTHER" &&
          !isElementaryType(upper)
        ) {
          const label = getCompositeLabel(ast, v.typeName) ?? "FB";
          emitCompositeToString(lines, fnName, label, v.typeName);
          v.toStringFn = fnName;
        }
      }
    }
  }
}

function emitCompositeToString(
  lines: string[],
  fnName: string,
  label: string,
  typeName: string,
): void {
  lines.push(`static std::string ${fnName}(void* p) {`);
  lines.push(`    (void)p;`);
  lines.push(`    return "<${label}: ${typeName}>";`);
  lines.push("}");
  lines.push("");
}

function emitArrayToString(
  lines: string[],
  fnName: string,
  elementCpp: string,
  elementTag: string,
  dimensions: Array<{ start: number; end: number }>,
): boolean {
  if (dimensions.length === 1) {
    const d = dimensions[0];
    if (!d) return false;
    lines.push(`static std::string ${fnName}(void* p) {`);
    lines.push(
      `    using Arr = strucpp::Array1D<${elementCpp}, ${d.start}LL, ${d.end}LL>;`,
    );
    lines.push(`    auto* arr = static_cast<Arr*>(p);`);
    lines.push(`    std::string s = "(";`);
    lines.push(
      `    for (int64_t i = arr->lower_bound(); i <= arr->upper_bound(); ++i) {`,
    );
    lines.push(`        if (i > arr->lower_bound()) s += ", ";`);
    lines.push(
      `        s += strucpp::element_value_to_string(VarTypeTag::${elementTag}, &arr->operator[](i));`,
    );
    lines.push("    }");
    lines.push(`    s += ")";`);
    lines.push(`    return s;`);
    lines.push("}");
    lines.push("");
    return true;
  } else if (dimensions.length === 2) {
    const d1 = dimensions[0];
    const d2 = dimensions[1];
    if (!d1 || !d2) return false;
    lines.push(`static std::string ${fnName}(void* p) {`);
    lines.push(
      `    using Arr = strucpp::Array2D<${elementCpp}, ${d1.start}LL, ${d1.end}LL, ${d2.start}LL, ${d2.end}LL>;`,
    );
    lines.push(`    auto* arr = static_cast<Arr*>(p);`);
    lines.push(`    std::string s = "(";`);
    lines.push(
      `    for (int64_t i = arr->dim1_lower(); i <= arr->dim1_upper(); ++i) {`,
    );
    lines.push(`        if (i > arr->dim1_lower()) s += "; ";`);
    lines.push(`        s += "(";`);
    lines.push(
      `        for (int64_t j = arr->dim2_lower(); j <= arr->dim2_upper(); ++j) {`,
    );
    lines.push(`            if (j > arr->dim2_lower()) s += ", ";`);
    lines.push(
      `            s += strucpp::element_value_to_string(VarTypeTag::${elementTag}, &arr->operator()(i, j));`,
    );
    lines.push(`        }`);
    lines.push(`        s += ")";`);
    lines.push("    }");
    lines.push(`    s += ")";`);
    lines.push(`    return s;`);
    lines.push("}");
    lines.push("");
    return true;
  } else if (dimensions.length === 3) {
    const d1 = dimensions[0];
    const d2 = dimensions[1];
    const d3 = dimensions[2];
    if (!d1 || !d2 || !d3) return false;
    lines.push(`static std::string ${fnName}(void* p) {`);
    lines.push(
      `    using Arr = strucpp::Array3D<${elementCpp}, ${d1.start}LL, ${d1.end}LL, ${d2.start}LL, ${d2.end}LL, ${d3.start}LL, ${d3.end}LL>;`,
    );
    lines.push(`    auto* arr = static_cast<Arr*>(p);`);
    lines.push(`    std::string s = "(";`);
    lines.push(
      `    for (int64_t i = arr->dim1_lower(); i <= arr->dim1_upper(); ++i) {`,
    );
    lines.push(`        if (i > arr->dim1_lower()) s += "; ";`);
    lines.push(`        s += "(";`);
    lines.push(
      `        for (int64_t j = arr->dim2_lower(); j <= arr->dim2_upper(); ++j) {`,
    );
    lines.push(`            if (j > arr->dim2_lower()) s += "; ";`);
    lines.push(`            s += "(";`);
    lines.push(
      `            for (int64_t k = arr->dim3_lower(); k <= arr->dim3_upper(); ++k) {`,
    );
    lines.push(`                if (k > arr->dim3_lower()) s += ", ";`);
    lines.push(
      `                s += strucpp::element_value_to_string(VarTypeTag::${elementTag}, &arr->operator()(i, j, k));`,
    );
    lines.push(`            }`);
    lines.push(`            s += ")";`);
    lines.push(`        }`);
    lines.push(`        s += ")";`);
    lines.push("    }");
    lines.push(`    s += ")";`);
    lines.push(`    return s;`);
    lines.push("}");
    lines.push("");
    return true;
  }

  return false;
}

/**
 * Emit VarDescriptor arrays for each program.
 */
function emitVarDescriptors(
  lines: string[],
  programs: ProgramInfo[],
  ast: CompilationUnit,
): void {
  for (const prog of programs) {
    if (prog.vars.length > 0) {
      lines.push(`static VarDescriptor ${prog.varsDescName}[] = {`);
      for (const v of prog.vars) {
        const resolved = resolveElementaryType(ast, v.typeName);
        const tagName = resolved?.name ?? v.typeName;
        const maxLength = resolved?.maxLength ?? v.maxLength;
        const tag = getTypeTag(tagName, v.isArray, maxLength);
        const toString = v.toStringFn ?? "nullptr";
        lines.push(
          `    {"${v.name}", VarTypeTag::${tag}, &${prog.instanceExpr}.${v.name}, ${toString}},`,
        );
      }
      lines.push("};");
    } else {
      lines.push(`static VarDescriptor* ${prog.varsDescName} = nullptr;`);
    }
    lines.push("");
  }
}

/**
 * Emit ProgramDescriptor array and main() function.
 */
function emitProgramDescriptorsAndMain(
  lines: string[],
  programs: ProgramInfo[],
): void {
  lines.push(`static ProgramDescriptor programs[] = {`);
  for (const prog of programs) {
    lines.push(
      `    {"${prog.displayName}", &${prog.instanceExpr}, ${prog.varsDescName}, ${prog.vars.length}, ${prog.intervalNs}LL},`,
    );
  }
  lines.push("};");
  lines.push("");

  lines.push("int main(int argc, char* argv[]) {");
  lines.push(
    "    // Bind located variable pointers after all static initialization.",
  );
  lines.push("    __init_global_located_pointers();");
  for (const prog of programs) {
    lines.push(`    ${prog.instanceExpr}.bind_located_vars();`);
  }
  lines.push("    strucpp::__located_vars = locatedVars;");
  lines.push("    strucpp::__located_vars_count = locatedVarsCount;");
  lines.push("");
  lines.push("    bool cyclic = false;");
  lines.push("    bool print_vars = false;");
  lines.push("    for (int i = 1; i < argc; ++i) {");
  lines.push('        if (std::string(argv[i]) == "--cyclic") cyclic = true;');
  lines.push(
    '        if (std::string(argv[i]) == "--print-vars") print_vars = true;',
  );
  lines.push("    }");
  lines.push("");
  lines.push("    if (cyclic) {");
  lines.push(
    `        strucpp::cyclic_run(programs, ${programs.length}, print_vars);`,
  );
  lines.push("    } else {");
  lines.push(
    `        strucpp::repl_run(programs, ${programs.length}, g_st_source, g_cpp_source, g_line_map, g_line_map_count);`,
  );
  lines.push("    }");
  lines.push("    return 0;");
  lines.push("}");
  lines.push("");
}

/**
 * Generate main.cpp for standalone programs (no CONFIGURATION).
 */
function generateStandalone(
  lines: string[],
  ast: CompilationUnit,
  _projectModel: ProjectModel,
): void {
  const programs: ProgramInfo[] = ast.programs.map((prog) => {
    const instanceVar = `prog_${prog.name}`;
    return {
      displayName: prog.name,
      instanceExpr: instanceVar,
      varsDescName: `${instanceVar}_vars`,
      vars: collectVarsFromBlocks(prog.varBlocks, ast),
      intervalNs: 0,
    };
  });

  // Emit static program instances
  for (const prog of ast.programs) {
    lines.push(`static Program_${prog.name} prog_${prog.name};`);
  }
  lines.push("");

  emitToStringFunctions(lines, programs, ast);
  emitVarDescriptors(lines, programs, ast);
  emitProgramDescriptorsAndMain(lines, programs);
}

/**
 * Generate main.cpp with CONFIGURATION (creates configuration instance,
 * extracts program instances from resources/tasks).
 */
function generateWithConfiguration(
  lines: string[],
  ast: CompilationUnit,
  projectModel: ProjectModel,
): void {
  const config = projectModel.configurations[0];
  if (!config) return;

  const configInstanceVar = `config_${config.name}`;

  // Emit configuration instance
  lines.push(`static Configuration_${config.name} ${configInstanceVar};`);
  lines.push("");

  // Collect all program instances from resources/tasks
  const programs: ProgramInfo[] = [];
  for (const resource of config.resources) {
    for (const task of resource.tasks) {
      const intervalNs = task.interval?.nanoseconds ?? 0;
      for (const inst of task.programInstances) {
        const astProg = ast.programs.find(
          (p) => p.name.toUpperCase() === inst.programType.toUpperCase(),
        );
        programs.push({
          displayName: inst.instanceName,
          instanceExpr: `${configInstanceVar}.${inst.instanceName}`,
          varsDescName: `vars_${inst.instanceName}`,
          vars: astProg ? collectVarsFromBlocks(astProg.varBlocks, ast) : [],
          intervalNs,
        });
      }
    }
  }

  emitToStringFunctions(lines, programs, ast);
  emitVarDescriptors(lines, programs, ast);
  emitProgramDescriptorsAndMain(lines, programs);
}
