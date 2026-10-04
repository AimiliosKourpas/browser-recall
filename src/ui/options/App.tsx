// Deep Search settings page (M6). The permission prompt must come from a user gesture in an extension page, so it lives here;
// the service worker re-verifies the permission before it turns anything on.
import { useEffect, useState } from 'preact/hooks';
import { deepStatusResultSchema } from '../../shared/messages';
import { t } from '../../shared/i18n';
import { DEEP_ORIGINS } from '../../background/deep/controller';

type Status = { enabled: boolean; permission: boolean; consent: boolean; excluded: string[] };
type Notice = 'denied' | 'error' | 'cleared' | undefined;

async function send(message: object): Promise<Status | undefined> {
  const parsed = deepStatusResultSchema.safeParse(await chrome.runtime.sendMessage(message));
  return parsed.success && parsed.data.ok ? parsed.data.data : undefined;
}

export function App() {
  const [status, setStatus] = useState<Status | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [domain, setDomain] = useState('');
  const refresh = async () => setStatus(await send({ type: 'sw/deep-status' }));
  useEffect(() => void refresh(), []);

  const guarded = async (action: () => Promise<Status | undefined | void>) => {
    setNotice(undefined);
    try {
      const next = await action();
      if (next) setStatus(next);
      else await refresh();
    } catch {
      setNotice('error');
    }
  };

  const enable = () =>
    guarded(async () => {
      const granted = await chrome.permissions.request({ origins: [...DEEP_ORIGINS] }); // user gesture: this click
      if (!granted) {
        setNotice('denied');
        return undefined;
      }
      return send({ type: 'sw/deep-enable' });
    });
  const disable = () =>
    guarded(async () => {
      const next = await send({ type: 'sw/deep-disable' });
      await chrome.permissions.remove({ origins: [...DEEP_ORIGINS] }); // nothing else needs the access: give it back
      return next;
    });
  const exclude = () =>
    guarded(async () => {
      const next = await send({ type: 'sw/deep-exclude', domain });
      if (next) setDomain('');
      return next;
    });
  const clear = () =>
    guarded(async () => {
      await chrome.runtime.sendMessage({ type: 'sw/deep-clear' });
      setNotice('cleared');
    });

  return (
    <main data-deep-state={status ? (status.enabled ? 'on' : 'off') : 'loading'}>
      <h1>{t('settingsPageTitle')}</h1>
      <p>{t('settingsDeepIntro')}</p>
      <p class="status">{t('settingsDeepPermission')}</p>
      <p class="status">{t('settingsDeepSkips')}</p>
      {status && (
        <section>
          <p role="status">{status.enabled ? t('settingsDeepOn') : status.permission || !status.consent ? t('settingsDeepOff') : t('settingsDeepNoPermission')}</p>
          {!status.consent && <p class="status">{t('settingsDeepNeedsConsent')}</p>}
          <p class="actions">
            {status.enabled ? (
              <button type="button" id="deep-disable" onClick={() => void disable()}>{t('settingsDeepDisable')}</button>
            ) : (
              <button type="button" id="deep-enable" class="primary" disabled={!status.consent} onClick={() => void enable()}>{t('settingsDeepEnable')}</button>
            )}
          </p>
          <h2>{t('settingsExcludeTitle')}</h2>
          <p class="status">{t('settingsExcludeHelp')}</p>
          {status.excluded.length === 0 && <p class="status">{t('settingsExcludeNone')}</p>}
          <ul>
            {status.excluded.map((d) => (
              <li key={d}>
                {d}{' '}
                <button type="button" onClick={() => void guarded(() => send({ type: 'sw/deep-include', domain: d }))}>{t('settingsExcludeRemove')}</button>
              </li>
            ))}
          </ul>
          <label for="exclude-domain">{t('settingsExcludeLabel')}</label>
          <input id="exclude-domain" type="text" value={domain} onInput={(e) => setDomain((e.target as HTMLInputElement).value)} />{' '}
          <button type="button" id="exclude-add" disabled={!domain.trim()} onClick={() => void exclude()}>{t('settingsExcludeAdd')}</button>
          <p class="actions">
            <button type="button" id="deep-clear" onClick={() => void clear()}>{t('settingsClear')}</button>
          </p>
        </section>
      )}
      {notice === 'denied' && <p role="alert">{t('settingsDeepDenied')}</p>}
      {notice === 'error' && <p role="alert">{t('settingsDeepError')}</p>}
      {notice === 'cleared' && <p role="status">{t('settingsClearDone')}</p>}
    </main>
  );
}
