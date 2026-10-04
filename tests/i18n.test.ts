import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogue, createT } from '../src/shared/i18n';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
  });
}

describe('i18n catalogue', () => {
  it('every entry has a non-empty message and description', () => {
    for (const [key, entry] of Object.entries(catalogue)) {
      expect(entry.message.length, key).toBeGreaterThan(0);
      expect(entry.description.length, key).toBeGreaterThan(0);
    }
  });
  it('every t("key") used in src exists in the catalogue, and every catalogue key is used', () => {
    const used = new Set<string>();
    for (const file of sourceFiles('src')) for (const m of readFileSync(file, 'utf8').matchAll(/(?:\bt|getMessage)\('([A-Za-z]+)'[,)]/g)) used.add(m[1] as string);
    const manifest = readFileSync('src/manifest.ts', 'utf8');
    for (const m of manifest.matchAll(/__MSG_(\w+)__/g)) used.add(m[1] as string);
    const keys = Object.keys(catalogue);
    expect([...used].filter((k) => !keys.includes(k))).toEqual([]);
    expect(keys.filter((k) => !used.has(k))).toEqual([]);
  });
  it('falls back to English when chrome.i18n returns nothing', () => {
    expect(createT(() => undefined)('extName')).toBe('Browser Recall');
    expect(createT(() => 'Εφαρμογή')('extName')).toBe('Εφαρμογή');
  });
});
