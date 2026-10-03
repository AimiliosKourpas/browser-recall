// Shared Playwright helpers for the M0 browser spikes.
import { chromium } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export const here = dirname(fileURLToPath(import.meta.url));
export const CHROMIUM = process.env.CHROMIUM_PATH ?? execSync('ls -d /opt/pw-browsers/chromium-*/chrome-linux*/chrome | head -1').toString().trim();

/** Launch headed Chromium (run under xvfb-run) with one or more unpacked extensions. */
export async function launch({ exts, userDataDir, args = [] }) {
  const dir = userDataDir ?? mkdtempSync(join(tmpdir(), 'br-m0-'));
  mkdirSync(dir, { recursive: true });
  const list = exts.map((e) => resolve(here, 'dist', e)).join(',');
  const ctx = await chromium.launchPersistentContext(dir, {
    executablePath: CHROMIUM,
    headless: false,
    args: [`--disable-extensions-except=${list}`, `--load-extension=${list}`, '--no-sandbox', ...args],
    viewport: { width: 1100, height: 800 },
  });
  return { ctx, dir };
}

export async function extensionIds(ctx, count = 1) {
  const ids = new Set();
  const deadline = Date.now() + 15000;
  while (ids.size < count && Date.now() < deadline) {
    for (const w of ctx.serviceWorkers()) ids.add(new URL(w.url()).host);
    if (ids.size < count) await new Promise((r) => setTimeout(r, 200));
  }
  return [...ids];
}

/** A page on the extension origin from which chrome.* is callable; returns a `call` helper that talks to the SW. */
export async function benchPage(ctx, id) {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/bench.html`);
  await page.waitForFunction(() => window.__ready === true);
  const sw = (msg) => page.evaluate((m) => chrome.runtime.sendMessage({ target: 'sw', ...m }), msg);
  const engine = async (cmd, args = {}) => {
    const r = await sw({ cmd: 'engine', engineCmd: cmd, args });
    if (r?.error) throw new Error(r.error);
    if (!r?.ok) throw new Error(`engine ${cmd} failed: ${JSON.stringify(r)}`);
    return r.result;
  };
  return { page, sw, engine };
}

/** RSS (MB) of all renderer processes that host extension contexts (SW, offscreen, extension pages). */
export function extensionRssMB() {
  const out = execSync("ps -eo rss,args | grep -E 'chrom' | grep -E -- '--extension-process' | grep -v grep || true").toString();
  return out
    .split('\n')
    .filter(Boolean)
    .reduce((a, l) => a + parseInt(l.trim().split(/\s+/)[0], 10) / 1024, 0);
}
export function totalChromeRssMB() {
  const out = execSync("ps -eo rss,args | grep -i chrom | grep -v grep | grep -v 'ps -eo' || true").toString();
  return out.split('\n').filter(Boolean).reduce((a, l) => a + parseInt(l.trim().split(/\s+/)[0], 10) / 1024, 0);
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmt = (o) => JSON.stringify(o);

// Minimal PNG pixel reader (8-bit, non-interlaced RGB/RGBA) so tests can assert what is actually painted.
import { inflateSync } from 'node:zlib';
export function pngPixel(buf, x, y) {
  let off = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = Buffer.alloc(stride * h);
  for (let r = 0; r < h; r++) {
    const f = raw[r * (stride + 1)];
    for (let c = 0; c < stride; c++) {
      const v = raw[r * (stride + 1) + 1 + c];
      const a = c >= bpp ? px[r * stride + c - bpp] : 0;
      const b = r > 0 ? px[(r - 1) * stride + c] : 0;
      const cc = r > 0 && c >= bpp ? px[(r - 1) * stride + c - bpp] : 0;
      let out;
      if (f === 0) out = v; else if (f === 1) out = v + a; else if (f === 2) out = v + b; else if (f === 3) out = v + ((a + b) >> 1);
      else { const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc); out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc); }
      px[r * stride + c] = out & 255;
    }
  }
  const i = y * stride + x * bpp;
  return [px[i], px[i + 1], px[i + 2]];
}
