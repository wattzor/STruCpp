/**
 * STruC++ Type Code Generator Tests
 *
 * Tests for the type code generator that produces C++ type definitions.
 */

import { describe, it, expect } from 'vitest';
import {
  TypeCodeGenerator,
  generateTypeCode,
} from '../../src/backend/type-codegen.js';
import { TypeRegistry } from '../../src/semantic/type-registry.js';
import type {
  TypeDeclaration,
  StructDefinition,
  UnionDefinition,
  EnumDefinition,
  ArrayDefinition,
  SubrangeDefinition,
  TypeReference,
  EnumMember,
  VarDeclaration,
  ArrayDimension,
  LiteralExpression,
  BinaryExpression,
  UnaryExpression,
  VariableExpression,
} from '../../src/frontend/ast.js';

const createSourceSpan = () => ({
  file: '',
  startLine: 1,
  endLine: 1,
  startCol: 1,
  endCol: 1,
});

const createLiteral = (value: number): LiteralExpression => ({
  kind: 'LiteralExpression',
  sourceSpan: createSourceSpan(),
  literalType: 'INT',
  value,
  rawValue: String(value),
});

const createTypeRef = (name: string): TypeReference => ({
  kind: 'TypeReference',
  sourceSpan: createSourceSpan(),
  name,
  isReference: false,
});

const createEnumMember = (name: string, value?: number): EnumMember => ({
  kind: 'EnumMember',
  sourceSpan: createSourceSpan(),
  name,
  ...(value !== undefined ? { value: createLiteral(value) } : {}),
});

const createVarDecl = (name: string, typeName: string): VarDeclaration => ({
  kind: 'VarDeclaration',
  sourceSpan: createSourceSpan(),
  names: [name],
  type: createTypeRef(typeName),
});

const createArrayDim = (start: number, end: number): ArrayDimension => ({
  kind: 'ArrayDimension',
  sourceSpan: createSourceSpan(),
  start: createLiteral(start),
  end: createLiteral(end),
});

