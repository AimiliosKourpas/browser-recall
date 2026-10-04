import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIR = '.output/chrome-mv3';
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

describe.skipIf(!existsSync(DIR))('release package (.output/chrome-mv3)', () => {
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, unknown> & { icons?: Record<string, string> };

  it('declares the required icons and every icon is a real square PNG of its size', () => {
    const icons = manifest.icons ?? {};
    for (const size of ['16', '48', '128']) {
      const path = icons[size];
      expect(path, `manifest.icons["${size}"] is missing: put public/icons/${size}.png in the repository and rebuild`).toBeTypeOf('string');
      const file = join(DIR, path as string);
      expect(existsSync(file), file).toBe(true);
      const png = readFileSync(file);
      expect(png.subarray(0, 8).toString('hex'), `${file} is not a PNG`).toBe('89504e470d0a1a0a');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], `${file} has the wrong dimensions`).toEqual([Number(size), Number(size)]);
    }
  });
  it('contains no source maps, tests, fixtures, env files or markdown', () => {
    const bad = files(DIR).filter((f) => /\.map$|e2e|fixture|\.test\.|\.spec\.|\.env|\.md$|node_modules/i.test(f));
    expect(bad).toEqual([]);
  });
  it('declares no required host access, content scripts or remote-code surface', () => {
    for (const key of ['host_permissions', 'content_scripts', 'externally_connectable', 'update_url', 'sandbox']) expect(manifest, key).not.toHaveProperty(key);
    expect(String((manifest.content_security_policy as { extension_pages: string }).extension_pages)).not.toMatch(/(?<!wasm-)unsafe-eval|unsafe-inline|https?:/);
  });
});
