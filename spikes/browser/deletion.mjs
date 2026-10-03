// What does history.onVisitRemoved report for each kind of user-initiated deletion?
import { launch, extensionIds, benchPage, sleep, fmt } from './harness.mjs';

const { ctx } = await launch({ exts: ['test'] });
const [id] = await extensionIds(ctx);
const b = await benchPage(ctx, id);
const add = (url) => b.sw({ cmd: 'history-add', urls: [{ url }] });
const events = async () => (await b.sw({ cmd: 'events' })).filter((e) => e.kind === 'removed').map((e) => e.data);
const rows = async () => (await b.sw({ cmd: 'history-search', query: { text: 'del-', startTime: 0, maxResults: 100 } })).map((r) => r.url);
const reset = async () => { await b.sw({ cmd: 'clear-events' }); };
const step = async (name, fn) => {
  await reset();
  await fn();
  await sleep(1200);
  console.log(fmt({ case: name, events: await events(), rowsLeft: (await rows()).length }));
};

for (const n of ['a', 'b', 'c']) { await add(`https://del-${n}.example/`); await sleep(1100); }
await step('history.deleteUrl(a)', () => b.sw({ cmd: 'history-delete-url', url: 'https://del-a.example/' }));

// deleteRange around one URL's single visit
const rowB = (await b.sw({ cmd: 'history-search', query: { text: 'del-b', startTime: 0, maxResults: 5 } }))[0];
await step('history.deleteRange(window around b)', () => b.sw({ cmd: 'history-delete-range', startTime: rowB.lastVisitTime - 500, endTime: rowB.lastVisitTime + 500 }));

// partial: URL with two visits, range covers only the newer visit
await add('https://del-two.example/'); await sleep(1500); const mid = Date.now(); await sleep(1500); await add('https://del-two.example/'); await sleep(500);
await step('history.deleteRange(only newest of 2 visits of one URL)', () => b.sw({ cmd: 'history-delete-range', startTime: mid, endTime: Date.now() + 5000 }));
const two = await b.sw({ cmd: 'history-search', query: { text: 'del-two', startTime: 0, maxResults: 5 } });
console.log(fmt({ afterPartialDelete: { urlStillPresent: two.length === 1, visitCount: two[0]?.visitCount } }));

await add('https://del-c2.example/'); await sleep(1100);
await step('browsingData.removeHistory({since:0}) (what "Clear browsing data" calls)', () => b.sw({ cmd: 'browsing-data-clear', since: 0 }));
await add('https://del-d.example/'); await sleep(1100);
await step('history.deleteAll()', () => b.sw({ cmd: 'history-delete-all' }));
await ctx.close();
process.exit(0);
