import { useEffect, useState } from 'preact/hooks';
import { pipelineStatusResultSchema } from '../../shared/messages';
import { t } from '../../shared/i18n';
import { CONSENT_VERSION } from '../../background/pipeline/state';
import type { PipelineStatus } from '../../background/pipeline/controller';

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; status: PipelineStatus } | { kind: 'declined' };

async function send(message: object): Promise<PipelineStatus | undefined> {
  const parsed = pipelineStatusResultSchema.safeParse(await chrome.runtime.sendMessage(message));
  return parsed.success && parsed.data.ok ? parsed.data.data : undefined;
}

export function App() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const refresh = () =>
    send({ type: 'sw/pipeline-status' }).then(
      (status) => setView(status ? { kind: 'ready', status } : { kind: 'error' }),
      () => setView({ kind: 'error' }),
    );
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1000); // the import itself runs in the service worker; this is only a view of it
    return () => clearInterval(timer);
  }, []);

  const allow = () =>
    send({ type: 'sw/grant-consent', version: CONSENT_VERSION }).then(
      (status) => setView(status ? { kind: 'ready', status } : { kind: 'error' }),
      () => setView({ kind: 'error' }),
    );

  return (
    <main>
      <h1>{t('onboardingPageTitle')}</h1>
      {view.kind === 'error' && <p role="alert">{t('onboardingError')}</p>}
      {view.kind === 'declined' && <p role="status">{t('onboardingDeclined')}</p>}
      {view.kind === 'ready' && view.status.consent !== 'granted' && (
        <section>
          <p>{t('onboardingConsentIntro')}</p>
          <p class="status">{t('onboardingConsentHeadsUp')}</p>
          <p class="actions">
            <button type="button" class="primary" onClick={() => void allow()}>
              {t('onboardingAllow')}
            </button>{' '}
            <button type="button" onClick={() => setView({ kind: 'declined' })}>
              {t('onboardingDecline')}
            </button>
          </p>
        </section>
      )}
      {view.kind === 'ready' && view.status.consent === 'granted' && (
        <section role="status" data-import-status={view.status.importStatus}>
          <p>{view.status.importStatus === 'complete' ? t('onboardingDone') : t('onboardingImporting')}</p>
          <p>
            {t('onboardingImportedCount')} <strong>{view.status.processed}</strong>
          </p>
          {view.status.importStatus !== 'complete' && <progress max={1} value={view.status.progress} aria-label={t('onboardingImporting')} />}
        </section>
      )}
    </main>
  );
}
