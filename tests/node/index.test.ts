import { describe, it, expect } from 'vitest';

describe('node entry point exports', () => {
  it('exports filesystem-backed helpers and the compiler surface', async () => {
    const mod = await import('../../src/node/index.js');
    expect(typeof mod.compile).toBe('function');
    expect(typeof mod.getVersion).toBe('function');
    expect(typeof mod.discoverSTFiles).toBe('function');
    expect(typeof mod.importCodesysLibraryFromFile).toBe('function');
    expect(typeof mod.loadLibraryConfig).toBe('function');
  });
});
