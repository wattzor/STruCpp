// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
/**
 * STruC++ Type Checker
 *
 * Performs type checking and type inference on the AST.
 * Validates IEC 61131-3 type rules and resolves types for expressions.
 *
 * Sub-Phase B: Walks all POUs and resolves every expression's type (sets resolvedType on AST nodes).
 * Sub-Phase C: Validates type rules (assignment compatibility, conditions, FOR vars, function args).
 */

import type {
  Expression,
  BinaryExpression,
  UnaryExpression,
  LiteralExpression,
  VariableExpression,
  FunctionCallExpression,
  MethodCallExpression,
  Argument,
  IECType,
  ElementaryType,
  ReferenceType,
  StructType,
  CompilationUnit,
  Statement,
  VarBlock,
  MethodDeclaration,
} from "../frontend/ast.js";
import type { SymbolTables, Scope, FunctionSymbol } from "./symbol-table.js";
import type {
  StdFunctionRegistry,
  StdFunctionDescriptor,
} from "./std-function-registry.js";
import type { CompileError } from "../types.js";
import {
  ELEMENTARY_TYPES,
  isTypeInCategory as _isTypeInCategory,
  isAssignable as _isAssignable,
  isNarrowingConversion,
  matchesConstraint,
  getCommonType,
  resolveFieldType,
  resolveArrayElementType,
  typeName as typeNameUtil,
  isGenericGroupType,
  isGenericTypeName,
  shouldHarmonizeStdFuncArgs,
  getHarmonizableRange,
  isBareLiteral,
  resolveHarmonizedCommonType,
  resolveSelectionCommonType,
  stdFuncReturnsCommonType,
  getTypeNumericRange,
  parseIntegerLiteral,
  isCompositeDefinition,
} from "./type-utils.js";
import {
  getSystemType,
  isSystemNamespaceName,
  isSystemTypeReference,
  resolveSystemAccess,
} from "./system-types.js";
import { stripEnEno } from "../ast-utils.js";
import { IEC_INTEGER_MAX, IEC_INTEGER_MIN } from "../literal-utils.js";

// Re-export from type-utils for backward compatibility
export { ELEMENTARY_TYPES, TYPE_CATEGORIES } from "./type-utils.js";
export type { TypeCategory } from "./type-utils.js";

// =============================================================================
// IEC 61131-3 date/time arithmetic helpers
// =============================================================================

/** True when the operand type is one of the absolute-time types. */
function isInstantType(t: IECType): boolean {
  if (t.typeKind !== "elementary") return false;
  const name = (t as ElementaryType).name;
  return name === "DT" || name === "DATE" || name === "TOD";
}

/** True when the operand type is the duration type (TIME). */
function isDurationType(t: IECType): boolean {
  if (t.typeKind !== "elementary") return false;
  return (t as ElementaryType).name === "TIME";
}

/** True when the operand pair maps to a recognised date/time arithmetic
 *  rule from IEC 61131-3 §6.6.2.2 — instant minus instant, or instant
 *  ± duration. Anything else (DT * 2, TIME / DT, …) falls through to
 *  the normal arithmetic path so we don't widen the rule beyond what
 *  the standard sanctions. */
function isDateTimeArithmetic(
  left: IECType,
  right: IECType,
  op: string,
): boolean {
  const leftIsInstant = isInstantType(left);
  const rightIsInstant = isInstantType(right);
  const leftIsTime = isDurationType(left);
  const rightIsTime = isDurationType(right);

  // instant - instant → TIME (duration). Both must be the same instant
  // type per the standard (DT - TOD is meaningless).
  if (op === "-" && leftIsInstant && rightIsInstant) {
    return (left as ElementaryType).name === (right as ElementaryType).name;
  }
  // instant ± duration → instant (offset)
  if (leftIsInstant && rightIsTime) return true;
  // duration + instant → instant (commutative addition only)
  if (op === "+" && leftIsTime && rightIsInstant) return true;
  return false;
}

/** Resolves the result type for a recognised date/time arithmetic pair.
 *  Pre-condition: isDateTimeArithmetic returned true for the same args. */
function resolveDateTimeArithmetic(
  left: IECType,
  right: IECType,
  op: string,
): IECType | undefined {
  const leftIsInstant = isInstantType(left);
  const rightIsInstant = isInstantType(right);

  if (op === "-" && leftIsInstant && rightIsInstant) {
    return ELEMENTARY_TYPES["TIME"];
  }
  // instant ± duration: result keeps the instant type.
  if (leftIsInstant) return left;
  // duration + instant (commutative): result is the instant type.
  if (rightIsInstant) return right;
  return undefined;
}

// =============================================================================
// Type Checker
// =============================================================================

/**
 * Type checker for IEC 61131-3 programs.
 */
export class TypeChecker {
  private errors: CompileError[] = [];
  private warnings: CompileError[] = [];
  private ast: CompilationUnit | undefined;

  constructor(
    private symbolTables: SymbolTables,
    private stdRegistry?: StdFunctionRegistry,
  ) {}

  /**
   * Check types for a complete compilation unit.
   * Walks all POUs, resolves expression types, and validates type rules.
   */
  check(ast: CompilationUnit): {
    errors: CompileError[];
    warnings: CompileError[];
  } {
    this.errors = [];
    this.warnings = [];
    this.ast = ast;

    // Walk all programs
    for (const prog of ast.programs) {
      const scope = this.symbolTables.getProgramScope(prog.name);
      if (scope) {
        this.checkVarBlocks(prog.varBlocks, scope);
        this.checkStatements(prog.body, scope);
      }
    }

    // Walk all functions
    for (const func of ast.functions) {
      const scope = this.symbolTables.getFunctionScope(func.name);
      if (scope) {
        this.checkVarBlocks(func.varBlocks, scope);
        this.checkStatements(func.body, scope);
      }
    }

    // Walk all function blocks
    for (const fb of ast.functionBlocks) {
      const scope = this.symbolTables.getFBScope(fb.name);
      if (scope) {
        // FB body
        this.checkVarBlocks(fb.varBlocks, scope);
        this.checkStatements(fb.body, scope);

        // Method bodies (use method scope for local variable resolution)
        for (const method of fb.methods) {
          const methodScope = this.symbolTables.getMethodScope(
            fb.name,
            method.name,
          );
          this.checkVarBlocks(method.varBlocks, methodScope ?? scope);
          this.checkStatements(method.body, methodScope ?? scope);
          this.checkReferenceReturnBound(method);
        }

        // Property getter/setter bodies
        for (const prop of fb.properties) {
          if (prop.getter) {
            const getterScope = this.symbolTables.getPropertyScope(
              fb.name,
              prop.name,
              "getter",
            );
            this.checkVarBlocks(
              prop.getterVarBlocks ?? [],
              getterScope ?? scope,
            );
            this.checkStatements(prop.getter, getterScope ?? scope);
          }
          if (prop.setter) {
            const setterScope = this.symbolTables.getPropertyScope(
              fb.name,
              prop.name,
              "setter",
            );
            this.checkVarBlocks(
              prop.setterVarBlocks ?? [],
              setterScope ?? scope,
            );
            this.checkStatements(prop.setter, setterScope ?? scope);
          }
        }
      }
    }

    return {
      errors: this.errors,
      warnings: this.warnings,
    };
  }