describe('TypeCodeGenerator', () => {
  describe('mapTypeToCpp', () => {
    it('should map elementary types to C++ types', () => {
      const generator = new TypeCodeGenerator();
      expect(generator.mapTypeToCpp('BOOL')).toBe('BOOL_t');
      expect(generator.mapTypeToCpp('INT')).toBe('INT_t');
      expect(generator.mapTypeToCpp('REAL')).toBe('REAL_t');
      expect(generator.mapTypeToCpp('DINT')).toBe('DINT_t');
      expect(generator.mapTypeToCpp('STRING')).toBe('IECString<254>');
    });

    it('should be case-insensitive for elementary types', () => {
      const generator = new TypeCodeGenerator();
      expect(generator.mapTypeToCpp('int')).toBe('INT_t');
      expect(generator.mapTypeToCpp('Bool')).toBe('BOOL_t');
    });

    it('should preserve user-defined type names', () => {
      const generator = new TypeCodeGenerator();
      expect(generator.mapTypeToCpp('MyStruct')).toBe('MyStruct');
      expect(generator.mapTypeToCpp('TrafficLight')).toBe('TrafficLight');
    });
  });

  describe('generateTypes', () => {
    it('should return empty string for no types', () => {
      const generator = new TypeCodeGenerator();
      const result = generator.generateTypes([]);
      expect(result).toBe('');
    });

    it('should generate type alias', () => {
      const generator = new TypeCodeGenerator();
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'MyInt',
        definition: createTypeRef('INT'),
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('using MyInt = INT_t;');
    });

    it('should generate struct type', () => {
      const generator = new TypeCodeGenerator();
      const structDef: StructDefinition = {
        kind: 'StructDefinition',
        sourceSpan: createSourceSpan(),
        fields: [createVarDecl('x', 'INT'), createVarDecl('y', 'REAL')],
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Point',
        definition: structDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('struct Point {');
      expect(result).toContain('IEC_INT x');
      expect(result).toContain('IEC_REAL y');
      expect(result).toContain('};');
    });

    it('should generate union type with raw members and inlined structs', () => {
      const generator = new TypeCodeGenerator();
      const bytesDef: StructDefinition = {
        kind: 'StructDefinition',
        sourceSpan: createSourceSpan(),
        fields: [createVarDecl('b1', 'BYTE'), createVarDecl('b2', 'BYTE')],
      };
      const bytesType: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Bytes',
        definition: bytesDef,
      };

      const unionDef: UnionDefinition = {
        kind: 'UnionDefinition',
        sourceSpan: createSourceSpan(),
        fields: [
          createVarDecl('asWord', 'WORD'),
          createVarDecl('asBytes', 'Bytes'),
        ],
      };
      const unionType: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Overlay',
        definition: unionDef,
      };

      const result = generator.generateTypes([bytesType, unionType]);
      expect(result).toContain('union Overlay {');
      expect(result).toContain('WORD_t asWord;');
      expect(result).toContain('struct {');
      expect(result).toContain('BYTE_t b1;');
      expect(result).toContain('BYTE_t b2;');
      expect(result).toContain('} asBytes;');
      expect(result).toContain('iec_byte_size = std::max({');
      expect(result).toContain('using IEC_Overlay = Overlay;');
    });

    it('should generate simple enum type', () => {
      const generator = new TypeCodeGenerator();
      const enumDef: EnumDefinition = {
        kind: 'EnumDefinition',
        sourceSpan: createSourceSpan(),
        members: [
          createEnumMember('RED'),
          createEnumMember('YELLOW'),
          createEnumMember('GREEN'),
        ],
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'TrafficLight',
        definition: enumDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('enum class TrafficLight');
      expect(result).toContain('RED');
      expect(result).toContain('YELLOW');
      expect(result).toContain('GREEN');
    });

    it('should generate typed enum with explicit values', () => {
      const generator = new TypeCodeGenerator();
      const enumDef: EnumDefinition = {
        kind: 'EnumDefinition',
        sourceSpan: createSourceSpan(),
        baseType: createTypeRef('INT'),
        members: [
          createEnumMember('IDLE', 0),
          createEnumMember('RUNNING', 1),
          createEnumMember('STOPPED', 2),
        ],
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'State',
        definition: enumDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('enum class State : INT_t');
      expect(result).toContain('IDLE = 0');
      expect(result).toContain('RUNNING = 1');
      expect(result).toContain('STOPPED = 2');
    });

    it('falls back to raw operator text for unknown binary operators', () => {
      const generator = new TypeCodeGenerator();
      const andThenExpr: BinaryExpression = {
        kind: 'BinaryExpression',
        sourceSpan: createSourceSpan(),
        operator: 'AND_THEN',
        left: createLiteral(1),
        right: createLiteral(0),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'BOOL', isReference: false },
        resultTypeName: 'BOOL',
      };
      const enumDef: EnumDefinition = {
        kind: 'EnumDefinition',
        sourceSpan: createSourceSpan(),
        members: [
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'ALWAYS', value: andThenExpr },
        ],
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'FallbackOp',
        definition: enumDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('enum class FallbackOp');
      expect(result).toContain('ALWAYS = 1 AND_THEN 0');
    });

    it('lowers parenthesized, function call, pointer deref and fallback expressions', () => {
      const generator = new TypeCodeGenerator();
      const enumDef: EnumDefinition = {
        kind: 'EnumDefinition',
        sourceSpan: createSourceSpan(),
        members: [
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'PAREN', value: { kind: 'ParenthesizedExpression', sourceSpan: createSourceSpan(), expression: createLiteral(5) } },
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'CALL', value: { kind: 'FunctionCallExpression', sourceSpan: createSourceSpan(), functionName: 'foo', arguments: [] } },
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'DEREF', value: { kind: 'VariableExpression', sourceSpan: createSourceSpan(), name: 'ptr', subscripts: [], fieldAccess: [], isDereference: true, isReference: false } },
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'INDEXDEREF', value: { kind: 'VariableExpression', sourceSpan: createSourceSpan(), name: 'arr', subscripts: [createLiteral(1)], fieldAccess: ['field'], isDereference: true, isReference: false } },
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'NEG', value: { kind: 'UnaryExpression', sourceSpan: createSourceSpan(), operator: '-', operand: createLiteral(5), type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false } } },
          { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'UNKNOWN', value: { kind: 'ArrayLiteralExpression', sourceSpan: createSourceSpan(), elements: [] } },
        ],
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'ExprShapes',
        definition: enumDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('PAREN = (5)');
      expect(result).toContain('CALL = foo()');
      expect(result).toContain('DEREF = *ptr');
      expect(result).toContain('INDEXDEREF = *arr[1].field');
      expect(result).toContain('NEG = -5');
      expect(result).toContain('UNKNOWN = 0');
    });

    it('qualifies bare and qualified enum member references in values', () => {
      const generator = new TypeCodeGenerator();
      const colorEnum: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Color',
        definition: {
          kind: 'EnumDefinition',
          sourceSpan: createSourceSpan(),
          members: [createEnumMember('RED'), createEnumMember('GREEN')],
        },
      };
      const useEnum: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'ColorUse',
        definition: {
          kind: 'EnumDefinition',
          sourceSpan: createSourceSpan(),
          members: [
            { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'BARE', value: { kind: 'VariableExpression', sourceSpan: createSourceSpan(), name: 'RED', subscripts: [], fieldAccess: [], isDereference: false, isReference: false } },
            { kind: 'EnumMember', sourceSpan: createSourceSpan(), name: 'QUAL', value: { kind: 'VariableExpression', sourceSpan: createSourceSpan(), name: 'Color', subscripts: [], fieldAccess: ['RED'], isDereference: false, isReference: false } },
          ],
        },
      };

      const result = generator.generateTypes([colorEnum, useEnum]);
      expect(result).toContain('BARE = Color::RED');
      expect(result).toContain('QUAL = Color::RED');
    });

    it('should generate array type', () => {
      const generator = new TypeCodeGenerator();
      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [createArrayDim(0, 9)],
        elementType: createTypeRef('INT'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'IntArray',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      // Uses Array1D with preserved bounds (0..9), element type is IECVar-wrapped
      expect(result).toContain('using IntArray = Array1D<IEC_INT, 0, 9>;');
    });

    it('should generate multi-dimensional array type', () => {
      const generator = new TypeCodeGenerator();
      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [createArrayDim(0, 2), createArrayDim(0, 2)],
        elementType: createTypeRef('REAL'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Matrix',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      // Uses Array2D with preserved bounds for both dimensions, element type is IECVar-wrapped
      expect(result).toContain('using Matrix = Array2D<IEC_REAL, 0, 2, 0, 2>;');
    });

    it('should generate non-zero-based array type', () => {
      const generator = new TypeCodeGenerator();
      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [createArrayDim(3, 7)],
        elementType: createTypeRef('INT'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'OffsetArray',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      // Uses Array1D with preserved non-zero bounds (3..7), element type is IECVar-wrapped
      expect(result).toContain('using OffsetArray = Array1D<IEC_INT, 3, 7>;');
    });

    it('should evaluate constant expressions in array dimensions', () => {
      const generator = new TypeCodeGenerator();
      const binary = (
        op: BinaryExpression['operator'],
        left: number,
        right: number,
      ): BinaryExpression => ({
        kind: 'BinaryExpression',
        sourceSpan: createSourceSpan(),
        operator: op,
        left: createLiteral(left),
        right: createLiteral(right),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false },
        resultTypeName: 'INT',
      });
      const unary = (operand: number): UnaryExpression => ({
        kind: 'UnaryExpression',
        sourceSpan: createSourceSpan(),
        operator: '-',
        operand: createLiteral(operand),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false },
      });

      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: unary(5), end: binary('+', 2, 3) },
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: binary('/', 10, 2) },
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: binary('MOD', 10, 3) },
        ],
        elementType: createTypeRef('INT'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'ExprArray',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('using ExprArray = Array3D<IEC_INT, -5, 5, 0, 5, 0, 1>;');
    });

    it('should default non-constant dimension expressions to 0', () => {
      const generator = new TypeCodeGenerator();
      const badBinary: BinaryExpression = {
        kind: 'BinaryExpression',
        sourceSpan: createSourceSpan(),
        operator: '**' as BinaryExpression['operator'],
        left: createLiteral(2),
        right: createLiteral(3),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false },
        resultTypeName: 'INT',
      };
      const stringLiteral: LiteralExpression = {
        kind: 'LiteralExpression',
        sourceSpan: createSourceSpan(),
        literalType: 'STRING',
        value: 'abc',
        rawValue: '\'abc\'',
      };
      const variable: VariableExpression = {
        kind: 'VariableExpression',
        sourceSpan: createSourceSpan(),
        name: 'x',
        fieldAccess: [],
        isDereference: false,
        isReference: false,
      };

      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: badBinary },
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: stringLiteral },
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: variable },
        ],
        elementType: createTypeRef('INT'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'FallbackArray',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      // All non-constant expressions evaluate to 0, giving degenerate 0..0 bounds
      expect(result).toContain('FallbackArray');
    });

    it('should evaluate unary-plus, subtraction and multiplication dimension expressions', () => {
      const generator = new TypeCodeGenerator();
      const binary = (
        op: BinaryExpression['operator'],
        left: number,
        right: number,
      ): BinaryExpression => ({
        kind: 'BinaryExpression',
        sourceSpan: createSourceSpan(),
        operator: op,
        left: createLiteral(left),
        right: createLiteral(right),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false },
        resultTypeName: 'INT',
      });
      const unaryPlus = (operand: number): UnaryExpression => ({
        kind: 'UnaryExpression',
        sourceSpan: createSourceSpan(),
        operator: '+',
        operand: createLiteral(operand),
        type: { kind: 'TypeReference', sourceSpan: createSourceSpan(), name: 'INT', isReference: false },
      });

      const arrayDef: ArrayDefinition = {
        kind: 'ArrayDefinition',
        sourceSpan: createSourceSpan(),
        dimensions: [
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: createLiteral(0), end: binary('-', 10, 3) },
          { kind: 'ArrayDimension', sourceSpan: createSourceSpan(), isVariableLength: false, start: unaryPlus(0), end: binary('*', 2, 3) },
        ],
        elementType: createTypeRef('INT'),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'ExprArray2',
        definition: arrayDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('using ExprArray2 = Array2D<IEC_INT, 0, 7, 0, 6>;');
    });

    it('should generate subrange type', () => {
      const generator = new TypeCodeGenerator();
      const subrangeDef: SubrangeDefinition = {
        kind: 'SubrangeDefinition',
        sourceSpan: createSourceSpan(),
        baseType: createTypeRef('INT'),
        lowerBound: createLiteral(0),
        upperBound: createLiteral(100),
      };
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Percentage',
        definition: subrangeDef,
      };

      const result = generator.generateTypes([type]);
      expect(result).toContain('using Percentage = INT_t;');
      expect(result).toContain('constexpr INT_t Percentage_MIN = 0;');
      expect(result).toContain('constexpr INT_t Percentage_MAX = 100;');
    });
  });

  describe('generateFromRegistry', () => {
    it('should generate types from registry in dependency order', () => {
      const registry = new TypeRegistry();

      const innerStruct: StructDefinition = {
        kind: 'StructDefinition',
        sourceSpan: createSourceSpan(),
        fields: [createVarDecl('value', 'INT')],
      };
      const innerType: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Inner',
        definition: innerStruct,
      };

      const outerStruct: StructDefinition = {
        kind: 'StructDefinition',
        sourceSpan: createSourceSpan(),
        fields: [createVarDecl('inner', 'Inner')],
      };
      const outerType: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'Outer',
        definition: outerStruct,
      };

      registry.registerTypes([outerType, innerType]);

      const generator = new TypeCodeGenerator();
      const result = generator.generateFromRegistry(registry);

      const innerIndex = result.indexOf('struct Inner');
      const outerIndex = result.indexOf('struct Outer');
      expect(innerIndex).toBeLessThan(outerIndex);
    });
  });

  describe('generateTypeCode helper', () => {
    it('should generate type code from registry', () => {
      const registry = new TypeRegistry();
      const type: TypeDeclaration = {
        kind: 'TypeDeclaration',
        sourceSpan: createSourceSpan(),
        name: 'MyInt',
        definition: createTypeRef('INT'),
      };
      registry.registerType(type);

      const result = generateTypeCode(registry);
      expect(result).toContain('using MyInt = INT_t;');
    });
  });
});
