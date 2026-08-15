import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverSTFiles } from '../../src/node/library-utils.js';
import { state } from './fs-mock-state.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readdirSync: (...args: any[]) => state.readdirSync!(...args),
  };
});

describe('discoverSTFiles', () => {
  beforeAll(async () => {
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
    state.readdirSync = actual.readdirSync.bind(actual);
  });

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

  it('falls back to entry.path and resolvedDir when parentPath is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'strucpp-lib-'));
    try {
      state.readdirSync = () => [
        { name: 'via-path.st', isFile: () => true, path: dir } as any,
        { name: 'via-dir.st', isFile: () => true } as any,
      ];

      const result = discoverSTFiles(dir);
      expect(result).toEqual([
        join(dir, 'via-dir.st'),
        join(dir, 'via-path.st'),
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