  /**
   * Warn when a method returning REFERENCE TO a user-defined type has no
   * `MethodName ref= ...` assignment. A missing bind leaves the reference
   * null; codegen now guards the dereference at runtime, but the user should
   * still be told the bind is missing.
   */
  private checkReferenceReturnBound(method: MethodDeclaration): void {
    if (!method.returnType) return;
    const ref = method.returnType;
    if (ref.referenceKind !== "reference_to") return;
    if (ELEMENTARY_TYPES[ref.name.toUpperCase()]) return;

    const methodNameUpper = method.name.toUpperCase();
    if (!this.statementContainsRefAssign(method.body, methodNameUpper)) {
      this.addWarning(
        `Method '${method.name}' returns REFERENCE TO '${ref.name}' but no '${method.name} ref= ...' assignment was found; the returned reference may be null`,
        method.sourceSpan.startLine,
        method.sourceSpan.startCol,
        method.sourceSpan.file,
      );
    }
  }

  /** Recursively search for a RefAssignStatement that assigns the method result. */
  private statementContainsRefAssign(
    stmts: Statement[],
    methodNameUpper: string,
  ): boolean {
    for (const stmt of stmts) {
      if (this.refAssignsMethod(stmt, methodNameUpper)) return true;
      if (stmt.kind === "IfStatement") {
        if (
          this.statementContainsRefAssign(stmt.thenStatements, methodNameUpper)
        )
          return true;
        for (const clause of stmt.elsifClauses) {
          if (
            this.statementContainsRefAssign(clause.statements, methodNameUpper)
          )
            return true;
        }
        if (
          stmt.elseStatements &&
          this.statementContainsRefAssign(stmt.elseStatements, methodNameUpper)
        )
          return true;
      }
      if (
        (stmt.kind === "WhileStatement" ||
          stmt.kind === "RepeatStatement" ||
          stmt.kind === "ForStatement") &&
        this.statementContainsRefAssign(stmt.body, methodNameUpper)
      )
        return true;
      if (
        stmt.kind === "CaseStatement" &&
        stmt.cases.some((c) =>
          this.statementContainsRefAssign(c.statements, methodNameUpper),
        )
      )
        return true;
    }
    return false;
  }

  private refAssignsMethod(stmt: Statement, methodNameUpper: string): boolean {
    if (stmt.kind !== "RefAssignStatement") return false;
    const target = stmt.target;
    return (
      target.kind === "VariableExpression" &&
      target.name.toUpperCase() === methodNameUpper &&
      !target.isDereference &&
      target.subscripts.length === 0 &&
      target.fieldAccess.length === 0 &&
      (target.accessChain?.length ?? 0) === 0
    );
  }

  // ===========================================================================
  // Expression Type Resolution (Sub-Phase B)
  // ===========================================================================

  /**
   * Resolve the type of an expression, setting resolvedType on the AST node.
   * Public so codegen can call it for standalone expressions.
   */
  resolveExprType(expr: Expression, scope: Scope): IECType | undefined {
    const type = this.inferType(expr, scope);
    if (type) {
      expr.resolvedType = type;
    }
    return type;
  }

  /**
   * Resolve a struct/FB/program field's declared type name, consulting the local
   * compilation unit first and then the dependency libraries' symbol entries.
   *
   * The members of an FB whose type is defined in an imported `.stlib` (e.g.
   * `rmp : _RMP_NEXT` where `_RMP_NEXT` lives in oscat-basic) are not in the local
   * AST, so the AST-only `resolveFieldType` returns undefined for `rmp.DN`. That
   * left the member access untyped, which only surfaced as a hard error when an
   * overloaded bitwise std-function (e.g. `NOT`/`OR` from the IEC functions library)
   * propagated the missing type as the generic `ANY_BIT` into a condition. Falling
   * back to the FB symbol's registered inputs/outputs/inouts/locals fixes the root
   * cause: `rmp.DN` now resolves to its real `BOOL` type.
   */
  private resolveFieldTypeAnywhere(
    typeName: string,
    fieldName: string,
  ): string | undefined {
    if (this.ast) {
      const local = resolveFieldType(typeName, fieldName, this.ast);
      if (local) return local;
    }
    const fb = this.symbolTables.lookupFunctionBlock(typeName);
    if (fb) {
      const fu = fieldName.toUpperCase();
      for (const m of [
        ...fb.inputs,
        ...fb.outputs,
        ...fb.inouts,
        ...fb.locals,
      ]) {
        if (m.name.toUpperCase() === fu) return m.declaration?.type?.name;
      }
    }
    // Dependency struct types: their member types are carried on the registered
    // StructType (e.g. CONSTANTS_MATH.PI), so `MATH.PI` resolves to REAL.
    const ty = this.symbolTables.lookupType(typeName);
    if (ty?.resolvedType?.typeKind === "struct") {
      const fu = fieldName.toUpperCase();
      for (const [fname, ftype] of (ty.resolvedType as StructType).fields) {
        if (fname.toUpperCase() === fu) {
          return (ftype as { name?: string }).name;
        }
      }
    }
    // CODESYS __SYSTEM.VAR_INFO synthetic struct
    const systemType = getSystemType(typeName);
    if (systemType?.typeKind === "struct") {
      const fu = fieldName.toUpperCase();
      for (const [fname, ftype] of (systemType as StructType).fields) {
        if (fname.toUpperCase() === fu) {
          return typeNameUtil(ftype);
        }
      }
    }
    return undefined;
  }

  /**
   * Resolve a type *name* to its IECType: an elementary type, else a registered
   * type (struct/FB/enum from the local AST or a dependency library), else a
   * minimal elementary placeholder. Using the registered type (rather than always
   * wrapping the name in a placeholder elementary) keeps member/array-element
   * access consistent with how a variable's declared type resolves — otherwise
   * `event := prog[pos]` where both are a library struct would compare a real
   * StructType against a placeholder elementary and be wrongly rejected.
   */
  private resolveNamedType(name: string): IECType {
    if (isSystemTypeReference(name)) {
      const systemType = getSystemType(name);
      if (systemType) return systemType;
    }

    return (
      ELEMENTARY_TYPES[name.toUpperCase()] ??
      this.symbolTables.lookupType(name)?.resolvedType ??
      ({ typeKind: "elementary", name, sizeBits: 0 } as ElementaryType)
    );
  }

  /**
   * Infer the type of an expression.
   */
  inferType(expr: Expression, scope: Scope): IECType | undefined {
    switch (expr.kind) {
      case "LiteralExpression":
        return this.inferLiteralType(expr);
      case "VariableExpression":
        return this.inferVariableType(expr, scope);
      case "BinaryExpression":
        return this.inferBinaryType(expr, scope);
      case "UnaryExpression":
        return this.inferUnaryType(expr, scope);
      case "FunctionCallExpression":
        return this.inferFunctionCallType(expr, scope);
      case "MethodCallExpression":
        return this.inferMethodCallType(expr, scope);
      case "ParenthesizedExpression": {
        const inner = this.inferType(expr.expression, scope);
        if (inner) expr.resolvedType = inner;
        return inner;
      }
      case "RefExpression": {
        const operandType = this.resolveExprType(expr.operand, scope);
        if (operandType) {
          const refType: ReferenceType = {
            typeKind: "reference",
            referencedType: operandType,
            isImplicitDeref: false,
          };
          expr.resolvedType = refType;
          return refType;
        }
        return undefined;
      }
      case "DrefExpression": {
        const operandType = this.resolveExprType(expr.operand, scope);
        if (operandType?.typeKind === "reference") {
          const derefType = (operandType as ReferenceType).referencedType;
          expr.resolvedType = derefType;
          return derefType;
        }
        return undefined;
      }
      case "NewExpression": {
        const allocType =
          ELEMENTARY_TYPES[expr.allocationType.name.toUpperCase()];
        if (allocType) {
          const refType: ReferenceType = {
            typeKind: "reference",
            referencedType: allocType,
            isImplicitDeref: false,
          };
          expr.resolvedType = refType;
          return refType;
        }
        return undefined;
      }
      case "ArrayLiteralExpression": {
        // Array literals don't have an inherent type — they get their type from the assignment target
        return undefined;
      }
      case "QueryInterfaceExpression": {
        // __QUERYINTERFACE returns a BOOL and mutates its target argument
        const boolType = ELEMENTARY_TYPES["BOOL"];
        if (!boolType) return undefined;
        expr.resolvedType = boolType;
        return boolType;
      }
      case "VarInfoExpression": {
        // Resolve the target variable's type so codegen can emit size/type-class metadata.
        this.inferType(expr.argument, scope);
        const varInfoType = getSystemType("__SYSTEM.VAR_INFO");
        if (varInfoType) {
          expr.resolvedType = varInfoType;
        }
        return varInfoType;
      }
      default:
        return undefined;
    }
  }

