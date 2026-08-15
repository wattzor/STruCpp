import { describe, it, expect, vi, beforeAll } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCodesysLibraryFromFile } from '../../src/node/codesys-import.js';
import { state } from './fs-codesys-mock-state.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: (...args: any[]) => state.readFileSync!(...args),
  };
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(
  __dirname,
  '../fixtures/codesys/oscat_basic_335.lib',
);

describe('importCodesysLibraryFromFile', () => {
  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    state.readFileSync = actual.readFileSync.bind(actual);
  });

  it('returns an error for a missing file', async () => {
    const result = await importCodesysLibraryFromFile('/nonexistent/path.lib');
    expect(result.success).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Cannot read file');
  });

  it('imports a valid CODESYS .lib file from disk', async () => {
    const result = await importCodesysLibraryFromFile(fixturePath);
    expect(result.success).toBe(true);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.metadata.pouCount).toBeGreaterThan(0);
  });

  it('handles non-Error readFileSync throws', async () => {
    state.readFileSync = () => {
      throw 'plain string error';
    };
    const result = await importCodesysLibraryFromFile('/some/path.lib');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('plain string error');
  });
});
