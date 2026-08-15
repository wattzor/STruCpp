// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readdirSync: vi.fn(),
  __esModule: true,
}));

describe('discoverSTFiles Dirent fallbacks', () => {
  it('uses entry.path and then resolvedDir when parentPath is absent', async () => {
    const { readdirSync } = await import('node:fs');
    const mockedReaddir = vi.mocked(readdirSync);
    mockedReaddir.mockReturnValueOnce([
      { name: 'a.st', isFile: () => true, parentPath: undefined, path: '/tmp/dir' } as unknown as import('node:fs').Dirent,
      { name: 'b.il', isFile: () => true, parentPath: undefined, path: undefined } as unknown as import('node:fs').Dirent,
      { name: 'c.txt', isFile: () => true } as unknown as import('node:fs').Dirent,
    ]);

    const { discoverSTFiles } = await import('../../src/node/library-utils.js');
    const result = discoverSTFiles('/tmp/dir');
    expect(result).toEqual(['/tmp/dir/a.st', '/tmp/dir/b.il']);
  });
});
