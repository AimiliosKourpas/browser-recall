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

  const [shortcut, setShortcut] = useState('');
  useEffect(() => void chrome.commands.getAll().then((cs) => setShortcut(cs.find((c) => c.name === 'open-search')?.shortcut ?? ''), () => undefined), []);

  const howTo = (
    <section aria-labelledby="h-how">
      <h2 id="h-how">{t('onboardingHowTitle')}</h2>
      <p>{shortcut ? t('onboardingHowSearch', shortcut) : t('onboardingHowSearchUnset')}</p>
      <p>{t('onboardingHowRemember')}</p>
      <p class="actions">
        <button type="button" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>{t('onboardingShortcutsLink')}</button>
      </p>
    </section>
  );

  return (
    <main>
      <h1>{t('onboardingPageTitle')}</h1>
      {view.kind === 'error' && <p role="alert">{t('onboardingError')}</p>}
      {view.kind === 'declined' && <p role="status">{t('onboardingDeclined')}</p>}
      {view.kind === 'ready' && view.status.consent !== 'granted' && (
        <>
          <section aria-labelledby="h-what">
            <h2 id="h-what">{t('actionTitle')}</h2>
            <p>{t('onboardingConsentIntro')}</p>
          </section>
          <section aria-labelledby="h-local">
            <h2 id="h-local">{t('onboardingLocalTitle')}</h2>
            <p>{t('onboardingLocal')}</p>
          </section>
          <section aria-labelledby="h-history">
            <h2 id="h-history">{t('onboardingConsentTitle')}</h2>
            <p>{t('onboardingWhyHistory')}</p>
          </section>
          <section aria-labelledby="h-deep">
            <h2 id="h-deep">{t('onboardingDeepTitle')}</h2>
            <p>{t('onboardingDeep')}</p>
          </section>
          {howTo}
          <p class="actions">
            <button type="button" class="primary" onClick={() => void allow()}>
              {t('onboardingAllow')}
            </button>{' '}
            <button type="button" onClick={() => setView({ kind: 'declined' })}>
              {t('onboardingDecline')}
            </button>
          </p>
        </>
      )}
      {view.kind === 'ready' && view.status.consent === 'granted' && (
        <>
          <section role="status" data-import-status={view.status.importStatus}>
            <p>{view.status.importStatus === 'complete' ? t('onboardingDone') : t('onboardingImporting')}</p>
            <p>
              {t('onboardingImportedCount')} <strong>{view.status.processed}</strong>
            </p>
            {view.status.importStatus !== 'complete' && <progress max={1} value={view.status.progress} aria-label={t('onboardingImporting')} />}
          </section>
          {howTo}
          <section aria-labelledby="h-deep">
            <h2 id="h-deep">{t('onboardingDeepTitle')}</h2>
            <p>{t('onboardingDeep')}</p>
            <p class="actions">
              <button type="button" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('/settings.html') })}>{t('onboardingOpenSettings')}</button>{' '}
              <button type="button" onClick={() => void chrome.runtime.sendMessage({ type: 'sw/open-search' })}>{t('settingsOpenSearch')}</button>
            </p>
          </section>
        </>
      )}
    </main>
  );
}
