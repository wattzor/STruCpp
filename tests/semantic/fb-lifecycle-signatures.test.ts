/**
 * STruC++ FB lifecycle method signature validation tests.
 *
 * CODESYS requires fixed signatures for FB_Init, FB_Exit and FB_Reinit.
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/index.js';

function compileLifecycle(source: string) {
  return compile(`
FUNCTION_BLOCK FB
${source}
END_FUNCTION_BLOCK
PROGRAM Main
VAR fb : FB; END_VAR
fb();
END_PROGRAM
`);
}

describe('FB lifecycle method signatures', () => {
  it('accepts valid FB_Init signature', () => {
    const result = compileLifecycle(`
METHOD FB_Init : BOOL
VAR_INPUT
  bInitRetains : BOOL;
  bInCopyCode : BOOL;
END_VAR
  FB_Init := TRUE;
END_METHOD
`);
    expect(result.success).toBe(true);
  });

  it('rejects FB_Init without BOOL return', () => {
    const result = compileLifecycle(`
METHOD FB_Init
VAR_INPUT
  bInitRetains : BOOL;
  bInCopyCode : BOOL;
END_VAR
END_METHOD
`);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("must return BOOL");
  });

  it('rejects FB_Init with wrong parameters', () => {
    const result = compileLifecycle(`
METHOD FB_Init : BOOL
VAR_INPUT x : INT; END_VAR
  FB_Init := TRUE;
END_METHOD
`);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("bInitRetains");
  });

  it('accepts valid FB_Exit signature', () => {
    const result = compileLifecycle(`
METHOD FB_Exit : BOOL
VAR_INPUT bInCopyCode : BOOL; END_VAR
  FB_Exit := TRUE;
END_METHOD
`);
    expect(result.success).toBe(true);
  });

  it('rejects FB_Exit with extra parameters', () => {
    const result = compileLifecycle(`
METHOD FB_Exit : BOOL
VAR_INPUT bInCopyCode : BOOL; extra : INT; END_VAR
  FB_Exit := TRUE;
END_METHOD
`);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("bInCopyCode");
  });

  it('accepts valid FB_Reinit signature', () => {
    const result = compileLifecycle(`
METHOD FB_Reinit : BOOL
  FB_Reinit := TRUE;
END_METHOD
`);
    expect(result.success).toBe(true);
  });

  it('rejects FB_Reinit with parameters', () => {
    const result = compileLifecycle(`
METHOD FB_Reinit : BOOL
VAR_INPUT x : INT; END_VAR
  FB_Reinit := TRUE;
END_METHOD
`);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toContain("no VAR_INPUT parameters");
  });
});