  /**
   * Infer type of a literal expression.
   */
  private inferLiteralType(expr: LiteralExpression): IECType | undefined {
    if (expr.typePrefix) {
      const prefixType = ELEMENTARY_TYPES[expr.typePrefix.toUpperCase()];
      if (prefixType) {
        expr.resolvedType = prefixType;
        this.checkTypedLiteralRange(expr, prefixType.name);
        return prefixType;
      }
    }
    let type: IECType | undefined;
    switch (expr.literalType) {
      case "BOOL":
        type = ELEMENTARY_TYPES["BOOL"];
        break;
      case "INT":
        type = ELEMENTARY_TYPES["INT"];
        break;
      case "REAL":
        type = ELEMENTARY_TYPES["REAL"];
        break;
      case "STRING":
        type = ELEMENTARY_TYPES["STRING"];
        break;
      case "WSTRING":
        type = ELEMENTARY_TYPES["WSTRING"];
        break;
      case "TIME":
        type = ELEMENTARY_TYPES["TIME"];
        break;
      case "DATE":
        type = ELEMENTARY_TYPES["DATE"];
        break;
      case "TIME_OF_DAY":
        type = ELEMENTARY_TYPES["TIME_OF_DAY"];
        break;
      case "DATE_AND_TIME":
        type = ELEMENTARY_TYPES["DATE_AND_TIME"];
        break;
      case "LTIME":
        type = ELEMENTARY_TYPES["LTIME"];
        break;
      case "LDATE":
        type = ELEMENTARY_TYPES["LDATE"];
        break;
      case "LTOD":
        type = ELEMENTARY_TYPES["LTOD"];
        break;
      case "LDT":
        type = ELEMENTARY_TYPES["LDT"];
        break;
      case "NULL":
        return undefined;
      default:
        return undefined;
    }
    if (type) expr.resolvedType = type;
    return type;
  }

  /**
   * Infer type of a variable expression, including access chain resolution.
   */
  private inferVariableType(
    expr: VariableExpression,
    scope: Scope,
  ): IECType | undefined {
    // CODESYS __SYSTEM qualified enum access: __SYSTEM.TYPE_CLASS.TYPE_BOOL
    if (isSystemNamespaceName(expr.name)) {
      const path =
        expr.accessChain?.length === 2 &&
        expr.accessChain.every((s) => s.kind === "field")
          ? expr.accessChain.map((s) => s.name)
          : expr.fieldAccess.length === 2
            ? expr.fieldAccess
            : undefined;
      if (path) {
        const resolved = resolveSystemAccess(path);
        if (resolved) {
          return resolved.enumType;
        }
      }
      return undefined;
    }

    const symbol = scope.lookup(expr.name);
    if (symbol === undefined) {
      // Don't report error here — Pass 3 undeclared-variable check handles this
      return undefined;
    }

    if (symbol.kind !== "variable" && symbol.kind !== "constant") {
      return undefined;
    }

    let currentType: IECType | undefined = symbol.type;
    let currentTypeName: string | undefined;

    if (currentType?.typeKind === "elementary") {
      currentTypeName = (currentType as ElementaryType).name;
    } else if (currentType) {
      // For non-elementary types, use the declaration type name
      currentTypeName = symbol.declaration?.type?.name;
    }

    // Resolve access chain (accessChain is the preferred path)
    if (expr.accessChain && expr.accessChain.length > 0 && this.ast) {
      for (const step of expr.accessChain) {
        if (!currentTypeName) break;

        if (step.kind === "field") {
          // Resolve struct/FB field (local AST + dependency-library FB members)
          const fieldType = this.resolveFieldTypeAnywhere(
            currentTypeName,
            step.name,
          );
          if (fieldType) {
            currentTypeName = fieldType;
            currentType = this.resolveNamedType(fieldType);
          } else {
            // Check if it's a numeric bit access (e.g., var.0)
            if (/^\d+$/.test(step.name)) {
              currentType = ELEMENTARY_TYPES["BOOL"];
              currentTypeName = "BOOL";
            } else {
              currentType = undefined;
              currentTypeName = undefined;
            }
          }
        } else if (step.kind === "subscript") {
          // Resolve array element type
          const elemType = resolveArrayElementType(currentTypeName, this.ast);
          if (elemType) {
            currentTypeName = elemType;
            currentType = this.resolveNamedType(elemType);
          } else {
            currentType = undefined;
            currentTypeName = undefined;
          }
          // Also resolve the index expressions
          for (const idx of step.indices) {
            this.resolveExprType(idx, scope);
          }
        } else if (step.kind === "dereference") {
          if (currentType?.typeKind === "reference") {
            currentType = (currentType as ReferenceType).referencedType;
            if (currentType.typeKind === "elementary") {
              currentTypeName = (currentType as ElementaryType).name;
            }
          } else {
            currentType = undefined;
            currentTypeName = undefined;
          }
        }
      }
    } else if (this.ast) {
      // Fallback: use legacy fieldAccess + subscripts
      // Resolve subscripts (array indexing on the base variable)
      if (expr.subscripts.length > 0 && currentTypeName) {
        for (const sub of expr.subscripts) {
          this.resolveExprType(sub, scope);
        }
        const elemType = resolveArrayElementType(currentTypeName, this.ast);
        if (elemType) {
          currentTypeName = elemType;
          currentType = this.resolveNamedType(elemType);
        }
      }

      // Resolve field access chain
      if (expr.fieldAccess.length > 0 && currentTypeName) {
        for (const field of expr.fieldAccess) {
          if (!currentTypeName) break;

          if (/^\d+$/.test(field)) {
            // Bit access
            currentType = ELEMENTARY_TYPES["BOOL"];
            currentTypeName = "BOOL";
          } else {
            const fieldType = this.resolveFieldTypeAnywhere(
              currentTypeName,
              field,
            );
            if (fieldType) {
              currentTypeName = fieldType;
              currentType = this.resolveNamedType(fieldType);
            } else {
              currentType = undefined;
              currentTypeName = undefined;
            }
          }
        }
      }

      // Handle dereference
      if (expr.isDereference && currentType?.typeKind === "reference") {
        currentType = (currentType as ReferenceType).referencedType;
      }
    }

    if (currentType) {
      expr.resolvedType = currentType;
    }
    return currentType;
  }

