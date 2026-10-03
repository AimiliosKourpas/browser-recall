import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildManifest } from '../../src/manifest';

const DIR = '.output/chrome-mv3';
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : [join(dir, n)]));

// URLs that are namespace identifiers or inert comments inside bundled libraries, not network targets.
// zod embeds JSON-Schema meta-schema identifiers and an IPv6 URL-validation template; sqlite-wasm has a documentation link in an error message. None is ever fetched.
const ALLOWED_URL = [/^https:\/\/sqlite\.org\/wasm\/doc\//, /^https?:\/\/www\.w3\.org\//, /^https?:\/\/json-schema\.org\//, /^http:\/\/\[\$\{/, /^https?:\/\/(?:github\.com|zod\.dev|preactjs\.com)\//];

describe.skipIf(!existsSync(DIR))('built extension', () => {
  const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  it('built manifest matches the source-of-truth permissions, hosts and CSP', () => {
    const expected = buildManifest();
    expect(manifest.permissions).toEqual(expected.permissions);
    expect(manifest.optional_host_permissions).toEqual(expected.optional_host_permissions);
    expect(manifest.content_security_policy).toEqual(expected.content_security_policy);
    expect(manifest.minimum_chrome_version).toBe(expected.minimum_chrome_version);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest.manifest_version).toBe(3);
  });
  it('contains the expected entrypoints', () => {
    for (const f of ['background.js', 'engine-worker.js', 'offscreen.html', 'search.html', 'onboarding.html', '_locales/en/messages.json']) expect(existsSync(join(DIR, f)), f).toBe(true);
  });
  it('every i18n key referenced by the manifest exists in the built catalogue', () => {
    const catalogue = JSON.parse(readFileSync(join(DIR, '_locales/en/messages.json'), 'utf8')) as Record<string, unknown>;
    for (const m of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) expect(catalogue).toHaveProperty(m[1] as string);
  });
  it('HTML pages load only local scripts and no inline script or inline style attribute', () => {
    for (const f of files(DIR).filter((p) => p.endsWith('.html'))) {
      const html = readFileSync(f, 'utf8');
      expect(html, f).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>[^<]/i);
      expect(html, f).not.toMatch(/\son\w+=/i);
      expect(html, f).not.toMatch(/(?:src|href)=["']?(?:https?:)?\/\//i);
    }
  });
  it('no bundled file references a remote URL (outside namespace/doc allowlist) or uses eval-like constructs', () => {
    const offenders: string[] = [];
    for (const f of files(DIR).filter((p) => /\.(js|html|css)$/.test(p))) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) if (!ALLOWED_URL.some((re) => re.test(m[0]))) offenders.push(`${f}: ${m[0]}`);
      if (/\beval\(|new Function\(/.test(text)) offenders.push(`${f}: eval-like`);
    }
    expect(offenders).toEqual([]);
  });
});
