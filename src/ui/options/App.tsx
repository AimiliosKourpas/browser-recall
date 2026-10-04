// Settings page (M8): index status, indexing/retention/cap/mirroring, Deep Search, ledger, deletion, export/import, shortcuts, about.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Stats } from '../../engine/model';
import { engineCall } from '../../shared/engine-api';
import { t } from '../../shared/i18n';
import type { Settings } from '../../background/pipeline/state';
import { getPipeline, getSettings, mb, setSettings, type PipelineView } from './api';
import { DeepSection } from './Deep';
import { DeleteSection, ExportSection, LedgerSection } from './Data';

const RETENTION = [3, 6, 12, 24];
const CAPS = [250, 500, 1000, 2000, 5000];

type Command = { name?: string; shortcut?: string };

function IndexSection({ stats, pipeline, settings }: { stats?: Stats | undefined; pipeline?: PipelineView | undefined; settings: Settings }) {
  return (
    <section aria-labelledby="h-index">
      <h2 id="h-index">{t('settingsSectionIndex')}</h2>
      {pipeline?.consent !== 'granted' && pipeline && (
        <p>
          {t('settingsIndexNoConsent')} <a href="onboarding.html">{t('settingsOpenOnboarding')}</a>
        </p>
      )}
      {stats && (
        <>
          <p id="index-summary">{t('settingsIndexSummary', String(stats.pages), String(stats.withHistory), String(stats.withContent), String(stats.saved), String(stats.snippets))}</p>
          <p>{t('settingsIndexUsage', mb(stats.textBytes), mb(stats.liveBytes), String(settings.capMb))}</p>
          <meter min={0} max={settings.capMb * 1e6} value={stats.liveBytes} aria-label={t('settingsCap')} />
        </>
      )}
      {pipeline?.consent === 'granted' && <p role="status">{pipeline.importStatus === 'complete' ? t('settingsIndexStatusIdle') : t('settingsIndexStatusImporting', String(Math.round(pipeline.progress * 100)))}</p>}
    </section>
  );
}

function IndexingSection({ settings, onChange, failed }: { settings: Settings; onChange: (patch: Partial<Settings>) => void; failed: boolean }) {
  return (
    <section aria-labelledby="h-indexing">
      <h2 id="h-indexing">{t('settingsSectionIndexing')}</h2>
      <p>{settings.paused ? t('settingsPausedNote') : t('settingsRunningNote')}</p>
      <p class="actions">
        <button type="button" id="pause-toggle" aria-pressed={settings.paused} onClick={() => onChange({ paused: !settings.paused })}>{settings.paused ? t('settingsResume') : t('settingsPause')}</button>
      </p>
      <p>
        <label class="inline"><input id="mirror" type="checkbox" checked={settings.mirrorDeletion} onChange={(e) => onChange({ mirrorDeletion: (e.target as HTMLInputElement).checked })} /> {t('settingsMirror')}</label>
      </p>
      <p class="status">{t('settingsMirrorHelp')}</p>
      <p>
        <label for="retention">{t('settingsRetention')}</label>{' '}
        <select id="retention" value={settings.retentionMonths === null ? 'forever' : String(settings.retentionMonths)} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; onChange({ retentionMonths: v === 'forever' ? null : Number(v) }); }}>
          {RETENTION.map((m) => (<option key={m} value={String(m)}>{t('settingsRetentionMonths', String(m))}</option>))}
          <option value="forever">{t('settingsRetentionForever')}</option>
        </select>
      </p>
      <p class="status">{t('settingsRetentionHelp')}</p>
      <p>
        <label for="cap">{t('settingsCap')}</label>{' '}
        <select id="cap" value={String(settings.capMb)} onChange={(e) => onChange({ capMb: Number((e.target as HTMLSelectElement).value) })}>
          {CAPS.map((c) => (<option key={c} value={String(c)}>{t('settingsCapMb', String(c))}</option>))}
        </select>
      </p>
      <p class="status">{t('settingsCapHelp')}</p>
      {failed && <p role="alert">{t('settingsSaveError')}</p>}
    </section>
  );
}