  /**
   * Infer type of a binary expression.
   */
  private inferBinaryType(
    expr: BinaryExpression,
    scope: Scope,
  ): IECType | undefined {
    const leftType = this.resolveExprType(expr.left, scope);
    const rightType = this.resolveExprType(expr.right, scope);

    if (leftType === undefined || rightType === undefined) {
      return undefined;
    }

    let type: IECType | undefined;

    // Comparison operators always return BOOL
    if (["=", "<>", "<", ">", "<=", ">="].includes(expr.operator)) {
      type = ELEMENTARY_TYPES["BOOL"];
    }
    // Logical operators return BOOL
    else if (
      ["AND", "AND_THEN", "OR", "OR_ELSE", "XOR"].includes(expr.operator)
    ) {
      type = ELEMENTARY_TYPES["BOOL"];
    }
    // IEC 61131-3 date/time arithmetic (table 30 of the standard).
    // Date types are int64_t aliases at the C++ level so the operator-
    // overload returns IECVar<int64_t>, but the *semantic* result type
    // depends on the operands:
    //   DT/DATE/TOD - DT/DATE/TOD = TIME   (duration between two instants)
    //   DT/DATE/TOD ± TIME       = DT/DATE/TOD (instant offset)
    // Without these rules the type checker collapses DT - DT to DT,
    // which then refuses assignment to a TIME variable (the natural use
    // of the difference). This breaks RTC-style code that captures an
    // offset between two datetimes — including the Additional Function
    // Blocks library's RTC FB and any user code doing date arithmetic.
    else if (
      ["+", "-"].includes(expr.operator) &&
      isDateTimeArithmetic(leftType, rightType, expr.operator)
    ) {
      type = resolveDateTimeArithmetic(leftType, rightType, expr.operator);
    }
    // Arithmetic operators return the "wider" type
    else if (["+", "-", "*", "/", "MOD", "**"].includes(expr.operator)) {
      type = getCommonType(leftType, rightType) ?? leftType;
    } else {
      type = leftType;
    }

    if (type) expr.resolvedType = type;
    return type;
  }

  /**
   * Infer type of a unary expression.
   */
  private inferUnaryType(
    expr: UnaryExpression,
    scope: Scope,
  ): IECType | undefined {
    const operandType = this.resolveExprType(expr.operand, scope);

    if (operandType === undefined) {
      return undefined;
    }

    let type: IECType | undefined;
    if (expr.operator === "NOT") {
      // NOT is a bitwise operator on ANY_BIT operands. CODESYS only permits
      // BOOL, BYTE, WORD, DWORD, and LWORD (NOT on signed integers is not
      // defined and produces logical ! in codegen, which is incorrect).
      if (!_isTypeInCategory(operandType, "ANY_BIT")) {
        this.addError(
          `Operator 'NOT' requires an ANY_BIT operand, got ${typeNameUtil(operandType)}`,
          expr.sourceSpan.startLine,
          expr.sourceSpan.startCol,
          expr.sourceSpan.file,
        );
      }
      type = operandType;
    } else {
      // Unary + and - preserve the operand type
      type = operandType;
    }

    if (type) expr.resolvedType = type;
    return type;
  }

  /**
   * Infer type of a function call expression.
   */
  private inferFunctionCallType(
    expr: FunctionCallExpression,
    scope: Scope,
  ): IECType | undefined {
    // Resolve argument expressions
    for (const arg of expr.arguments) {
      this.resolveExprType(arg.value, scope);
    }

    const nameUpper = expr.functionName.toUpperCase();

    // Check user-defined functions in symbol tables
    const funcSymbol = this.symbolTables.lookupFunction(expr.functionName);
    if (funcSymbol !== undefined) {
      this.validateUserFunctionGenericArgs(expr, funcSymbol);
      // Library-instantiated standard functions still need the standard-function
      // argument checks (e.g., LIMIT loaded from iec-std-functions.stlib must not
      // receive a generic ANY/ANY_* actual argument).
      this.validateFunctionCallArgs(expr, scope);
      let returnType = funcSymbol.returnType;
      // Overloaded standard functions are published in the builtin stdlib
      // manifest with their generic return *constraint* (e.g. NOT -> ANY_BIT,
      // ADD -> ANY_NUM). When the IEC signature says the result type matches
      // the first argument, refine that generic to the concrete operand type
      // so downstream checks see a real type — e.g. NOT(BOOL) -> BOOL, which
      // the EN-input check (and bit/num operand rules) require.
      if (returnType && isGenericGroupType(returnType) && this.stdRegistry) {
        const desc = this.stdRegistry.lookup(nameUpper);
        if (
          desc &&
          (desc.returnMatchesFirstParam || stdFuncReturnsCommonType(desc))
        ) {
          const userArgs = stripEnEno(expr.arguments);
          const commonType = this.resolveCommonStdReturnType(desc, userArgs);
          if (commonType) returnType = commonType;
        }
      }
      expr.resolvedType = returnType;
      return returnType;
    }

    // Validate standard function argument types (after resolving args)
    this.validateFunctionCallArgs(expr, scope);

    // Check standard function registry for return type
    if (this.stdRegistry) {
      // Check conversion functions (e.g., INT_TO_REAL → REAL)
      const conv = this.stdRegistry.resolveConversion(nameUpper);
      if (conv) {
        const retType = ELEMENTARY_TYPES[conv.toType.toUpperCase()];
        if (retType) {
          expr.resolvedType = retType;
          return retType;
        }
      }

      // Check standard functions
      const desc = this.stdRegistry.lookup(nameUpper);
      if (desc) {
        // Specific return type
        if (desc.specificReturnType) {
          const retType =
            ELEMENTARY_TYPES[desc.specificReturnType.toUpperCase()];
          if (retType) {
            expr.resolvedType = retType;
            return retType;
          }
        }
        // Return matches the common type across value arguments.  For
        // harmonized template functions (ADD, AND, MUX, ...) this is the
        // widened common type, not just the first argument.  The same applies
        // to selection functions (MUX, SEL, LIMIT) whose runtime overloads
        // return a common wide type.
        if (desc.returnMatchesFirstParam || stdFuncReturnsCommonType(desc)) {
          const userArgs = stripEnEno(expr.arguments);
          const commonType = this.resolveCommonStdReturnType(desc, userArgs);
          if (commonType) {
            expr.resolvedType = commonType;
            return commonType;
          }
        }
      }
    }

    // Could be a function block invocation (treated as statement, no return)
    const fbInstance = scope.lookup(expr.functionName);
    if (fbInstance?.kind === "variable") {
      return undefined;
    }

    // Check if it's a standard function even without the registry
    // (the function might be known via the symbol table from library loading)
    const globalSymbol = this.symbolTables.globalScope.lookup(
      expr.functionName,
    );
    if (globalSymbol?.kind === "functionBlock") {
      return undefined; // FB invocation, no direct return type
    }

    // Unknown function — don't error here, the undeclared-variable pass handles this
    return undefined;
  }

