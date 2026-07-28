/**
 * STruC++ string standard-function integration tests.
 *
 * Verifies that STRING and WSTRING standard functions (LEFT, RIGHT, MID,
 * CONCAT, FIND, LEN, REPLACE, INSERT, DELETE) accept string literals as their
 * first argument and that WSTRING uses the IEC names (not W-prefixed names).
 * Also covers typed STRING# / WSTRING# literals.
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

describeIfGpp('String standard functions', () => {
  let tempDir: string;
  let pchPath: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strucpp-string-'));
    pchPath = createPCH(tempDir);
  });

  afterAll(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('STRING standard functions with literal first arguments', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          sa : INT;
          sb, sc, sd, se, sg : STRING;
          sf : INT;
        END_VAR
        sa := FIND('abcdef','cd');
        sb := LEFT('abcdef', 3);
        sc := RIGHT('abcdef', 2);
        sd := MID('abcdef', 2, 2);
        se := CONCAT('a','b','c');
        sf := LEN('hello');
        sg := REPLACE('abcdef','XX',2,3);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'string_std_funcs',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    Program_MAIN p;
    p.run();
    std::cout << "SA=" << static_cast<INT_t>(p.SA) << std::endl;
    std::cout << "SB=" << p.SB.c_str() << std::endl;
    std::cout << "SC=" << p.SC.c_str() << std::endl;
    std::cout << "SD=" << p.SD.c_str() << std::endl;
    std::cout << "SE=" << p.SE.c_str() << std::endl;
    std::cout << "SF=" << static_cast<INT_t>(p.SF) << std::endl;
    std::cout << "SG=" << p.SG.c_str() << std::endl;
    return 0;
}
`,
    });

    expect(output).toContain('SA=3');
    expect(output).toContain('SB=abc');
    expect(output).toContain('SC=ef');
    expect(output).toContain('SD=bc');
    expect(output).toContain('SE=abc');
    expect(output).toContain('SF=5');
    expect(output).toContain('SG=abXXef');
  });

  it('WSTRING standard functions with literal first arguments', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          wa : INT;
          wb, wc, wd, we, wg : WSTRING;
          wf : INT;
        END_VAR
        wa := FIND("abcdef","cd");
        wb := LEFT("abcdef", 3);
        wc := RIGHT("abcdef", 2);
        wd := MID("abcdef", 2, 2);
        we := CONCAT("a","b","c");
        wf := LEN("hello");
        wg := REPLACE("abcdef","XX",2,3);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'wstring_std_funcs',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    Program_MAIN p;
    p.run();
    std::cout << "WA=" << static_cast<INT_t>(p.WA) << std::endl;
    std::cout << "WB=" << WSTRING_TO_STRING(p.WB).c_str() << std::endl;
    std::cout << "WC=" << WSTRING_TO_STRING(p.WC).c_str() << std::endl;
    std::cout << "WD=" << WSTRING_TO_STRING(p.WD).c_str() << std::endl;
    std::cout << "WE=" << WSTRING_TO_STRING(p.WE).c_str() << std::endl;
    std::cout << "WF=" << static_cast<INT_t>(p.WF) << std::endl;
    std::cout << "WG=" << WSTRING_TO_STRING(p.WG).c_str() << std::endl;
    return 0;
}
`,
    });

    expect(output).toContain('WA=3');
    expect(output).toContain('WB=abc');
    expect(output).toContain('WC=ef');
    expect(output).toContain('WD=bc');
    expect(output).toContain('WE=abc');
    expect(output).toContain('WF=5');
    expect(output).toContain('WG=abXXef');
  });

  it('STRING and WSTRING mixed literal/variable arguments', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          s : STRING := 'abcdef';
          w : WSTRING := "abcdef";
          a, b : STRING;
          d : WSTRING;
          c, e, f : INT;
        END_VAR
        a := INSERT(s,'XY',2);
        b := DELETE(s,2,2);
        c := FIND(w,"cd");
        d := LEFT(w,2);
        e := FIND('xyz','y');
        f := LEN(w);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'string_mixed_args',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    Program_MAIN p;
    p.run();
    std::cout << "A=" << p.A.c_str() << std::endl;
    std::cout << "B=" << p.B.c_str() << std::endl;
    std::cout << "C=" << static_cast<INT_t>(p.C) << std::endl;
    std::cout << "D=" << WSTRING_TO_STRING(p.D).c_str() << std::endl;
    std::cout << "E=" << static_cast<INT_t>(p.E) << std::endl;
    std::cout << "F=" << static_cast<INT_t>(p.F) << std::endl;
    return 0;
}
`,
    });

    expect(output).toContain('A=aXYbcdef');
    expect(output).toContain('B=adef');
    expect(output).toContain('C=3');
    expect(output).toContain('D=ab');
    expect(output).toContain('E=2');
    expect(output).toContain('F=6');
  });

  it('STRING# and WSTRING# typed literals work as initialisers and expressions', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          s_init : STRING := STRING#'typed';
          w_init : WSTRING := WSTRING#"TYPED";
          a : STRING;
          b : WSTRING;
        END_VAR
        a := CONCAT(STRING#'foo', s_init);
        b := CONCAT(WSTRING#"bar", w_init);
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'string_typed_literals',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    Program_MAIN p;
    p.run();
    std::cout << "S_INIT=" << p.S_INIT.c_str() << std::endl;
    std::cout << "W_INIT=" << WSTRING_TO_STRING(p.W_INIT).c_str() << std::endl;
    std::cout << "A=" << p.A.c_str() << std::endl;
    std::cout << "B=" << WSTRING_TO_STRING(p.B).c_str() << std::endl;
    return 0;
}
`,
    });

    expect(output).toContain('S_INIT=typed');
    expect(output).toContain('W_INIT=TYPED');
    expect(output).toContain('A=footyped');
    expect(output).toContain('B=barTYPED');
  });

  it('STRING(n) and WSTRING(n) standard functions work with literals', () => {
    const result = compile(`
      PROGRAM Main
        VAR
          s80 : STRING(80) := 'abcdef';
          w80 : WSTRING(80) := "abcdef";
          a : STRING(80);
          b : WSTRING(80);
          c, d : INT;
        END_VAR
        a := LEFT(s80, 3);
        b := LEFT(w80, 3);
        c := FIND(s80,'cd');
        d := FIND(w80,"cd");
      END_PROGRAM
    `);
    expect(result.success).toBe(true);

    const output = compileAndRunStandalone({
      tempDir,
      pchPath,
      headerCode: result.headerCode,
      cppCode: result.cppCode,
      testName: 'string_parameterized',
      mainCode: `
#include <iostream>
int main() {
    using namespace strucpp;
    Program_MAIN p;
    p.run();
    std::cout << "A=" << p.A.c_str() << std::endl;
    std::cout << "B=" << WSTRING_TO_STRING(p.B).c_str() << std::endl;
    std::cout << "C=" << static_cast<INT_t>(p.C) << std::endl;
    std::cout << "D=" << static_cast<INT_t>(p.D) << std::endl;
    return 0;
}
`,
    });

    expect(output).toContain('A=abc');
    expect(output).toContain('B=abc');
    expect(output).toContain('C=3');
    expect(output).toContain('D=3');
  });
});
