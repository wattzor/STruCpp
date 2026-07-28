/**
 * Constant literal narrowing / overflow tests.
 *
 * Both untyped and typed numeric literals must fit in their declared type's
 * range. This suite verifies overflow errors and narrowing warnings for program
 * VAR initializers.
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/index.js';

function compileSource(body: string) {
  return compile(`PROGRAM Main VAR ${body} END_VAR END_PROGRAM`);
}

describe('constant literal narrowing and overflow', () => {
  it('errors on integer overflow for BYTE', () => {
    const result = compileSource('x : BYTE := 300;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/300 is out of range for BYTE/);
  });

  it('errors on integer overflow for INT', () => {
    const result = compileSource('x : INT := 32768;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/32768 is out of range for INT/);
  });

  it('errors on real overflow for REAL', () => {
    const result = compileSource('x : REAL := 1e40;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/overflows REAL/);
  });

  it('warns on narrowing REAL to INT', () => {
    const result = compileSource('x : INT := 1.5;');
    expect(result.success).toBe(true);
    expect(result.warnings[0]?.message).toMatch(/Narrowing conversion from REAL to INT/);
  });

  it('accepts whole REAL values that fit the integer range', () => {
    const result = compileSource('x : INT := 1.0;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts integer literals within a wider target', () => {
    const result = compileSource('x : DINT := 300;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts based literals that fit the target', () => {
    const result = compileSource('x : BYTE := 16#FF;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on based literal overflow', () => {
    const result = compileSource('x : INT := 16#FFFF;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/65535 is out of range for INT/);
  });

  it('accepts BOOL literals for BOOL targets', () => {
    const result = compileSource('x : BOOL := TRUE;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on integer literal 2 for BOOL target', () => {
    const result = compileSource('x : BOOL := 2;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/2 is out of range for BOOL/);
  });

  it('accepts LREAL values too large for REAL', () => {
    const result = compileSource('x : LREAL := 1e40;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it('errors on typed literal overflow for BYTE', () => {
    const result = compileSource('x : BYTE := BYTE#300;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/300 is out of range for BYTE/);
  });

  it('errors on typed literal overflow for USINT', () => {
    const result = compileSource('x : USINT := USINT#300;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/300 is out of range for USINT/);
  });

  it('errors on typed literal overflow for SINT', () => {
    const result = compileSource('x : SINT := SINT#128;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/128 is out of range for SINT/);
  });

  it('errors on typed literal overflow for INT', () => {
    const result = compileSource('x : INT := INT#32768;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/32768 is out of range for INT/);
  });

  it('errors on typed real overflow for REAL', () => {
    const result = compileSource('x : REAL := REAL#1e40;');
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/overflows REAL/);
  });

  it('accepts typed literals that fit their prefix', () => {
    const result = compileSource('x : BYTE := BYTE#255;');
    expect(result.success).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
