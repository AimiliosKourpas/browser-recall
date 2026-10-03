import { useEffect, useState } from 'preact/hooks';
import { ensureEngineResultSchema } from '../../shared/messages';
import { t } from '../../shared/i18n';

type EngineState = 'starting' | 'ready' | 'error';

export function App() {
  const [state, setState] = useState<EngineState>('starting');
  useEffect(() => {
    let cancelled = false;
    chrome.runtime
      .sendMessage({ type: 'sw/ensure-engine' })
      .then((raw: unknown) => {
        const parsed = ensureEngineResultSchema.safeParse(raw);
        if (!cancelled) setState(parsed.success && parsed.data.ok ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const message = state === 'ready' ? t('searchEngineReady') : state === 'error' ? t('searchEngineError') : t('searchEngineStarting');
  return (
    <main>
      <h1>{t('searchPageTitle')}</h1>
      <label for="q">{t('searchInputLabel')}</label>
      <input id="q" type="search" autocomplete="off" autofocus />
      <p class="status" role="status" data-engine-state={state}>
        {message}
      </p>
    </main>
  );
}