  /**
   * Resolve the concrete return type for a generic standard function whose
   * result is defined by its value arguments.  For harmonized template
   * functions (ADD, AND, MUX, ...) this is the widened common type, not just
   * the first argument.  For selection functions (MUX, SEL, LIMIT, MIN, MAX)
   * the common type is also used because the runtime's mixed-type overloads
   * return a wide enough result.  Falls back to the first *value* argument only
   * for returnMatchesFirstParam functions that are not common-return functions.
   */
  private resolveCommonStdReturnType(
    desc: StdFunctionDescriptor,
    userArgs: Argument[],
  ): IECType | undefined {
    if (userArgs.length === 0) return undefined;

    const harmonizable = shouldHarmonizeStdFuncArgs(desc, userArgs.length);
    const hasCommonReturn = harmonizable || stdFuncReturnsCommonType(desc);

    // For functions whose return is the common type of multiple value arguments
    // (ADD, AND, MUX, SEL, LIMIT, MIN, MAX, ...) compute the widened common IEC type.
    if (hasCommonReturn && userArgs.length > 0) {
      const range = getHarmonizableRange(desc, userArgs.length);
      if (range) {
        const argTypeNames: (string | undefined)[] = userArgs.map((a) =>
          a.value.resolvedType
            ? typeNameUtil(a.value.resolvedType).toUpperCase()
            : undefined,
        );
        const isBare = userArgs.map((a) => isBareLiteral(a.value));

        // Selection functions (MIN/MAX/LIMIT/SEL/MUX) can fall back to the
        // unsigned common type when no signed type can hold every value,
        // matching the runtime's `iec_minmax_result_t`.  Arithmetic functions
        // stop here so the cast emitter reports the error instead.
        const commonName = stdFuncReturnsCommonType(desc)
          ? resolveSelectionCommonType(
              argTypeNames,
              isBare,
              range.start,
              range.end,
            )
          : resolveHarmonizedCommonType(
              argTypeNames,
              isBare,
              range.start,
              range.end,
            );
        if (commonName) {
          const ret =
            ELEMENTARY_TYPES[commonName] ??
            (isGenericTypeName(commonName)
              ? ({
                  typeKind: "elementary",
                  name: commonName,
                  sizeBits: 0,
                } as ElementaryType)
              : undefined);
          if (ret) return ret;
        }
      }
    }

    // For functions whose result matches the first value argument (NOT, ABS,
    // NEG, etc.) fall back to that argument's resolved type when no common IEC
    // type is chosen.  This also covers unary NOT, where harmonisation does not
    // apply.
    if (
      desc.returnMatchesFirstParam &&
      !stdFuncReturnsCommonType(desc) &&
      userArgs.length > 0
    ) {
      const firstValueArg = userArgs[0]!;
      if (firstValueArg.value.resolvedType) {
        return firstValueArg.value.resolvedType;
      }
    }

    return undefined;
  }

  /**
   * Infer type of a method call expression (e.g., fb.method(args)).
   */
  private inferMethodCallType(
    expr: MethodCallExpression,
    scope: Scope,
  ): IECType | undefined {
    // Resolve the object expression
    const objType = this.resolveExprType(expr.object, scope);

    // Resolve argument expressions
    for (const arg of expr.arguments) {
      this.resolveExprType(arg.value, scope);
    }

    if (!objType || !this.ast) return undefined;

    // Get the type name for the object
    let objTypeName: string | undefined;
    if (objType.typeKind === "elementary") {
      objTypeName = (objType as ElementaryType).name;
    } else if (expr.object.kind === "VariableExpression") {
      const sym = scope.lookup(expr.object.name);
      if (sym?.kind === "variable") {
        objTypeName = sym.declaration?.type?.name;
      }
    }

    if (!objTypeName) return undefined;

    // Find the FB declaration and the method
    const fb = this.ast.functionBlocks.find(
      (f) => f.name.toUpperCase() === objTypeName.toUpperCase(),
    );
    if (fb) {
      const method = fb.methods.find(
        (m) => m.name.toUpperCase() === expr.methodName.toUpperCase(),
      );
      if (method?.returnType) {
        const retType =
          ELEMENTARY_TYPES[method.returnType.name.toUpperCase()] ??
          ({
            typeKind: "elementary",
            name: method.returnType.name,
            sizeBits: 0,
          } as ElementaryType);
        expr.resolvedType = retType;
        return retType;
      }
    }

    return undefined;
  }

  // ===========================================================================
  // Statement Type Validation (Sub-Phase C)
  // ===========================================================================

  /**
   * Walk variable declarations and validate every initialiser against the
   * declared type. Without this pass, nonsense like `WSTRING := 'foo'`
   * (STRING literal into a WSTRING variable) reaches codegen unchecked,
   * surfacing as a confusing C++ "no matching function for call to
   * IECWStringVar(const char[N])" instead of a proper IEC type error
   * pointing at the declaration.
   *
   * The check delegates to the same `validateAssignment` used for
   * assignment statements — no separate compatibility rules — so anything
   * the standard considers an implicit assignment also passes here.
   */
  private checkVarBlocks(blocks: VarBlock[], scope: Scope): void {
    for (const block of blocks) {
      for (const decl of block.declarations) {
        if (!decl.initialValue) continue;
        const targetType = ELEMENTARY_TYPES[decl.type.name.toUpperCase()];
        if (!targetType) continue; // Non-elementary types — handled elsewhere
        const valueType = this.resolveExprType(decl.initialValue, scope);
        if (!valueType) continue;
        this.validateAssignment(
          targetType,
          valueType,
          // Synthetic VariableExpression for the diagnostic anchor: gives
          // validateAssignment a target.name to mention in the error.
          {
            kind: "VariableExpression",
            sourceSpan: decl.sourceSpan,
            name: decl.names[0] ?? "<unnamed>",
            fieldAccess: [],
            subscripts: [],
            isDereference: false,
          },
          decl.initialValue,
        );
      }
    }
  }

  /**
   * Walk statements, resolve all sub-expressions, and validate type rules.
   */
  private checkStatements(stmts: Statement[], scope: Scope): void {
    for (const stmt of stmts) {
      this.checkStatement(stmt, scope);
    }
  }

  private checkStatement(stmt: Statement, scope: Scope): void {
    switch (stmt.kind) {
      case "AssignmentStatement": {
        const targetType = this.resolveExprType(stmt.target, scope);
        const valueType = this.resolveExprType(stmt.value, scope);
        this.validateAssignment(targetType, valueType, stmt.target, stmt.value);
        break;
      }

      case "RefAssignStatement": {
        this.resolveExprType(stmt.target, scope);
        this.resolveExprType(stmt.source, scope);
        // REF= rebinds a reference, so the target must be declared
        // REF_TO / REFERENCE TO. Catch `plainVar REF= x` here with a clear
        // message rather than letting it fall through to a confusing C++
        // error (e.g. `IEC_INT` has no member `bind`).
        if (stmt.target.kind === "VariableExpression") {
          const sym = scope.lookup(stmt.target.name);
          if (sym && sym.kind === "variable") {
            const refKind = sym.declaration?.type?.referenceKind;
            // Method/property result variables are synthetic and have no
            // declaration; REF= to the method name is valid.
            if (
              refKind !== undefined &&
              refKind !== "ref_to" &&
              refKind !== "reference_to"
            ) {
              this.addError(
                `REF= requires a REF_TO or REFERENCE TO target; '${stmt.target.name}' is not a reference`,
                stmt.target.sourceSpan.startLine,
                stmt.target.sourceSpan.startCol,
                stmt.target.sourceSpan.file,
              );
            }
          }
        }
        break;
      }

      case "IfStatement": {
        const condType = this.resolveExprType(stmt.condition, scope);
        this.validateCondition(condType, stmt.condition);
        this.checkStatements(stmt.thenStatements, scope);
        for (const clause of stmt.elsifClauses) {
          const clauseCondType = this.resolveExprType(clause.condition, scope);
          this.validateCondition(clauseCondType, clause.condition);
          this.checkStatements(clause.statements, scope);
        }
        this.checkStatements(stmt.elseStatements, scope);
        break;
      }

      case "CaseStatement": {
        const selectorType = this.resolveExprType(stmt.selector, scope);
        if (selectorType) {
          this.validateCaseSelector(selectorType, stmt.selector);
        }
        for (const c of stmt.cases) {
          for (const label of c.labels) {
            this.resolveExprType(label.start, scope);
            if (label.end) this.resolveExprType(label.end, scope);
          }
          this.checkStatements(c.statements, scope);
        }
        this.checkStatements(stmt.elseStatements, scope);
        break;
      }

      case "ForStatement": {
        const startType = this.resolveExprType(stmt.start, scope);
        const endType = this.resolveExprType(stmt.end, scope);
        if (stmt.step) this.resolveExprType(stmt.step, scope);

        // Validate control variable type
        const controlSym = scope.lookup(stmt.controlVariable);
        if (
          controlSym?.kind === "variable" ||
          controlSym?.kind === "constant"
        ) {
          const ctrlType = controlSym.type;
          if (ctrlType && !_isTypeInCategory(ctrlType, "ANY_INT")) {
            this.addError(
              `FOR control variable '${stmt.controlVariable}' must be an integer type, got ${typeNameUtil(ctrlType)}`,
              stmt.sourceSpan.startLine,
              stmt.sourceSpan.startCol,
              stmt.sourceSpan.file,
            );
          }
          // Validate start/end compatibility with control variable
          // Use warnings instead of errors — CODESYS is lenient with FOR bounds
          if (
            ctrlType &&
            startType &&
            !this.isUntypedNumericLiteral(stmt.start)
          ) {
            if (
              ctrlType.typeKind === "elementary" &&
              startType.typeKind === "elementary" &&
              !_isAssignable(ctrlType, startType)
            ) {
              this.addWarning(
                `FOR start value type ${typeNameUtil(startType)} is not compatible with control variable type ${typeNameUtil(ctrlType)}`,
                stmt.start.sourceSpan.startLine,
                stmt.start.sourceSpan.startCol,
                stmt.start.sourceSpan.file,
              );
            }
          }
          if (ctrlType && endType && !this.isUntypedNumericLiteral(stmt.end)) {
            if (
              ctrlType.typeKind === "elementary" &&
              endType.typeKind === "elementary" &&
              !_isAssignable(ctrlType, endType)
            ) {
              this.addWarning(
                `FOR end value type ${typeNameUtil(endType)} is not compatible with control variable type ${typeNameUtil(ctrlType)}`,
                stmt.end.sourceSpan.startLine,
                stmt.end.sourceSpan.startCol,
                stmt.end.sourceSpan.file,
              );
            }
          }
        }
        this.checkStatements(stmt.body, scope);
        break;
      }

      case "WhileStatement": {
        const condType = this.resolveExprType(stmt.condition, scope);
        this.validateCondition(condType, stmt.condition);
        this.checkStatements(stmt.body, scope);
        break;
      }

      case "RepeatStatement": {
        this.checkStatements(stmt.body, scope);
        const condType = this.resolveExprType(stmt.condition, scope);
        this.validateCondition(condType, stmt.condition);
        break;
      }

      case "FunctionCallStatement": {
        // resolveExprType already validates function call args
        this.resolveExprType(stmt.call, scope);
        break;
      }

      case "ReturnStatement":
      case "ExitStatement":
      case "ExternalCodePragma":
        // No expressions to validate
        break;

      case "DeleteStatement": {
        this.resolveExprType(stmt.pointer, scope);
        break;
      }

      case "AssertCall": {
        // Assert calls may have conditions
        break;
      }
    }
  }

