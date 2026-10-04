import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIONAL_HOST_PERMISSIONS, OVERLAY_RESOURCES, PERMISSIONS, buildManifest } from '../src/manifest';

const doc = (name: string) => readFileSync(join(import.meta.dirname, '../docs', name), 'utf8');
const firstColumn = (markdown: string, heading: string): string[] => {
  const section = markdown.split(/^## /m).find((s) => s.startsWith(heading)) ?? '';
  return [...section.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1] as string);
};

describe('policy ↔ manifest consistency', () => {
  const permissions = doc('PERMISSIONS.md');
  it('PERMISSIONS.md lists exactly the manifest permissions', () => {
    expect(firstColumn(permissions, 'Required permissions').sort()).toEqual([...PERMISSIONS].sort());
    expect(firstColumn(permissions, 'Required permissions').sort()).toEqual([...buildManifest().permissions].sort());
  });
  it('PERMISSIONS.md lists exactly the optional host permissions and the one web-accessible resource', () => {
    expect(firstColumn(permissions, 'Optional host permissions').sort()).toEqual([...OPTIONAL_HOST_PERMISSIONS].sort());
    expect(permissions).toContain(`\`${OVERLAY_RESOURCES[0]}\` only`);
  });
  it('states that no host permission is required and that the CSP matches the manifest', () => {
    expect(permissions).toMatch(/no required host access/);
    expect(permissions).toContain(buildManifest().content_security_policy.extension_pages);
  });
  it('the privacy policy makes the central claims and links the permissions document', () => {
    const policy = doc('PRIVACY-POLICY.md');
    for (const claim of ['no analytics', 'no remote AI', 'does not encrypt', 'Deep Search', 'optional', 'Limited Use', 'PERMISSIONS.md']) expect(policy).toContain(claim);
  });
});
