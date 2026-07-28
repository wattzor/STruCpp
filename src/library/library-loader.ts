// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ Library Loader
 *
 * Loads library manifests and registers their symbols into the symbol tables
 * for cross-library function resolution.
 */

import type {
  LibraryManifest,
  LibraryVarType,
  StlibArchive,
} from "./library-manifest.js";
import type { SymbolTables, VariableSymbol } from "../semantic/symbol-table.js";
import { DuplicateSymbolError } from "../semantic/symbol-table.js";
import type {
  ElementaryType,
  IECType,
  StructType,
  FunctionBlockType,
  EnumType,
  ArrayType,
  ReferenceType,
  TypeReference,
  VarDeclaration,
} from "../frontend/ast.js";
import { createDefaultSourceSpan } from "../frontend/ast.js";
import { ELEMENTARY_TYPES } from "../semantic/type-utils.js";

/**
 * Error thrown when a library manifest fails validation.
 */
export class LibraryManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryManifestError";
  }
}

/** Build a TypeReference AST node from a manifest variable entry. The
 *  reference preserves the metadata downstream consumers (codegen,
 *  debug-table-gen) need to recurse into nested types. */
function makeTypeRef(v: LibraryVarType): TypeReference {
  const ref: TypeReference = {
    kind: "TypeReference",
    sourceSpan: createDefaultSourceSpan(),
    name: v.type,
    isReference:
      v.referenceKind === "pointer_to" || v.referenceKind === "reference_to",
    referenceKind:
      v.referenceKind === "pointer_to"
        ? "pointer_to"
        : v.referenceKind === "reference_to"
          ? "reference_to"
          : "none",
  };
  if (v.arrayDimensions) ref.arrayDimensions = v.arrayDimensions;
  if (v.elementTypeName) ref.elementTypeName = v.elementTypeName;
  return ref;
}

/** Create a VariableSymbol from a library variable entry. The synthesized
 *  VarDeclaration carries the real TypeReference so AST-walking consumers
 *  (debug-table-gen) can recurse uniformly across user-defined and
 *  library-defined function blocks. */
function makeVarSymbol(
  v: LibraryVarType,
  direction: "input" | "output" | "inout",
  resolveType: (v: LibraryVarType) => IECType,
): VariableSymbol {
  const varType = resolveType(v);
  const declaration: VarDeclaration = {
    kind: "VarDeclaration",
    sourceSpan: createDefaultSourceSpan(),
    names: [v.name],
    type: makeTypeRef(v),
  };
  return {
    name: v.name,
    kind: "variable",
    type: varType,
    declaration,
    isInput: direction === "input",
    isOutput: direction === "output",
    isInOut: direction === "inout",
    isExternal: false,
    isGlobal: false,
    isRetain: false,
  };
}

/**
 * Load a library manifest from a JSON object.
 * Validates required fields and structure.
 * (In production, this would read from a .stlib.json file on disk.)
 *
 * @throws {LibraryManifestError} if required fields are missing or invalid
 */
