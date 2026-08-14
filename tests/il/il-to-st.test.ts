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
});