  // ===========================================================================
  // Validation Helpers
  // ===========================================================================

  private validateAssignment(
    targetType: IECType | undefined,
    valueType: IECType | undefined,
    target: Expression,
    value: Expression,
  ): void {
    if (!targetType || !valueType) return;

    // Integer/real/bool literals without explicit type prefix are polymorphic,
    // but they must still fit in the target type's range and not overflow.
    if (this.isUntypedNumericLiteral(value)) {
      const literal = value as LiteralExpression;
      const check = this.validateUntypedLiteralFits(targetType, literal);
      if (check) {
        if (check.kind === "error") {
          this.addError(
            check.message,
            value.sourceSpan.startLine,
            value.sourceSpan.startCol,
            value.sourceSpan.file,
          );
          return;
        }
        if (check.kind === "warning") {
          this.addWarning(
            check.message,
            value.sourceSpan.startLine,
            value.sourceSpan.startCol,
            value.sourceSpan.file,
          );
          return;
        }
        return;
      }
    }

    // Check assignment compatibility
    if (!_isAssignable(targetType, valueType)) {
      // Check if it's a function name assignment (return value)
      if (target.kind === "VariableExpression") {
        const funcSym = this.symbolTables.lookupFunction(target.name);
        if (funcSym) return; // Function return assignment
      }

      // Allow reference/pointer assignments to non-reference types (CODESYS pattern)
      if (
        valueType.typeKind === "reference" ||
        targetType.typeKind === "reference"
      ) {
        return;
      }

      // For elementary types, check if this is narrowing (warning) vs truly incompatible (error)
      if (
        targetType.typeKind === "elementary" &&
        valueType.typeKind === "elementary"
      ) {
        const tName = (targetType as ElementaryType).name;
        const vName = (valueType as ElementaryType).name;

        // If either side is a FB or struct type, it's definitely incompatible
        // with a scalar type — fall through to the error report.
        // Otherwise, skip validation for user-defined type aliases we can't
        // fully resolve (e.g. MyInt := INT where MyInt is an alias for INT).
        const tIsFbOrStruct = this.isKnownCompositeType(tName);
        const vIsFbOrStruct = this.isKnownCompositeType(vName);
        if (!tIsFbOrStruct && !vIsFbOrStruct) {
          if (!ELEMENTARY_TYPES[tName] || !ELEMENTARY_TYPES[vName]) {
            return;
          }
        }

        // Narrowing conversions are warnings, not errors
        if (isNarrowingConversion(tName, vName)) {
          this.addWarning(
            `Implicit narrowing conversion from ${vName} to ${tName}`,
            value.sourceSpan.startLine,
            value.sourceSpan.startCol,
            value.sourceSpan.file,
          );
          return;
        }
      }

      this.addError(
        `Cannot assign ${typeNameUtil(valueType)} to ${typeNameUtil(targetType)}`,
        value.sourceSpan.startLine,
        value.sourceSpan.startCol,
        value.sourceSpan.file,
      );
      return;
    }
  }

  /**
   * Check whether a typed numeric literal fits its own declared prefix type.
   * Typed literals like `BYTE#300` or `SINT#128` are invalid regardless of
   * the assignment target because the prefix constrains the value range.
   */
  private checkTypedLiteralRange(
    expr: LiteralExpression,
    typeName: string,
  ): void {
    const range = getTypeNumericRange(typeName);
    if (!range) return;

    const hashIdx = expr.rawValue.indexOf("#");
    const valuePart =
      hashIdx !== -1 ? expr.rawValue.slice(hashIdx + 1) : expr.rawValue;

    if (valuePart.length === 0) return;

    if (expr.literalType === "INT") {
      const bigValue = parseIntegerLiteral(valuePart);
      if (bigValue === undefined) return;
      if (range.isInteger) {
        // Values outside the widest IEC integer types are reported by the
        // analyzer's validateIntegerLiteralRange so the diagnostic names the
        // global range rather than a specific target type.
        if (bigValue > IEC_INTEGER_MAX || bigValue < IEC_INTEGER_MIN) return;
        if (bigValue < range.min || bigValue > range.max) {
          this.addError(
            `Literal value ${bigValue} is out of range for ${typeName}`,
            expr.sourceSpan.startLine,
            expr.sourceSpan.startCol,
            expr.sourceSpan.file,
          );
        }
      } else {
        const num = Number(bigValue);
        if (Math.abs(num) > range.max) {
          this.addError(
            `Literal value ${bigValue} overflows ${typeName}`,
            expr.sourceSpan.startLine,
            expr.sourceSpan.startCol,
            expr.sourceSpan.file,
          );
        }
      }
    } else if (expr.literalType === "REAL") {
      const num = Number(valuePart);
      if (!Number.isFinite(num)) {
        this.addError(
          `Literal value ${expr.rawValue} is not finite`,
          expr.sourceSpan.startLine,
          expr.sourceSpan.startCol,
          expr.sourceSpan.file,
        );
        return;
      }
      if (Math.abs(num) > range.max) {
        this.addError(
          `Literal value ${expr.rawValue} overflows ${typeName}`,
          expr.sourceSpan.startLine,
          expr.sourceSpan.startCol,
          expr.sourceSpan.file,
        );
      }
    } else if (expr.literalType === "BOOL") {
      const upper = valuePart.trim().toUpperCase();
      if (
        upper !== "TRUE" &&
        upper !== "FALSE" &&
        upper !== "1" &&
        upper !== "0"
      ) {
        return;
      }
      const intValue = upper === "TRUE" || upper === "1" ? 1n : 0n;
      if (intValue < range.min || intValue > range.max) {
        this.addError(
          `Boolean literal ${expr.rawValue} does not fit in ${typeName}`,
          expr.sourceSpan.startLine,
          expr.sourceSpan.startCol,
          expr.sourceSpan.file,
        );
      }
    }
  }

