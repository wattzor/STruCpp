/**
 * STruC++ Test File Parser Negative Tests
 *
 * Covers the `parseResult.errors`, `!parseResult.cst`, and `buildTestAST` catch
 * branches of `parseTestFile`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompileError } from '../../src/types.js';

vi.mock('../../src/frontend/parser.js', () => ({
  parseTestSource: vi.fn(),
}));

vi.mock('../../src/frontend/ast-builder.js', () => ({
  buildTestAST: vi.fn(),
}));

import { parseTestFile } from '../../src/testing/test-parser.js';
import { parseTestSource } from '../../src/frontend/parser.js';
import { buildTestAST } from '../../src/frontend/ast-builder.js';

describe('parseTestFile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parse errors when the test lexer/parser fails', async () => {
    const actual = await vi.importActual<{ parseTestSource: typeof parseTestSource }>('../../src/frontend/parser.js');
    (parseTestSource as unknown as ReturnType<typeof vi.fn>).mockImplementation(actual.parseTestSource);

    const result = parseTestFile('TEST', 'bad.st');
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.testFile).toBeUndefined();
  });

  it('reports a missing CST when parsing produces no tree and no errors', () => {
    (parseTestSource as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cst: undefined,
      errors: [],
      comments: [],
    });

    const result = parseTestFile('', 'empty.st');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Parse failed: no CST produced');
    expect(result.testFile).toBeUndefined();
  });

  it('catches AST builder exceptions and turns them into CompileError', () => {
    const fakeCst = { name: 'testFile' } as unknown as Record<string, unknown>;
    (parseTestSource as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cst: fakeCst,
      errors: [],
      comments: [],
    });
    (buildTestAST as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('forced AST failure');
    });

    const result = parseTestFile('', 'boom.st');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('forced AST failure');
    expect(result.testFile).toBeUndefined();
  });

  it('handles parse errors that lack all optional location fields', () => {
    (parseTestSource as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cst: undefined,
      errors: [{}],
      comments: [],
    });

    const result = parseTestFile('', 'bare.st');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toBe('Parse error');
    expect(result.errors[0]!.line).toBe(0);
    expect(result.errors[0]!.column).toBe(0);
  });

  it('catches non-Error AST builder throws', () => {
    const fakeCst = { name: 'testFile' } as unknown as Record<string, unknown>;
    (parseTestSource as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      cst: fakeCst,
      errors: [],
      comments: [],
    });
    (buildTestAST as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw 'plain string failure';
    });

    const result = parseTestFile('', 'boom.st');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('plain string failure');
    expect(result.testFile).toBeUndefined();
  });
});
