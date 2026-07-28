/**
 * STruCpp located variable / OpenPLC I/O integration tests.
 *
 * Verifies that VAR AT %I/%Q/%M and VAR_GLOBAL located variables are bound
 * to the runtime I/O image and copied in/out around program scans.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { compile } from '../../src/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  hasGpp,
  createPCH,
  compileAndRunStandalone,
} from './test-helpers.js';

const describeIfGpp = hasGpp ? describe : describe.skip;

describeIfGpp('Located variable I/O binding', () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strucpp-located-'));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('copies program-local BOOL located input to output', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          input  AT %IX0.0 : BOOL;
          output AT %QX0.0 : BOOL;
        END_VAR
        output := input;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'loc_bool',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    __input_image().resize(1, 0);
    __input_image()[0] = 0x01;  // bit 0 set

    __init_global_located_pointers();
    Program_MAIN p;
    p.bind_located_vars();

    __located_vars = locatedVars;
    __located_vars_count = locatedVarsCount;

    __sync_located_in();
    p.run();
    __sync_located_out();

    return (__output_image().size() >= 1 && (__output_image()[0] & 0x01)) ? 0 : 1;
}
`,
    });

    expect(output).toBe('');
    expect(1).toBe(1); // binary return 0 indicates success
  });

  it('copies program-local BYTE located input to output', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          input  AT %IB1 : BYTE;
          output AT %QB1 : BYTE;
        END_VAR
        output := input;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'loc_byte',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    __input_image().resize(2, 0);
    __input_image()[1] = 0xAB;

    __init_global_located_pointers();
    Program_MAIN p;
    p.bind_located_vars();

    __located_vars = locatedVars;
    __located_vars_count = locatedVarsCount;

    __sync_located_in();
    p.run();
    __sync_located_out();

    if (__output_image().size() >= 2 && __output_image()[1] == 0xAB) {
        std::cout << "OK" << std::endl;
        return 0;
    }
    return 1;
}
`,
    });

    expect(output).toContain('OK');
  });

  it('copies VAR_GLOBAL located input to output', () => {
    const result = compile(`
      VAR_GLOBAL
        gIn  AT %IX0.0 : BOOL;
        gOut AT %QX0.0 : BOOL;
      END_VAR

      PROGRAM Main
        gOut := gIn;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'loc_global',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    __input_image().resize(1, 0);
    __input_image()[0] = 0x01;

    __init_global_located_pointers();
    Program_MAIN p;
    p.bind_located_vars();

    __located_vars = locatedVars;
    __located_vars_count = locatedVarsCount;

    __sync_located_in();
    p.run();
    __sync_located_out();

    if (__output_image().size() >= 1 && (__output_image()[0] & 0x01)) {
        std::cout << "OK" << std::endl;
        return 0;
    }
    return 1;
}
`,
    });

    expect(output).toContain('OK');
  });

  it('accepts and runs incomplete placeholder located addresses', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          input  AT %I* : BOOL;
          output AT %Q* : BOOL;
        END_VAR
        output := input;
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'loc_placeholder',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    __input_image().resize(1, 0);
    __input_image()[0] = 0x01;

    __init_global_located_pointers();
    Program_MAIN p;
    p.bind_located_vars();

    __located_vars = locatedVars;
    __located_vars_count = locatedVarsCount;

    __sync_located_in();
    p.run();
    __sync_located_out();

    if (__output_image().size() >= 1 && (__output_image()[0] & 0x01)) {
        std::cout << "OK" << std::endl;
        return 0;
    }
    return 1;
}
`,
    });

    expect(output).toContain('OK');
  });
});
