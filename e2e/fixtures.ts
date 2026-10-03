// Playwright fixtures: a persistent Chromium context with the BUILT extension loaded, the extension id, and a fixture server.
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startFixtureServer, type FixtureServer } from './fixtures-server';

export const EXTENSION_DIR = resolve(import.meta.dirname, '../.output/chrome-mv3');

interface Fixtures {
  context: BrowserContext;
  extensionId: string;
  server: FixtureServer;
  serviceWorker: () => Promise<Worker>;
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'br-e2e-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      headless: false,
      args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`, '--no-sandbox'],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    worker ??= await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
  // eslint-disable-next-line no-empty-pattern
  server: async ({}, use) => {
    const server = await startFixtureServer();
    await use(server);
    await server.close();
  },
  serviceWorker: async ({ context }, use) => {
    await use(async () => context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker')));
  },
});

export { expect } from '@playwright/test';

export async function openExtensionPage(context: BrowserContext, extensionId: string, path: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/${path}`);
  return page;
}
