/**
 * Reserved C++ runtime name tests.
 *
 * Global variables and type aliases whose names collide with emitted C++
 * standard-function or runtime type-alias names must produce a clear ST-level
 * diagnostic instead of an inscrutable g++ template error.
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/index.js';

describe('Reserved C++ runtime names', () => {
  it('rejects a global variable named after a standard function (ADD)', () => {
    const result = compile(`
      FUNCTION_BLOCK Adder
        VAR_INPUT a, b : INT; END_VAR
        VAR_OUTPUT result : INT; END_VAR
        result := a + b;
      END_FUNCTION_BLOCK

      VAR_GLOBAL
        add : Adder;
      END_VAR

      PROGRAM Main
        VAR sum : INT; END_VAR
        add(a := 5, b := 3);
        sum := add.result;
      END_PROGRAM
    `);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe('RESERVED_CPP_NAME');
    expect(result.errors[0]?.message).toContain("'ADD'");
  });

  it('rejects a global constant named after a runtime IEC type alias', () => {
    const result = compile(`
      VAR_GLOBAL CONSTANT
        IEC_DINT : DINT := 0;
      END_VAR

      PROGRAM Main
      END_PROGRAM
    `);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe('RESERVED_CPP_NAME');
    expect(result.errors[0]?.message).toContain("'IEC_DINT'");
  });

  it('rejects a type alias named after a standard function', () => {
    const result = compile(`
      TYPE
        add : INT;
      END_TYPE

      PROGRAM Main
      END_PROGRAM
    `);

    expect(result.success).toBe(false);
    expect(result.errors[0]?.code).toBe('RESERVED_CPP_NAME');
  });

  it('allows non-colliding global FB instance names', () => {
    const result = compile(`
      FUNCTION_BLOCK Adder
        VAR_INPUT a, b : INT; END_VAR
        VAR_OUTPUT result : INT; END_VAR
        result := a + b;
      END_FUNCTION_BLOCK

      VAR_GLOBAL
        myAdd : Adder;
      END_VAR

      PROGRAM Main
        VAR sum : INT; END_VAR
        myAdd(a := 5, b := 3);
        sum := myAdd.result;
      END_PROGRAM
    `);

    expect(result.success).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.cppCode).toContain('MYADD.A = 5');
  });
});
