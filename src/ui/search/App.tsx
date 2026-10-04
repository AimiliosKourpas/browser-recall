import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchResponse, SearchResult, Stats } from '../../engine/model';
import { engineCall } from '../../shared/engine-api';
import { t } from '../../shared/i18n';
import { ensureEngineResultSchema, pipelineStatusResultSchema } from '../../shared/messages';
import type { PipelineStatus } from '../../background/pipeline/controller';
import { avatar, displayUrl, relativeTime, resultHref, splitHighlights } from './format';
import { actionForKey, moveIndex, toggleToken } from './keys';

type Ready = 'starting' | 'ready' | 'error';
const DEBOUNCE_MS = 30;

const CHIPS: { token: string; label: () => string; group?: string[] }[] = [
  { token: 'when:today', label: () => t('chipToday'), group: ['when:week', 'when:month'] },
  { token: 'when:week', label: () => t('chipWeek'), group: ['when:today', 'when:month'] },
  { token: 'when:month', label: () => t('chipMonth'), group: ['when:today', 'when:week'] },
  { token: 'is:saved', label: () => t('chipSaved') },
  { token: 'is:snippet', label: () => t('chipSnippets') },
];

function Marked({ text, ranges }: { text: string; ranges: [number, number][] }) {
  return (
    <>
      {splitHighlights(text, ranges).map((p, i) => (p.mark ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

function timeLabel(timestamp: number, now: number): string {
  const r = relativeTime(timestamp, now);
  return r.unit === 'now' ? t('timeNow') : r.unit === 'minutes' ? t('timeMinutes', String(r.n)) : r.unit === 'hours' ? t('timeHours', String(r.n)) : r.unit === 'days' ? t('timeDays', String(r.n)) : t('timeMonths', String(r.n));
}

function Row({ r, selected, id, now, onPick, onOpen }: { r: SearchResult; selected: boolean; id: string; now: number; onPick: () => void; onOpen: () => void }) {
  const { domain, path } = displayUrl(r.url);
  const av = avatar(domain);
  return (
    <li id={id} role="option" aria-selected={selected} class={`row${selected ? ' selected' : ''}`} onMouseMove={onPick} onClick={onOpen}>
      <span class="avatar" aria-hidden="true" style={`background:hsl(${av.hue} 45% 38%)`}>
        {av.letter}
      </span>
      <span class="body">
        <span class="title">
          <Marked text={r.title || r.url} ranges={r.title ? r.titleHighlights : []} />
          {r.flags.saved && r.kind === 'page' && <span class="badge">{t('badgeSaved')}</span>}
          {r.kind === 'snippet' && <span class="badge">{t('badgeSnippet')}</span>}
        </span>
        <span class="meta">
          {domain}
          {path && <span class="path"> {path}</span>} · <time dateTime={new Date(r.timestamp).toISOString()} title={new Date(r.timestamp).toLocaleString()}>{timeLabel(r.timestamp, now)}</time>
        </span>
        <span class="snippet">{r.snippet ? <Marked text={r.snippet.text} ranges={r.snippet.highlights} /> : r.matchKind === 'title-url' ? t('matchTitleUrl') : ''}</span>
      </span>
    </li>
  );
}

export function App() {
  const [ready, setReady] = useState<Ready>('starting');
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse | undefined>();
  const [searching, setSearching] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [pipeline, setPipeline] = useState<PipelineStatus | undefined>();
  const [stats, setStats] = useState<Stats | undefined>();
  const [copied, setCopied] = useState(false);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const filters = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    chrome.runtime.sendMessage({ type: 'sw/ensure-engine' }).then(
      (raw: unknown) => !cancelled && setReady(ensureEngineResultSchema.safeParse(raw).data?.ok ? 'ready' : 'error'),
      () => !cancelled && setReady('error'),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // index status footer: pipeline progress + page count, refreshed while the page is open
  useEffect(() => {
    if (ready !== 'ready') return;
    let stop = false;
    const tick = async () => {
      try {
        const raw: unknown = await chrome.runtime.sendMessage({ type: 'sw/pipeline-status' });
        const parsed = pipelineStatusResultSchema.safeParse(raw);
        if (!stop && parsed.success && parsed.data.ok) setPipeline(parsed.data.data);
        const s = await engineCall({ method: 'stats' });
        if (!stop) setStats(s);
      } catch {
        /* the footer is informational only */
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [ready]);

  const run = useCallback((q: string) => {
    const mine = ++seq.current; // stale responses are discarded
    if (!q.trim()) {
      setResponse(undefined);
      setSearching(false);
      setFailed(false);
      return;
    }
    setSearching(true);
    engineCall({ method: 'search', params: { query: q, now: Date.now(), tzOffsetMinutes: -new Date().getTimezoneOffset() } }).then(
      (r) => {
        if (mine !== seq.current) return;
        setResponse(r);
        setSelected(0);
        setNow(Date.now());
        setFailed(false);
        setSearching(false);
      },
      () => {
        if (mine !== seq.current) return;
        setFailed(true);
        setSearching(false);
      },
    );
  }, []);

  useEffect(() => {
    if (ready === 'starting') return;
    const timer = setTimeout(() => run(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, ready, run]);

  useEffect(() => {
    document.getElementById(`opt-${selected}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [selected, response]);

  const results = response?.results ?? [];
  const exact = useMemo(() => results.filter((r) => !r.approximate), [results]);
  const approx = useMemo(() => results.filter((r) => r.approximate), [results]);
  const current = results[selected];

  const open = (r: SearchResult | undefined, active: boolean, closeWindow: boolean) => {
    if (!r) return;
    void chrome.tabs.create({ url: resultHref(r), active }).then(() => {
      if (closeWindow) window.close();
    });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const action = actionForKey({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, isComposing: e.isComposing }, results.length > 0);
    if (action.kind === 'none') return;
    e.preventDefault();
    if (action.kind === 'move') setSelected((s) => moveIndex(s, action.delta, results.length));
    else if (action.kind === 'open') open(current, action.active, action.closeWindow);
    else if (action.kind === 'close') window.close();
    else if (action.kind === 'focus-filters') filters.current?.querySelector('button')?.focus();
  };

  const forget = async (r: SearchResult) => {
    if (r.kind === 'page') await engineCall({ method: 'deleteUrls', params: { urls: [r.url] } });
    run(query);
  };
  const copy = async (r: SearchResult) => {
    await navigator.clipboard.writeText(r.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasQuery = query.trim().length > 0;
  const needsSetup = pipeline !== undefined && pipeline.consent !== 'granted';
  const listbox = (rows: SearchResult[], offset: number) => (
    <ul role="presentation" class="results">
      {rows.map((r, i) => (
        <Row key={`${r.kind}-${r.id}`} id={`opt-${offset + i}`} r={r} selected={offset + i === selected} now={now} onPick={() => setSelected(offset + i)} onOpen={() => open(r, true, true)} />
      ))}
    </ul>
  );

  return (
    <main class="search" data-engine-state={ready}>
      <input
        ref={input}
        id="q"
        type="search"
        role="combobox"
        aria-label={t('searchInputLabel')}
        aria-expanded={results.length > 0}
        aria-controls="results"
        aria-activedescendant={current ? `opt-${selected}` : undefined}
        placeholder={t('searchPlaceholder')}
        autocomplete="off"
        spellcheck={false}
        autofocus
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        onKeyDown={onKeyDown}
      />
      <div class="chips" role="group" aria-label={t('filtersLabel')} ref={filters}>
        {CHIPS.map((c) => (
          <button key={c.token} type="button" class="chip" aria-pressed={query.split(/\s+/).includes(c.token)} onClick={() => { setQuery((q) => toggleToken(q, c.token, c.group)); input.current?.focus(); }}>
            {c.label()}
          </button>
        ))}
      </div>

      {needsSetup && (
        <div class="notice" role="note">
          <span>{t('searchSetupNeeded')}</span>{' '}
          <button type="button" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/onboarding.html') })}>
            {t('searchSetupButton')}
          </button>
        </div>
      )}

      <p class="sr-only" role="status" aria-live="polite">
        {searching ? t('searchWorking') : hasQuery && response ? t('searchResultsCount', String(results.length)) : ''}
      </p>

      {(ready === 'error' || failed) && (
        <div class="notice" role="alert">
          <span>{t('searchError')}</span>{' '}
          <button type="button" onClick={() => run(query)}>
            {t('searchRetry')}
          </button>
        </div>
      )}

      {response && response.suggestions.length > 0 && (
        <p class="suggest">
          {t('searchDidYouMean')}{' '}
          {response.suggestions.map((s) => (
            <button key={s.term} type="button" class="link" onClick={() => setQuery((q) => q.replace(new RegExp(s.term, 'i'), s.replacement))}>
              {s.replacement}
            </button>
          ))}
          ?
        </p>
      )}

      <div id="results" role="listbox" aria-label={t('searchResultsLabel')} class="listbox">
        {listbox(exact, 0)}
        {approx.length > 0 && (
          <>
            <h2 class="approx">{t('searchApproximate')}</h2>
            {listbox(approx, exact.length)}
          </>
        )}
      </div>

      {!hasQuery && !failed && <p class="hint">{t('searchHint')}</p>}
      {hasQuery && !searching && !failed && response && results.length === 0 && (
        <div class="empty">
          <strong>{t('searchNoResults')}</strong>
          <p>{t('searchNoResultsHint')}</p>
        </div>
      )}

      {current && (
        <div class="actions" role="toolbar" aria-label={t('actionsLabel')}>
          <button type="button" onClick={() => void copy(current)}>
            {copied ? t('actionCopied') : t('actionCopy')}
          </button>
          {current.kind === 'page' && current.flags.history && (
            <button type="button" onClick={() => void forget(current)}>
              {t('actionForget')}
            </button>
          )}
        </div>
      )}

      <footer class="footer">
        {stats ? t('footerPages', String(stats.pages)) : ''}
        {pipeline && pipeline.consent === 'granted' ? ` · ${pipeline.importStatus === 'complete' ? t('footerUpToDate') : t('footerImporting', String(Math.round(pipeline.progress * 100)))}` : ''}
      </footer>
    </main>
  );
}
