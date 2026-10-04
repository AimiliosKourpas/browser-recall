// Deep Search settings section (M6, moved here in M8). The permission prompt must come from a user gesture in an extension page;
// the service worker re-verifies the permission before it turns anything on.
import { useEffect, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import { DEEP_ORIGINS } from '../../background/deep/controller';
import { deepCommand, getDeep, type DeepStatus } from './api';

type Notice = 'denied' | 'error' | 'cleared' | undefined;

export function DeepSection({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<DeepStatus | undefined>();
  const [notice, setNotice] = useState<Notice>();
  const [domain, setDomain] = useState('');
  const refresh = () => getDeep().then(setStatus, () => setNotice('error'));
  useEffect(() => void refresh(), []);

  const guarded = async (action: () => Promise<DeepStatus | undefined | void>) => {
    setNotice(undefined);
    try {
      const next = await action();
      if (next) setStatus(next);
      else await refresh();
      onChange();
    } catch {
      setNotice('error');
    }
  };
  const enable = () =>
    guarded(async () => {
      if (!(await chrome.permissions.request({ origins: [...DEEP_ORIGINS] }))) { // user gesture: this click
        setNotice('denied');
        return undefined;
      }
      return deepCommand({ type: 'sw/deep-enable' });
    });
  const disable = () =>
    guarded(async () => {
      const next = await deepCommand({ type: 'sw/deep-disable' });
      await chrome.permissions.remove({ origins: [...DEEP_ORIGINS] }); // nothing else needs the access: give it back
      return next;
    });

  return (
    <section aria-labelledby="h-deep" data-deep-state={status ? (status.enabled ? 'on' : 'off') : 'loading'}>
      <h2 id="h-deep">{t('settingsPageTitleDeep')}</h2>
      <p>{t('settingsDeepIntro')}</p>
      <p class="status">{t('settingsDeepPermission')}</p>
      <p class="status">{t('settingsDeepSkips')}</p>
      {status && (
        <>
          <p role="status">{status.enabled ? t('settingsDeepOn') : status.permission || !status.consent ? t('settingsDeepOff') : t('settingsDeepNoPermission')}</p>
          {!status.consent && <p class="status">{t('settingsDeepNeedsConsent')}</p>}
          <p class="actions">
            {status.enabled ? (
              <button type="button" id="deep-disable" onClick={() => void disable()}>{t('settingsDeepDisable')}</button>
            ) : (
              <button type="button" id="deep-enable" class="primary" disabled={!status.consent} onClick={() => void enable()}>{t('settingsDeepEnable')}</button>
            )}
          </p>
          <h3>{t('settingsExcludeTitle')}</h3>
          <p class="status">{t('settingsExcludeHelp')}</p>
          {status.excluded.length === 0 && <p class="status">{t('settingsExcludeNone')}</p>}
          <ul>
            {status.excluded.map((d) => (
              <li key={d}>
                {d} <button type="button" onClick={() => void guarded(() => deepCommand({ type: 'sw/deep-include', domain: d }))}>{t('settingsExcludeRemove')}</button>
              </li>
            ))}
          </ul>
          <label for="exclude-domain">{t('settingsExcludeLabel')}</label>
          <input id="exclude-domain" type="text" value={domain} onInput={(e) => setDomain((e.target as HTMLInputElement).value)} />{' '}
          <button type="button" id="exclude-add" disabled={!domain.trim()} onClick={() => void guarded(async () => { const n = await deepCommand({ type: 'sw/deep-exclude', domain }); setDomain(''); return n; })}>{t('settingsExcludeAdd')}</button>
          <p class="actions">
            <button type="button" id="deep-clear" onClick={() => void guarded(async () => { await chrome.runtime.sendMessage({ type: 'sw/deep-clear' }); setNotice('cleared'); })}>{t('settingsClear')}</button>
          </p>
        </>
      )}
      {notice === 'denied' && <p role="alert">{t('settingsDeepDenied')}</p>}
      {notice === 'error' && <p role="alert">{t('settingsDeepError')}</p>}
      {notice === 'cleared' && <p role="status">{t('settingsClearDone')}</p>}
    </section>
  );
}
