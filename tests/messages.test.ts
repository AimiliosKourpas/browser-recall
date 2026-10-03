import { describe, expect, it } from 'vitest';
import { acceptMessage } from '../src/background/router';
import { engineMessageSchema, ensureEngineResultSchema, isOwnExtension, isTrustedExtensionPage } from '../src/shared/messages';

const ID = 'abcdefghijklmnopabcdefghijklmnop';
const page = { id: ID, url: `chrome-extension://${ID}/search.html` };

describe('sender trust', () => {
  it('trusts only our own extension pages', () => {
    expect(isTrustedExtensionPage(page, ID)).toBe(true);
    expect(isTrustedExtensionPage({ id: 'other', url: `chrome-extension://other/x.html` }, ID)).toBe(false);
    expect(isTrustedExtensionPage({ id: ID, url: 'https://evil.example/' }, ID)).toBe(false); // e.g. a content script / web page claiming our id
    expect(isTrustedExtensionPage({ id: ID }, ID)).toBe(false);
    expect(isTrustedExtensionPage({ id: ID, url: `chrome-extension://${ID}.evil/x` }, ID)).toBe(false);
  });
  it('isOwnExtension checks id only', () => {
    expect(isOwnExtension({ id: ID }, ID)).toBe(true);
    expect(isOwnExtension({ id: 'x' }, ID)).toBe(false);
    expect(isOwnExtension({}, ID)).toBe(false);
  });
});

describe('acceptMessage (service worker gate)', () => {
  it('accepts valid messages from our pages', () => {
    expect(acceptMessage({ type: 'sw/ensure-engine' }, page, ID)).toEqual({ type: 'sw/ensure-engine' });
    expect(acceptMessage({ type: 'sw/open-search' }, page, ID)).toEqual({ type: 'sw/open-search' });
    const search = { type: 'sw/engine', call: { method: 'search', params: { query: 'x' } } };
    expect(acceptMessage(search, page, ID)).toEqual(search);
  });
  it('validates engine call params at the gate and trusts only our pages for them', () => {
    expect(acceptMessage({ type: 'sw/engine', call: { method: 'search', params: { query: 5 } } }, page, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/engine', call: { method: 'deleteEverything' } }, { id: ID, url: 'https://evil.example/' }, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/engine', call: { method: 'deleteEverything' } }, { id: 'other', url: 'chrome-extension://other/x.html' }, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/engine', call: { method: 'raw-sql', params: { sql: 'DROP' } } }, page, ID)).toBeUndefined();
  });
  it('rejects unknown shapes, extra junk types, and untrusted senders', () => {
    expect(acceptMessage({ type: 'sw/delete-everything' }, page, ID)).toBeUndefined();
    expect(acceptMessage('sw/ensure-engine', page, ID)).toBeUndefined();
    expect(acceptMessage(null, page, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/ensure-engine' }, { id: ID, url: 'https://evil.example/' }, ID)).toBeUndefined();
    expect(acceptMessage({ type: 'sw/ensure-engine' }, { id: 'other', url: `chrome-extension://other/a.html` }, ID)).toBeUndefined();
  });
});

describe('schemas', () => {
  it('engine message requires target and type', () => {
    expect(engineMessageSchema.safeParse({ target: 'engine', type: 'engine/call', call: { method: 'ping' } }).success).toBe(true);
    expect(engineMessageSchema.safeParse({ type: 'engine/call', call: { method: 'ping' } }).success).toBe(false);
    expect(engineMessageSchema.safeParse({ target: 'engine', type: 'engine/call', call: { method: 'drop-db' } }).success).toBe(false);
    expect(engineMessageSchema.safeParse({ target: 'engine', type: 'engine/ping' }).success).toBe(false);
  });
  it('result envelope validates both arms and rejects mixed shapes', () => {
    expect(ensureEngineResultSchema.safeParse({ ok: true, data: { protocol: 1, instanceId: 'a' } }).success).toBe(true);
    expect(ensureEngineResultSchema.safeParse({ ok: false, error: { code: 'engine-unavailable', message: 'x' } }).success).toBe(true);
    expect(ensureEngineResultSchema.safeParse({ ok: true, data: { protocol: 2, instanceId: 'a' } }).success).toBe(false);
    expect(ensureEngineResultSchema.safeParse({ ok: true }).success).toBe(false);
  });
});
