import { describe, it, expect } from 'vitest';
import {
  compile,
  analyze,
  parse,
  getVersion,
} from '../../src/index.js';
import type { StlibArchive } from '../../src/library/library-manifest.js';

describe('index.ts API branch coverage', () => {
  it('getVersion returns a version string', () => {
    const version = getVersion();
    expect(typeof version).toBe('string');
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('compile throws on invalid pouIncludes', () => {
    expect(() =>
      compile('PROGRAM Main VAR END_VAR END_PROGRAM', {
        pouIncludes: ['foo;bar.h'],
      }),
    ).toThrow(/pouIncludes entry/);
  });

  it('compile returns errors for a syntax error', () => {
    const result = compile('@@@@');
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('parse returns errors for invalid source', () => {
    const result = parse('@@@@');
    expect(result.ast).toBeUndefined();
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('analyze keeps going with partial input (continueOnError=true)', () => {
    const result = analyze('@@@@');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('compile reports IL body parse errors and aborts', () => {
    const source = `PROGRAM P
VAR
  x : INT;
END_VAR
LD 1
???
END_PROGRAM`;
    const result = compile(source);
    expect(result.success).toBe(false);
    expect(result.errors[0]?.message).toMatch(/Unexpected IL syntax/);
  });

  it('analyze continues after IL body parse errors', () => {
    const source = `PROGRAM P
VAR
  x : INT;
END_VAR
LD 1
???
END_PROGRAM`;
    const result = analyze(source);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('compile returns errors for duplicate program declarations', () => {
    const st = `
PROGRAM A
  VAR x : INT; END_VAR
  x := 1;
END_PROGRAM
PROGRAM A
  VAR y : INT; END_VAR
  y := 2;
END_PROGRAM
`;
    const result = compile(st);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Duplicate program'))).toBe(true);
  });

  it('compile returns errors for semantic errors', () => {
    const result = compile(
      'PROGRAM Main VAR x : UnknownType; END_VAR END_PROGRAM',
    );
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('analyze returns warnings for narrowing conversions', () => {
    const result = analyze(
      'PROGRAM Main VAR x : INT := 1.5; END_VAR END_PROGRAM',
    );
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('compile accepts global constants when no libraries are supplied', () => {
    const result = compile(
      'PROGRAM Main VAR x : ULINT; END_VAR x := FOO; END_PROGRAM',
      { globalConstants: { FOO: 42 } },
    );
    expect(result.success).toBe(true);
    expect(result.cppCode).toContain('FOO');
  });

  it('compile honours lineDirectiveFileName', () => {
    const result = compile(
      'PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM',
      { lineDirectives: true, lineDirectiveFileName: '/foo/bar.st' },
    );
    expect(result.success).toBe(true);
    expect(result.headerCode).toContain('/foo/bar.st');
  });

  it('compile omits file from errors when fileName is empty', () => {
    const result = compile('@@@@', { fileName: '' });
    expect(result.success).toBe(false);
    expect(result.errors[0]?.file).toBeUndefined();
  });

  it('compile skips additional sources with parse errors', () => {
    const result = compile('PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM', {
      additionalSources: [{ source: '@@@@', fileName: 'extra.st' }],
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.file === 'extra.st')).toBe(true);
  });

  it('compile reports IL body errors in additional sources', () => {
    const extra = `PROGRAM P
VAR
  x : INT;
END_VAR
LD 1
???
END_PROGRAM`;
    const result = compile('PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM', {
      additionalSources: [{ source: extra, fileName: 'extra.st' }],
    });
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.file === 'extra.st')).toBe(true);
  });

  it('compile tree-shakes library chunks and deduplicates headers', () => {
    const archive: StlibArchive = {
      formatVersion: 1,
      manifest: {
        name: 'TestLib',
        version: '1.0.0',
        namespace: 'testlib',
        functions: [
          { name: 'MYFUNC', returnType: 'INT', parameters: [] },
        ],
        functionBlocks: [],
        types: [],
        headers: ['foo.h'],
        isBuiltin: false,
        dependencies: [],
      },
      chunks: [
        {
          name: 'MYFUNC',
          kind: 'function',
          header: 'void MYFUNC();',
          cpp: 'void MYFUNC() {}',
          deps: [
            { library: 'TestLib', name: 'MISSING' },
            { library: 'OtherLib', name: 'MISSING' },
          ],
        },
      ],
      dependencies: [],
    };

    const result = compile(
      'PROGRAM Main VAR y : INT; END_VAR y := MYFUNC(); END_PROGRAM',
      { libraries: [archive] },
    );
    expect(result.success).toBe(true);
    expect(result.cppCode).toContain('MYFUNC');
    expect(result.resolvedLibraries?.length).toBe(1);
  });

  it('compile emits all library chunks in test builds', () => {
    const archive: StlibArchive = {
      formatVersion: 1,
      manifest: {
        name: 'TestLib2',
        version: '1.0.0',
        namespace: 'testlib2',
        functions: [],
        functionBlocks: [],
        types: [],
        headers: ['foo.h'],
        isBuiltin: false,
        dependencies: [],
      },
      chunks: [],
      dependencies: [],
    };

    const result = compile(
      'PROGRAM Main VAR x : INT; END_VAR x := 1; END_PROGRAM',
      { isTestBuild: true, libraries: [archive] },
    );
    expect(result.success).toBe(true);
  });
});
