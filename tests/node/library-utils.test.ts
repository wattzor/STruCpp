import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverSTFiles } from '../../src/node/library-utils.js';

describe('discoverSTFiles', () => {
  it('finds .st and .il files recursively', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strucpp-lib-'));
    try {
      writeFileSync(join(dir, 'a.st'), '');
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'sub', 'b.il'), '');
      writeFileSync(join(dir, 'sub', 'c.txt'), '');

      const result = discoverSTFiles(dir);
      expect(result).toEqual([join(dir, 'a.st'), join(dir, 'sub', 'b.il')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns an empty array for a directory with no .st/.il files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strucpp-lib-'));
    try {
      writeFileSync(join(dir, 'readme.txt'), '');
      expect(discoverSTFiles(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
