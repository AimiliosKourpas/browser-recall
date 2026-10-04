// Helpers for the history-pipeline e2e tests: launch with a given profile, talk to the service worker like UI code does.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import type { EngineCall, EngineResults } from '../../src/engine/contract';
import type { PipelineStatus } from '../../src/background/pipeline/controller';
import { EXTENSION_DIR, openExtensionPage } from '../fixtures';

export async function launchExtension(userDataDir: string): Promise<{ context: BrowserContext; extensionId: string }> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--no-sandbox'],
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
