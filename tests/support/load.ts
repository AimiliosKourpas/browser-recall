import type { SearchStore } from '../../src/engine/store';
import type { SynthDoc } from './corpus';

/** Loads a synthetic corpus the way production does: history rows, then Deep Search content, in batches. */
export function loadCorpus(store: SearchStore, docs: SynthDoc[], batch = 250): void {
  for (let i = 0; i < docs.length; i += batch) {
    const slice = docs.slice(i, i + batch);
    store.upsertHistory(slice.map((d) => ({ url: d.url, title: d.title, lastVisitTime: d.lastVisit, visitCount: d.visitCount })));
    for (const d of slice) store.upsertContent({ url: d.url, headings: d.headings, description: d.description, body: d.body, indexedAt: d.lastVisit });
  }
}
