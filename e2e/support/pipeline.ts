// Helpers for the history-pipeline e2e tests: launch with a given profile, talk to the service worker like UI code does.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { EngineCall, EngineResults } from '../../src/engine/contract';
import type { PipelineStatus } from '../../src/background/pipeline/controller';
import { E2E_EXTENSION_DIR, EXTENSION_DIR, openExtensionPage } from '../fixtures';
import type { FixtureServer } from '../fixtures-server';

/**
 * `e2e: true` loads the e2e build (host permission for http://fixture.test/*) and maps fixture.test to the local fixture server, so
 * activeTab-style extraction and Deep Search capture can be exercised without the permission prompt Playwright cannot click.
 */
export async function launchExtension(userDataDir: string, opts: { e2e?: boolean; debugPort?: number } = {}): Promise<{ context: BrowserContext; extensionId: string }> {
  const dir = opts.e2e ? E2E_EXTENSION_DIR : EXTENSION_DIR;
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: false,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, '--no-sandbox', ...(opts.e2e ? ['--host-resolver-rules=MAP fixture.test 127.0.0.1'] : []), ...(opts.debugPort ? [`--remote-debugging-port=${opts.debugPort}`] : [])],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  return { context, extensionId: new URL(worker.url()).host };
}

/** An extension page to send messages from (the search page: it only pings the engine, it never grants consent). */
export async function toolPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await openExtensionPage(context, extensionId, 'search.html');
  await expect(page.locator('[data-engine-state="ready"]')).toBeVisible();
  return page;
}

type Ok<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export async function engine<C extends EngineCall>(page: Page, call: C): Promise<EngineResults[C['method']]> {
  const r = (await page.evaluate((c) => chrome.runtime.sendMessage({ type: 'sw/engine', call: c }), call as never)) as Ok<EngineResults[C['method']]>;
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.data;
}

export async function status(page: Page): Promise<PipelineStatus> {
  const r = (await page.evaluate(() => chrome.runtime.sendMessage({ type: 'sw/pipeline-status' }))) as Ok<PipelineStatus>;
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

export const urls = async (page: Page, query: string): Promise<string[]> => (await engine(page, { method: 'search', params: { query, now: Date.now() } })).results.map((r) => r.url);

export function seedHistory(profileDir: string, bulk: number, ancient: number): void {
  execFileSync('python3', [join(import.meta.dirname, 'seed-history.py'), profileDir, String(bulk), String(ancient)]);
}

/** The fixture server as seen from the e2e build: http://fixture.test:<port> */
export const fixtureOrigin = (server: FixtureServer): string => server.origin.replace('127.0.0.1', 'fixture.test');

export async function send<T = unknown>(page: Page, message: object): Promise<Ok<T>> {
  return (await page.evaluate((m) => chrome.runtime.sendMessage(m), message as never)) as Ok<T>;
}

export const tabIdOf = (page: Page, url: string): Promise<number | undefined> => page.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);

/** A free local TCP port (for --remote-debugging-port). */
export async function freePort(): Promise<number> {
  const { createServer } = await import('node:net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export interface CdpTarget {
  type: string;
  url: string;
  title: string;
}

/** Every browser target (windows, popups, workers, error pages) as the browser itself reports it: what a user would see. */
export async function cdpTargets(port: number): Promise<CdpTarget[]> {
  const { get } = await import('node:http');
  return new Promise((resolve, reject) => {
    get(`http://127.0.0.1:${port}/json`, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve(JSON.parse(body) as CdpTarget[]));
    }).on('error', reject);
  });
}
