import { describe, expect, it } from 'vitest';
import { SQLITE_API_CONFIG } from '../src/engine/sqlite';

describe('sqlite-wasm VFS configuration', () => {
  it('disables only the unused async-proxy VFSes (their auto-install logs errors on chrome://extensions); opfs-sahpool stays enabled', () => {
    expect(SQLITE_API_CONFIG.disable.vfs).toEqual({ opfs: true, 'opfs-wl': true });
    expect(Object.keys(SQLITE_API_CONFIG.disable.vfs)).not.toContain('opfs-sahpool');
    expect((globalThis as unknown as { sqlite3ApiConfig?: unknown }).sqlite3ApiConfig).toBe(SQLITE_API_CONFIG);
  });
});