function ShortcutsSection() {
  const [commands, setCommands] = useState<Command[]>([]);
  useEffect(() => void chrome.commands.getAll().then(setCommands, () => undefined), []);
  return (
    <section aria-labelledby="h-shortcuts">
      <h2 id="h-shortcuts">{t('settingsSectionShortcuts')}</h2>
      <ul id="shortcut-list">
        {commands.filter((c) => c.name === 'open-search' || c.name === 'remember-page').map((c) => (
          <li key={c.name}>{c.name === 'open-search' ? t('cmdOpenSearch') : t('cmdRememberPage')}: <kbd>{c.shortcut || t('settingsShortcutNotSet')}</kbd></li>
        ))}
      </ul>
      <p class="status">{t('settingsShortcutsHelp')}</p>
      <p class="actions"><button type="button" onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>{t('settingsShortcutsOpen')}</button></p>
    </section>
  );
}

function AboutSection({ diagnostics }: { diagnostics: () => Promise<string> }) {
  const [state, setState] = useState<{ copied: boolean; text?: string }>({ copied: false });
  const copy = async () => {
    const text = await diagnostics();
    try {
      await navigator.clipboard.writeText(text);
      setState({ copied: true });
    } catch {
      setState({ copied: false, text }); // clipboard unavailable: show the text to copy by hand
    }
  };
  return (
    <section aria-labelledby="h-about">
      <h2 id="h-about">{t('settingsSectionAbout')}</h2>
      <p>{t('settingsAboutVersion', chrome.runtime.getManifest().version)}</p>
      <p>{t('settingsAboutStores')}</p>
      <p>{t('settingsAboutNever')}</p>
      <p>{t('settingsAboutLimits')}</p>
      <p class="status">{t('settingsAboutDiagHelp')}</p>
      <p class="actions"><button type="button" id="copy-diagnostics" onClick={() => void copy()}>{t('settingsAboutDiag')}</button></p>
      {state.copied && <p role="status">{t('settingsAboutDiagCopied')}</p>}
      {state.text && (<><p>{t('settingsAboutDiagManual')}</p><textarea readOnly rows={8} aria-label={t('settingsAboutDiag')} value={state.text} /></>)}
    </section>
  );
}

export function App() {
  const [settings, setLocal] = useState<Settings | undefined>();
  const [pipeline, setPipeline] = useState<PipelineView | undefined>();
  const [stats, setStats] = useState<Stats | undefined>();
  const [failed, setFailed] = useState(false);
  const [broken, setBroken] = useState(false);
  const [key, setKey] = useState(0);

  const refresh = useCallback(() => {
    void engineCall({ method: 'stats' }).then(setStats, () => undefined);
    void getPipeline().then(setPipeline, () => undefined);
    setKey((k) => k + 1);
  }, []);
  useEffect(() => {
    void getSettings().then(setLocal, () => setBroken(true));
    refresh();
  }, [refresh]);

  const change = (patch: Partial<Settings>) => {
    setFailed(false);
    void setSettings(patch).then((s) => { setLocal(s); refresh(); }, () => setFailed(true));
  };
  const diagnostics = async (): Promise<string> => {
    const s = await engineCall({ method: 'stats' });
    const p = await getPipeline();
    return JSON.stringify({ version: chrome.runtime.getManifest().version, chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '', schema: s.schemaVersion, pages: s.pages, withHistory: s.withHistory, withContent: s.withContent, saved: s.saved, snippets: s.snippets, textBytes: s.textBytes, dbBytes: s.dbBytes, importStatus: p.importStatus, consent: p.consent, paused: p.paused, lastIntegrity: p.lastIntegrity, lastMaintenanceAt: p.lastMaintenanceAt, settings }, null, 2);
  };

  if (broken) return <main><h1>{t('settingsPageTitle')}</h1><p role="alert">{t('settingsError')}</p></main>;
  if (!settings) return <main><h1>{t('settingsPageTitle')}</h1><p>{t('settingsLoading')}</p></main>;
  return (
    <main class="settings">
      <h1>{t('settingsPageTitle')}</h1>
      <p><button type="button" onClick={() => void chrome.runtime.sendMessage({ type: 'sw/open-search' })}>{t('settingsOpenSearch')}</button></p>
      <IndexSection stats={stats} pipeline={pipeline} settings={settings} />
      <IndexingSection settings={settings} onChange={change} failed={failed} />
      <DeepSection onChange={refresh} />
      <LedgerSection onChange={refresh} refreshKey={key} />
      <DeleteSection onChange={refresh} />
      <ExportSection onChange={refresh} />
      <ShortcutsSection />
      <AboutSection diagnostics={diagnostics} />
    </main>
  );
}