  /**
   * Check whether an untyped numeric literal fits its target type.
   * Returns an object describing the result, or undefined when the target
   * is not a range-tracked numeric type (fall through to normal assignability).
   */
  private validateUntypedLiteralFits(
    targetType: IECType,
    value: LiteralExpression,
  ):
    | { kind: "ok" }
    | { kind: "error"; message: string }
    | { kind: "warning"; message: string }
    | undefined {
    if (targetType.typeKind !== "elementary") return undefined;
    const targetName = (targetType as ElementaryType).name.toUpperCase();
    const range = getTypeNumericRange(targetName);
    if (!range) return undefined;

    if (value.literalType === "BOOL") {
      const boolValue =
        value.value === true ||
        value.value === "TRUE" ||
        value.rawValue?.toUpperCase() === "TRUE";
      const intValue = boolValue ? 1n : 0n;
      if (intValue < range.min || intValue > range.max) {
        return {
          kind: "error",
          message: `Boolean literal ${value.rawValue} does not fit in ${targetName}`,
        };
      }
      return { kind: "ok" };
    }

    if (value.literalType === "INT") {
      const bigValue = parseIntegerLiteral(String(value.rawValue));
      if (bigValue === undefined) return undefined;
      if (range.isInteger) {
        if (bigValue > IEC_INTEGER_MAX || bigValue < IEC_INTEGER_MIN)
          return { kind: "ok" };
        if (bigValue < range.min || bigValue > range.max) {
          return {
            kind: "error",
            message: `Literal value ${bigValue} is out of range for ${targetName}`,
          };
        }
        return { kind: "ok" };
      }
      // Untyped integer assigned to a real type: check it is representable.
      const num = Number(bigValue);
      if (Math.abs(num) > range.max) {
        return {
          kind: "error",
          message: `Literal value ${bigValue} overflows ${targetName}`,
        };
      }
      return { kind: "ok" };
    }

    if (value.literalType === "REAL") {
      const num = Number(value.value);
      if (!Number.isFinite(num)) {
        return {
          kind: "error",
          message: `Literal value ${value.rawValue} is not finite`,
        };
      }
      if (Math.abs(num) > range.max) {
        return {
          kind: "error",
          message: `Literal value ${value.rawValue} overflows ${targetName}`,
        };
      }
      if (range.isInteger) {
        if (!Number.isInteger(num)) {
          return {
            kind: "warning",
            message: `Narrowing conversion from REAL to ${targetName}`,
          };
        }
        const bigValue = BigInt(Math.trunc(num));
        if (bigValue < range.min || bigValue > range.max) {
          return {
            kind: "error",
            message: `Literal value ${bigValue} is out of range for ${targetName}`,
          };
        }
        return { kind: "ok" };
      }
      return { kind: "ok" };
    }

    return undefined;
  }

  /**
   * Check if an expression is an untyped numeric literal (no explicit type prefix).
   * These are polymorphic and can be assigned to any compatible numeric type.
   */
  private isUntypedNumericLiteral(expr: Expression): boolean {
    if (expr.kind !== "LiteralExpression") return false;
    // If there's an explicit type prefix (e.g., DINT#42), it's not polymorphic
    if (expr.typePrefix) return false;
    return (
      expr.literalType === "INT" ||
      expr.literalType === "REAL" ||
      expr.literalType === "BOOL"
    );
  }

  /**
   * Check if a type name refers to a known function block or struct type.
   */
  private isKnownCompositeType(name: string): boolean {
    if (!this.ast) return false;
    const upper = name.toUpperCase();
    if (this.ast.functionBlocks.some((fb) => fb.name.toUpperCase() === upper)) {
      return true;
    }
    if (
      this.ast.types.some(
        (td) =>
          td.name.toUpperCase() === upper &&
          isCompositeDefinition(td.definition),
      )
    ) {
      return true;
    }
    // Also check library FBs via symbol tables
    if (this.symbolTables.lookupFunctionBlock(name)) {
      return true;
    }
    return false;
  }

  private validateCondition(
    condType: IECType | undefined,
    condExpr: Expression,
  ): void {
    if (!condType) return;

    // Conditions must be ANY_BIT (BOOL, BYTE, WORD, etc.)
    if (!_isTypeInCategory(condType, "ANY_BIT")) {
      this.addError(
        `Condition must be a boolean or bit type, got ${typeNameUtil(condType)}`,
        condExpr.sourceSpan.startLine,
        condExpr.sourceSpan.startCol,
        condExpr.sourceSpan.file,
      );
    }
  }

  private validateCaseSelector(
    selectorType: IECType,
    selectorExpr: Expression,
  ): void {
    // CASE selector must be ANY_INT, ANY_BIT, or enum (IEC 61131-3: ordinal types)
    if (
      !_isTypeInCategory(selectorType, "ANY_INT") &&
      !_isTypeInCategory(selectorType, "ANY_BIT") &&
      selectorType.typeKind !== "enum"
    ) {
      this.addError(
        `CASE selector must be an integer, bit, or enum type, got ${typeNameUtil(selectorType)}`,
        selectorExpr.sourceSpan.startLine,
        selectorExpr.sourceSpan.startCol,
        selectorExpr.sourceSpan.file,
      );
    }
  }

