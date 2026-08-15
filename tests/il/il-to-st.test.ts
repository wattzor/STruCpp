/**
 * STruC++ IL to ST Converter Tests
 *
 * Targeted tests for uncovered branches in `convertILToST`.
 */

import { describe, it, expect } from 'vitest';
import { convertILToST } from '../../src/il/il-to-st.js';
import type { ILInstruction } from '../../src/il/il-types.js';

const instr = (operator: string, operand?: string, extra?: Partial<ILInstruction>): ILInstruction => ({
  operator: operator as ILInstruction['operator'],
  operand,
  sourceLine: 1,
  ...extra,
} as ILInstruction);

describe('convertILToST control-flow state machine', () => {
  it('emits a CAL with no parameters and reports unsupported operators', () => {
    const result = convertILToST(
      [
        instr('LD', 'x'),
        instr('ST', 'y'),
        instr('CAL', 'MyFB'),
        instr('BAD' as 'LD', 'x'),
      ],
      true,
    );

    expect(result.stBody).toContain('MyFB();');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('Unsupported IL operator');
  });

  it('emits CALC, CALCN, and FUNC_CALL with the current accumulator expression', () => {
    const result = convertILToST(
      [
        instr('LD', 'x'),
        instr('GT', 'y'),
        instr('CALC', 'MyFB'),
        instr('LD', 'x'),
        instr('GT', 'y'),
        instr('CALCN', 'MyFB'),
        instr('LD', 'x'),
        instr('FUNC_CALL', undefined, { functionName: 'SIN' }),
        instr('ST', 'z'),
      ],
      true,
    );

    expect(result.stBody).toContain('IF (x > y) THEN MyFB(); END_IF;');
    expect(result.stBody).toContain('IF NOT ((x > y)) THEN MyFB(); END_IF;');
    expect(result.stBody).toContain('z := SIN(x);');
  });

  it('emits set/reset and FB input invocation operators', () => {
    const result = convertILToST(
      [
        instr('LD', 'cond'),
        instr('S', 'flag'),
        instr('LD', 'cond'),
        instr('R', 'flag'),
        instr('LD', 'x'),
        instr('S1', 'MyFB'),
        instr('LD', 'x'),
        instr('R1', 'MyFB'),
        instr('S1'), // operand omitted -> no output
      ],
      true,
    );

    expect(result.stBody).toContain('IF cond THEN flag := TRUE; END_IF;');
    expect(result.stBody).toContain('IF cond THEN flag := FALSE; END_IF;');
    expect(result.stBody).toContain('MyFB.S1 := x;');
    expect(result.stBody).toContain('MyFB();');
    expect(result.stBody).toContain('MyFB.R1 := x;');
  });

  it('emits NOT, LDN and STN with the accumulator expression', () => {
    const result = convertILToST(
      [
        instr('LD', 'cond'),
        instr('NOT'),
        instr('STN', 'out'),
        instr('LDN', 'x'),
        instr('ST', 'y'),
        instr('STN'), // operand omitted -> no output
      ],
      true,
    );

    expect(result.stBody).toContain('out := NOT (NOT (cond));');
    expect(result.stBody).toContain('y := NOT x;');
  });
});
