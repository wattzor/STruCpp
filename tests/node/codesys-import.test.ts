import { describe, it, expect } from 'vitest';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importCodesysLibraryFromFile } from '../../src/node/codesys-import.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fixturePath = resolve(
  __dirname,
  '../fixtures/codesys/oscat_basic_335.lib',
);

describe('importCodesysLibraryFromFile', () => {
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
});