  private validateFunctionCallArgs(
    expr: FunctionCallExpression,
    _scope: Scope,
  ): void {
    if (!this.stdRegistry) return;

    const nameUpper = expr.functionName.toUpperCase();
    const desc = this.stdRegistry.lookup(nameUpper);
    if (!desc) return; // User-defined or unknown — skip constraint checking

    // Validate argument types against parameter constraints. Strip EN/ENO
    // first — they're handled by the codegen wrapper and don't map onto the
    // declared signature, so leaving them in would shift positional indices
    // and the param at slot 0 would be type-checked against EN's BOOL.
    const userArgs = stripEnEno(expr.arguments);
    for (let i = 0; i < userArgs.length && i < desc.params.length; i++) {
      const arg = userArgs[i]!;
      const param = desc.params[i]!;
      const argType = arg.value.resolvedType;

      if (!argType || argType.typeKind !== "elementary") continue;

      const argTypeName = (argType as ElementaryType).name;

      // Generic ANY/ANY_* values are AnyType descriptors, not concrete values,
      // and cannot be passed to standard functions.  ADR / SIZEOF / XSIZEOF /
      // __ISVALIDREF are exceptions: they operate on the descriptor/variable itself.
      if (
        isGenericTypeName(argTypeName.toUpperCase()) &&
        nameUpper !== "ADR" &&
        nameUpper !== "SIZEOF" &&
        nameUpper !== "XSIZEOF" &&
        nameUpper !== "__ISVALIDREF"
      ) {
        this.addError(
          `Cannot pass a value of generic type '${argTypeName}' to standard function '${nameUpper}' parameter '${param.name}'`,
          arg.value.sourceSpan.startLine,
          arg.value.sourceSpan.startCol,
          arg.value.sourceSpan.file,
        );
        continue;
      }

      // Check specific type constraint
      if (param.constraint === "specific" && param.specificType) {
        const specUpper = param.specificType.toUpperCase();
        if (argTypeName.toUpperCase() !== specUpper) {
          const specType = ELEMENTARY_TYPES[specUpper];
          // Allow implicit widening to the specific type
          if (specType && !_isAssignable(specType, argType)) {
            // Check if it's a narrowing (warning) vs truly incompatible (error)
            if (specType && isNarrowingConversion(specUpper, argTypeName)) {
              this.addWarning(
                `Argument '${param.name}' of '${nameUpper}' expects ${param.specificType}, got ${argTypeName} (narrowing)`,
                arg.value.sourceSpan.startLine,
                arg.value.sourceSpan.startCol,
                arg.value.sourceSpan.file,
              );
            } else {
              this.addError(
                `Argument '${param.name}' of '${nameUpper}' expects ${param.specificType}, got ${argTypeName}`,
                arg.value.sourceSpan.startLine,
                arg.value.sourceSpan.startCol,
                arg.value.sourceSpan.file,
              );
            }
          }
        }
      } else if (!matchesConstraint(argTypeName, param.constraint)) {
        // Allow implicit widening: INT→REAL for ANY_REAL constraints, etc.
        // Check if the argument type can be implicitly widened to a type in the constraint category
        const canWiden = this.canWidenToConstraint(
          argTypeName,
          param.constraint,
        );
        if (!canWiden) {
          this.addError(
            `Argument '${param.name}' of '${nameUpper}' expects ${param.constraint}, got ${argTypeName}`,
            arg.value.sourceSpan.startLine,
            arg.value.sourceSpan.startCol,
            arg.value.sourceSpan.file,
          );
        }
      }
    }
  }

  /**
   * Check if a type can be implicitly widened to match a constraint.
   * E.g., INT can match ANY_REAL because INT→REAL is a valid widening.
   */
  private canWidenToConstraint(
    typeName: string,
    constraint: import("./std-function-registry.js").TypeConstraint,
  ): boolean {
    const upper = typeName.toUpperCase();
    // ANY_REAL: integer types can be implicitly promoted to REAL
    if (constraint === "ANY_REAL") {
      const elemType: ElementaryType = ELEMENTARY_TYPES[upper] ?? {
        typeKind: "elementary" as const,
        name: upper,
        sizeBits: 0,
      };
      return _isTypeInCategory(elemType, "ANY_INT");
    }
    // ANY_NUM: only numeric (integer or real) types can be widened to ANY_NUM.
    if (constraint === "ANY_NUM") {
      const elemType: ElementaryType = ELEMENTARY_TYPES[upper] ?? {
        typeKind: "elementary" as const,
        name: upper,
        sizeBits: 0,
      };
      return _isTypeInCategory(elemType, "ANY_NUM");
    }
    // ANY_BIT: bit-string types only. Bit shifts use ANY_BIT_OR_INT instead.
    if (constraint === "ANY_BIT") {
      const elemType: ElementaryType = ELEMENTARY_TYPES[upper] ?? {
        typeKind: "elementary" as const,
        name: upper,
        sizeBits: 0,
      };
      return _isTypeInCategory(elemType, "ANY_BIT");
    }
    // ANY_BIT_OR_INT: CODESYS extension for SHL/SHR/ROL/ROR.
    if (constraint === "ANY_BIT_OR_INT") {
      const elemType: ElementaryType = ELEMENTARY_TYPES[upper] ?? {
        typeKind: "elementary" as const,
        name: upper,
        sizeBits: 0,
      };
      return (
        _isTypeInCategory(elemType, "ANY_BIT") ||
        _isTypeInCategory(elemType, "ANY_INT")
      );
    }
    return false;
  }

  /**
   * Validate arguments to user-defined functions with generic VAR_INPUT parameters.
   *
   * CODESYS passes ANY/ANY_* parameters by pointer (as an AnyType descriptor), so
   * only variable-locations may be supplied.  Literals, function-call results,
   * and other expressions are rejected.
   */
  private validateUserFunctionGenericArgs(
    expr: FunctionCallExpression,
    funcSymbol: FunctionSymbol,
  ): void {
    // Build an ordered list of VAR_INPUT parameters from the declaration.
    // (FunctionSymbol.parameters is only populated for library functions.)
    type ParamInfo = { name: string; typeName: string; isInput: boolean };
    const params: ParamInfo[] = [];
    for (const block of funcSymbol.declaration.varBlocks) {
      const isInput = block.blockType === "VAR_INPUT";
      for (const decl of block.declarations) {
        for (const name of decl.names) {
          params.push({
            name,
            typeName: decl.type.name ?? "",
            isInput,
          });
        }
      }
    }

    // Separate positional and named arguments.
    const positionalArgs: Expression[] = [];
    const namedArgs = new Map<string, Expression>();
    for (const arg of expr.arguments) {
      if (arg.name !== undefined) {
        namedArgs.set(arg.name.toUpperCase(), arg.value);
      } else {
        positionalArgs.push(arg.value);
      }
    }

    // Walk parameters in declaration order; assign positional arguments to
    // unclaimed slots, then fill named arguments.
    let positionalIdx = 0;
    for (const param of params) {
      let argExpr: Expression | undefined;
      if (namedArgs.has(param.name.toUpperCase())) {
        argExpr = namedArgs.get(param.name.toUpperCase());
      } else if (positionalIdx < positionalArgs.length) {
        argExpr = positionalArgs[positionalIdx];
        positionalIdx++;
      }

      if (!argExpr) continue;
      if (!param.isInput) continue;
      if (!isGenericTypeName(param.typeName.toUpperCase())) continue;

      if (!this.isLvalueExpression(argExpr)) {
        this.addError(
          `Generic parameter '${param.name}' of '${funcSymbol.name}' requires a variable; literals and expressions cannot be passed to ANY/ANY_* inputs`,
          argExpr.sourceSpan.startLine,
          argExpr.sourceSpan.startCol,
          argExpr.sourceSpan.file,
        );
      }
    }
  }

  /**
   * Whether an expression denotes a variable location that can be passed to an
   * ANY/ANY_* VAR_INPUT parameter.
   */
  private isLvalueExpression(expr: Expression): boolean {
    switch (expr.kind) {
      case "VariableExpression":
        return true;
      case "DrefExpression":
        return true;
      case "ParenthesizedExpression":
        return this.isLvalueExpression(expr.expression);
      default:
        return false;
    }
  }

  // ===========================================================================
  // Public API (backward compatible)
  // ===========================================================================

  /**
   * Check if a type belongs to a category.
   * Delegates to type-utils.
   */
  isTypeInCategory(
    type: IECType,
    category: import("./type-utils.js").TypeCategory,
  ): boolean {
    return _isTypeInCategory(type, category);
  }

  /**
   * Check if two types are compatible for assignment.
   * Delegates to type-utils isAssignable.
   */
  areTypesCompatible(target: IECType, source: IECType): boolean {
    return _isAssignable(target, source);
  }

  // ===========================================================================
  // Error/Warning Helpers
  // ===========================================================================

  /**
   * Add an error message.
   */
  private addError(
    message: string,
    line: number,
    column: number,
    file?: string,
  ): void {
    this.errors.push({
      message,
      line,
      column,
      severity: "error",
      ...(file ? { file } : {}),
    });
  }

  /**
   * Add a warning message.
   */
  protected addWarning(
    message: string,
    line: number,
    column: number,
    file?: string,
  ): void {
    this.warnings.push({
      message,
      line,
      column,
      severity: "warning",
      ...(file ? { file } : {}),
    });
  }
}
