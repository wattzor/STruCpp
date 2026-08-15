// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2025 Autonomy / OpenPLC Project
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  __esModule: true,
}));

describe('importCodesysLibraryFromFile error formatting', () => {
  it('stringifies non-Error throws', async () => {
    const { readFileSync } = await import('node:fs');
    const mockedRead = vi.mocked(readFileSync);
    mockedRead.mockImplementationOnce(() => {
      throw 'plain string error';
    });

    const { importCodesysLibraryFromFile } = await import(
      '../../src/node/codesys-import.js'
    );
    const result = await importCodesysLibraryFromFile('/tmp/dummy.lib');
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('plain string error');
  });
});