export function loadLibraryManifest(json: unknown): LibraryManifest {
  if (json === null || json === undefined || typeof json !== "object") {
    throw new LibraryManifestError(
      "Invalid library manifest: expected a JSON object",
    );
  }

  const obj = json as Record<string, unknown>;

  // Validate required top-level fields
  const name = obj.name;
  if (typeof name !== "string" || name.length === 0) {
    throw new LibraryManifestError(
      "Invalid library manifest: 'name' must be a non-empty string",
    );
  }
  const version = obj.version;
  if (typeof version !== "string" || version.length === 0) {
    throw new LibraryManifestError(
      "Invalid library manifest: 'version' must be a non-empty string",
    );
  }
  const namespace = obj.namespace;
  if (typeof namespace !== "string" || namespace.length === 0) {
    throw new LibraryManifestError(
      "Invalid library manifest: 'namespace' must be a non-empty string",
    );
  }

  // Validate functions array
  const functions: LibraryManifest["functions"] = [];
  if (Array.isArray(obj.functions)) {
    for (let i = 0; i < obj.functions.length; i++) {
      const fn = obj.functions[i] as Record<string, unknown>;
      if (typeof fn.name !== "string" || fn.name.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: functions[${i}].name must be a non-empty string`,
        );
      }
      if (typeof fn.returnType !== "string" || fn.returnType.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: functions[${i}].returnType must be a non-empty string`,
        );
      }
      if (!Array.isArray(fn.parameters)) {
        throw new LibraryManifestError(
          `Invalid library manifest: functions[${i}].parameters must be an array`,
        );
      }
      functions.push(fn as unknown as LibraryManifest["functions"][0]);
    }
  }

  // Validate function blocks array
  const functionBlocks: LibraryManifest["functionBlocks"] = [];
  if (Array.isArray(obj.functionBlocks)) {
    for (let i = 0; i < obj.functionBlocks.length; i++) {
      const fb = obj.functionBlocks[i] as Record<string, unknown>;
      if (typeof fb.name !== "string" || fb.name.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: functionBlocks[${i}].name must be a non-empty string`,
        );
      }
      if (!Array.isArray(fb.inputs)) {
        throw new LibraryManifestError(
          `Invalid library manifest: functionBlocks[${i}].inputs must be an array`,
        );
      }
      if (!Array.isArray(fb.outputs)) {
        throw new LibraryManifestError(
          `Invalid library manifest: functionBlocks[${i}].outputs must be an array`,
        );
      }
      if (!Array.isArray(fb.inouts)) {
        throw new LibraryManifestError(
          `Invalid library manifest: functionBlocks[${i}].inouts must be an array`,
        );
      }
      functionBlocks.push(
        fb as unknown as LibraryManifest["functionBlocks"][0],
      );
    }
  }

  // Validate types array
  const types: LibraryManifest["types"] = [];
  if (Array.isArray(obj.types)) {
    for (let i = 0; i < obj.types.length; i++) {
      const t = obj.types[i] as Record<string, unknown>;
      if (typeof t.name !== "string" || t.name.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: types[${i}].name must be a non-empty string`,
        );
      }
      if (
        typeof t.kind !== "string" ||
        !["struct", "enum", "alias"].includes(t.kind)
      ) {
        throw new LibraryManifestError(
          `Invalid library manifest: types[${i}].kind must be "struct", "enum", or "alias"`,
        );
      }
      if (t.fields !== undefined && !Array.isArray(t.fields)) {
        throw new LibraryManifestError(
          `Invalid library manifest: types[${i}].fields must be an array`,
        );
      }
      types.push(t as unknown as LibraryManifest["types"][0]);
    }
  }

  // Exported global variables (optional — archives compiled before globals
  // were exported simply omit the field).
  const globals: NonNullable<LibraryManifest["globals"]> = [];
  if (Array.isArray(obj.globals)) {
    for (let i = 0; i < obj.globals.length; i++) {
      const g = obj.globals[i] as Record<string, unknown>;
      if (typeof g.name !== "string" || g.name.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: globals[${i}].name must be a non-empty string`,
        );
      }
      if (typeof g.type !== "string" || g.type.length === 0) {
        throw new LibraryManifestError(
          `Invalid library manifest: globals[${i}].type must be a non-empty string`,
        );
      }
      globals.push(g as unknown as NonNullable<LibraryManifest["globals"]>[0]);
    }
  }

  const result: LibraryManifest = {
    name,
    version,
    namespace,
    functions,
    functionBlocks,
    types,
    headers: Array.isArray(obj.headers) ? (obj.headers as string[]) : [],
    isBuiltin: Boolean(obj.isBuiltin),
  };

  if (Array.isArray(obj.globals)) {
    result.globals = globals;
  }
  if (obj.description !== undefined) {
    result.description = String(obj.description);
  }
  if (Array.isArray(obj.sourceFiles)) {
    result.sourceFiles = obj.sourceFiles as string[];
  }

  return result;
}

/**
 * Register a library's symbols into the compiler's symbol tables.
 * This makes library functions, FBs, and types available for semantic analysis.
 */
export function registerLibrarySymbols(
  manifest: LibraryManifest,
  symbolTables: SymbolTables,
): void {
  // Build a type resolver that can turn manifest type/FB/variable references
  // into real IECType nodes (StructType, FunctionBlockType, ArrayType, ...).
  // This fixes the "library types treated as elementary" defect and lets
  // library functions returning STRUCT/FB, and FBs with struct-typed I/O,
  // participate in type checking and codegen.
  const typeCache = new Map<string, IECType>();
  const fbCache = new Map<string, FunctionBlockType>();

  function fallbackType(name: string): ElementaryType {
    return {
      typeKind: "elementary",
      name,
      sizeBits: 0,
    };
  }

  function resolveTypeName(
    typeName: string,
    seen = new Set<string>(),
  ): IECType {
    const upper = typeName.toUpperCase();
    if (seen.has(upper)) return fallbackType(typeName);

    const cached = typeCache.get(upper) ?? fbCache.get(upper);
    if (cached) return cached;

    const elem = ELEMENTARY_TYPES[upper];
    if (elem) return elem;

    const typeEntry = manifest.types.find(
      (t) => t.name.toUpperCase() === upper,
    );
    if (typeEntry) {
      seen.add(upper);
      try {
        if (typeEntry.kind === "struct" && typeEntry.fields) {
          const fields = new Map<string, IECType>();
          const st: StructType = {
            typeKind: "struct",
            name: typeEntry.name,
            fields,
          };
          typeCache.set(upper, st);
          for (const f of typeEntry.fields) {
            fields.set(f.name.toUpperCase(), resolveTypeName(f.type, seen));
          }
          return st;
        } else if (typeEntry.kind === "enum") {
          const et: EnumType = {
            typeKind: "enum",
            name: typeEntry.name,
            values: typeEntry.baseType ? [typeEntry.baseType] : [],
          };
          typeCache.set(upper, et);
          return et;
        } else {
          // Alias
          const resolved = resolveTypeName(
            typeEntry.baseType ?? typeEntry.name,
            seen,
          );
          typeCache.set(upper, resolved);
          return resolved;
        }
      } finally {
        seen.delete(upper);
      }
    }

    const fbEntry = manifest.functionBlocks.find(
      (fb) => fb.name.toUpperCase() === upper,
    );
    if (fbEntry) {
      const fbType: FunctionBlockType = {
        typeKind: "functionBlock",
        name: fbEntry.name,
        inputVars: new Map(),
        outputVars: new Map(),
        inoutVars: new Map(),
      };
      fbCache.set(upper, fbType);
      for (const i of fbEntry.inputs) {
        fbType.inputVars.set(i.name.toUpperCase(), resolveVarType(i, seen));
      }
      for (const o of fbEntry.outputs) {
        fbType.outputVars.set(o.name.toUpperCase(), resolveVarType(o, seen));
      }
      for (const io of fbEntry.inouts) {
        fbType.inoutVars.set(io.name.toUpperCase(), resolveVarType(io, seen));
      }
      return fbType;
    }

    return fallbackType(typeName);
  }

  function resolveVarType(
    v: LibraryVarType,
    seen = new Set<string>(),
  ): IECType {
    if (
      v.referenceKind === "pointer_to" ||
      v.referenceKind === "reference_to"
    ) {
      const rt: ReferenceType = {
        typeKind: "reference",
        referencedType: resolveTypeName(v.type, seen),
        isImplicitDeref: v.referenceKind === "reference_to",
      };
      return rt;
    }

    if (v.arrayDimensions && v.arrayDimensions.length > 0) {
      const elementTypeName = v.elementTypeName ?? v.type;
      const at: ArrayType = {
        typeKind: "array",
        elementType: resolveTypeName(elementTypeName, seen),
        dimensions: v.arrayDimensions.map((d) => ({
          start: d.start,
          end: d.end,
        })),
      };
      return at;
    }

    return resolveTypeName(v.type, seen);
  }

  // Prime caches with manifest entries so mutually-referencing FBs/structs
  // resolve to a stable object.
  for (const t of manifest.types) {
    resolveTypeName(t.name);
  }
  for (const fb of manifest.functionBlocks) {
    resolveTypeName(fb.name);
  }

  // Register types first so functions/FBs can reference them.
  for (const t of manifest.types) {
    const resolvedType = typeCache.get(t.name.toUpperCase());
    if (!resolvedType) continue; // Should not happen

    try {
      symbolTables.globalScope.define({
        name: t.name,
        kind: "type",
        declaration: {
          kind: "TypeDeclaration",
          sourceSpan: createDefaultSourceSpan(),
          name: t.name,
          definition: {
            kind: "TypeReference",
            sourceSpan: createDefaultSourceSpan(),
            name: t.baseType ?? t.name,
            isReference: false,
            referenceKind: "none",
          },
        },
        resolvedType,
      });
    } catch (e) {
      if (!(e instanceof DuplicateSymbolError)) throw e;
    }
  }

  // Register function blocks.
  for (const fb of manifest.functionBlocks) {
    try {
      symbolTables.globalScope.define({
        name: fb.name,
        kind: "functionBlock",
        declaration: {
          kind: "FunctionBlockDeclaration",
          sourceSpan: createDefaultSourceSpan(),
          name: fb.name,
          isAbstract: false,
          isFinal: false,
          varBlocks: [],
          methods: [],
          properties: [],
          body: [],
        },
        inputs: fb.inputs.map((i) => makeVarSymbol(i, "input", resolveVarType)),
        outputs: fb.outputs.map((o) =>
          makeVarSymbol(o, "output", resolveVarType),
        ),
        inouts: fb.inouts.map((io) =>
          makeVarSymbol(io, "inout", resolveVarType),
        ),
        locals: [],
      });
    } catch (e) {
      if (!(e instanceof DuplicateSymbolError)) throw e;
    }
  }

  // Register functions.
  for (const fn of manifest.functions) {
    const returnType = resolveTypeName(fn.returnType);

    try {
      symbolTables.globalScope.define({
        name: fn.name,
        kind: "function",
        declaration: {
          kind: "FunctionDeclaration",
          sourceSpan: createDefaultSourceSpan(),
          name: fn.name,
          returnType: {
            kind: "TypeReference",
            sourceSpan: createDefaultSourceSpan(),
            name: fn.returnType,
            isReference: false,
            referenceKind: "none",
          },
          varBlocks: [],
          body: [],
        },
        returnType,
        parameters: fn.parameters.map((p) => {
          const sym = makeVarSymbol(
            { name: p.name, type: p.type },
            p.direction,
            resolveVarType,
          );
          if (p.initialValue !== undefined) sym.initialValue = p.initialValue;
          return sym;
        }),
      });
    } catch (e) {
      if (!(e instanceof DuplicateSymbolError)) throw e;
    }
  }

  // Register exported global variables.
  for (const g of manifest.globals ?? []) {
    const varType = resolveTypeName(g.type);
    try {
      symbolTables.globalScope.define({
        name: g.name,
        kind: "variable",
        type: varType,
        declaration: {
          kind: "VarDeclaration",
          sourceSpan: createDefaultSourceSpan(),
          names: [g.name],
          type: {
            kind: "TypeReference",
            sourceSpan: createDefaultSourceSpan(),
            name: g.type,
            isReference: false,
            referenceKind: "none",
          },
        },
        isInput: false,
        isOutput: false,
        isInOut: false,
        isExternal: false,
        isGlobal: true,
        isRetain: false,
      });
    } catch (e) {
      if (!(e instanceof DuplicateSymbolError)) throw e;
    }
  }
}

/**
 * Load a `.stlib` archive from a parsed JSON object.
 * Validates the archive structure including formatVersion, manifest, headerCode,
 * cppCode, and dependencies.
 *
 * @throws {LibraryManifestError} if required fields are missing or invalid
 */
export function loadStlibArchive(json: unknown): StlibArchive {
  if (json === null || json === undefined || typeof json !== "object") {
    throw new LibraryManifestError(
      "Invalid stlib archive: expected a JSON object",
    );
  }

  const obj = json as Record<string, unknown>;

  // Validate formatVersion
  if (obj.formatVersion !== 1) {
    throw new LibraryManifestError(
      "Invalid stlib archive: 'formatVersion' must be 1",
    );
  }

  // Validate manifest
  if (
    obj.manifest === null ||
    obj.manifest === undefined ||
    typeof obj.manifest !== "object"
  ) {
    throw new LibraryManifestError(
      "Invalid stlib archive: 'manifest' must be an object",
    );
  }
  const manifest = loadLibraryManifest(obj.manifest);

  // Validate chunks — every per-symbol slice of the library's emitted
  // C++ output, plus its dep edges. Empty array is valid (synthetic
  // libraries like iec-std-functions ship only symbol-table entries).
  if (!Array.isArray(obj.chunks)) {
    throw new LibraryManifestError(
      "Invalid stlib archive: 'chunks' must be an array",
    );
  }

  // Validate dependencies
  if (!Array.isArray(obj.dependencies)) {
    throw new LibraryManifestError(
      "Invalid stlib archive: 'dependencies' must be an array",
    );
  }

  const archive: StlibArchive = {
    formatVersion: 1,
    manifest,
    chunks: obj.chunks as StlibArchive["chunks"],
    dependencies: obj.dependencies as Array<{ name: string; version: string }>,
  };

  // Optional sources
  if (Array.isArray(obj.sources)) {
    archive.sources = obj.sources as Array<{
      fileName: string;
      source: string;
    }>;
  }

  // Optional globalConstants
  if (
    obj.globalConstants !== null &&
    obj.globalConstants !== undefined &&
    typeof obj.globalConstants === "object" &&
    !Array.isArray(obj.globalConstants)
  ) {
    const gc: Record<string, number> = {};
    for (const [key, val] of Object.entries(
      obj.globalConstants as Record<string, unknown>,
    )) {
      if (typeof val !== "number") {
        throw new LibraryManifestError(
          `Invalid stlib archive: globalConstants["${key}"] must be a number, got ${typeof val}`,
        );
      }
      gc[key] = val;
    }
    archive.globalConstants = gc;
  }

  return archive;
}

/**
 * Parse and validate an stlib archive from its raw JSON text.
 *
 * Browser-safe sibling of `loadStlibFromFile` — takes a string the
 * caller already obtained (HTTP fetch, IPC, FileReader, etc.) instead
 * of touching the filesystem.  Use this in environments without `fs`.
 *
 * @param raw - JSON text of the `.stlib` archive
 * @param sourceLabel - Optional label used in error messages
 * @returns The validated archive
 * @throws {LibraryManifestError} if the JSON is malformed or invalid
 */
export function loadStlibFromString(
  raw: string,
  sourceLabel: string = "<string>",
): StlibArchive {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new LibraryManifestError(
      `Invalid JSON in stlib archive: ${sourceLabel}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  return loadStlibArchive(json);
}

/**
 * Parse and validate an stlib archive from raw bytes.
 *
 * Browser-safe sibling of `loadStlibFromFile` — accepts the byte
 * payload of an `.stlib` (UTF-8 encoded JSON).  Suitable for
 * `fetch(...).then(r => r.arrayBuffer())` flows and for Electron
 * preload paths that hand the renderer a `Uint8Array` over IPC.
 *
 * @param bytes - Raw UTF-8 bytes of the `.stlib` archive
 * @param sourceLabel - Optional label used in error messages
 * @returns The validated archive
 * @throws {LibraryManifestError} if the JSON is malformed or invalid
 */
export function loadStlibFromBuffer(
  bytes: Uint8Array,
  sourceLabel: string = "<buffer>",
): StlibArchive {
  // TextDecoder is available in modern Node (≥11) and every browser /
  // worker context we care about.  Avoids pulling in `Buffer` so the
  // browser bundler doesn't have to polyfill it.
  const raw = new TextDecoder("utf-8").decode(bytes);
  return loadStlibFromString(raw, sourceLabel);
}

// File-shaped wrappers (`loadStlibFromFile`, `discoverStlibs`,
// `loadLibraryFromFile`, `discoverLibraries`) live in
// `src/node/library-loader.ts`.  Browser / worker consumers fetch
// bytes themselves and call the pure `loadStlibFromString` /
// `loadStlibFromBuffer` / `loadStlibArchive` / `loadLibraryManifest`
// helpers above.
