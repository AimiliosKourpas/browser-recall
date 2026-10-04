// Ledger, deletion, export/import sections (M8). Destructive actions are explicit: an inline confirm step, and type-to-confirm for
// the two wholesale deletes. Everything runs against the local engine through the validated service-worker gate.
import { useEffect, useState } from 'preact/hooks';
import type { DomainStat, PageInfo } from '../../engine/model';
import { exportDataSchema } from '../../engine/model';
import { engineCall } from '../../shared/engine-api';
import { t } from '../../shared/i18n';
import { dayStart, mb } from './api';

const MAX_IMPORT_BYTES = 50_000_000;

/** Two-step button: the first click arms it (the label becomes the confirmation question), the second runs it. */
function ConfirmButton({ label, confirmLabel, onConfirm, id }: { label: string; confirmLabel: string; onConfirm: () => void; id?: string }) {
  const [armed, setArmed] = useState(false);
  return armed ? (
    <button type="button" id={id} class="danger" onClick={() => { setArmed(false); onConfirm(); }} onBlur={() => setArmed(false)} autofocus>{confirmLabel}</button>
  ) : (
    <button type="button" id={id} onClick={() => setArmed(true)}>{label}</button>
  );
}

export function LedgerSection({ onChange, refreshKey }: { onChange: () => void; refreshKey: number }) {
  const [rows, setRows] = useState<DomainStat[] | undefined>();
  const [address, setAddress] = useState('');
  const [info, setInfo] = useState<PageInfo | null | undefined>();
  const [err, setErr] = useState(false);
  const load = () => engineCall({ method: 'domainStats', params: { limit: 25 } }).then(setRows, () => setErr(true));
  useEffect(() => void load(), [refreshKey]);
  const after = async () => { await load(); onChange(); };
  const act = (fn: () => Promise<unknown>) => void fn().then(after, () => setErr(true));

  return (
    <section aria-labelledby="h-ledger">
      <h2 id="h-ledger">{t('settingsSectionLedger')}</h2>
      <p class="status">{t('settingsLedgerIntro')}</p>
      {rows && rows.length === 0 && <p>{t('settingsLedgerEmpty')}</p>}
      {rows && rows.length > 0 && (
        <table id="ledger">
          <thead>
            <tr><th scope="col">{t('settingsLedgerSite')}</th><th scope="col">{t('settingsLedgerPages')}</th><th scope="col">{t('settingsLedgerText')}</th><th scope="col">{t('settingsLedgerLast')}</th><th scope="col">{t('settingsLedgerActions')}</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.domain}>
                <th scope="row">{r.domain}</th>
                <td>{r.pages}</td>
                <td>{mb(r.textBytes)} MB</td>
                <td>{r.lastActivity ? new Date(r.lastActivity).toLocaleDateString() : ''}</td>
                <td class="row-actions">
                  <button type="button" onClick={() => act(() => chrome.runtime.sendMessage({ type: 'sw/deep-exclude', domain: r.domain }))}>{t('settingsLedgerExclude')}</button>{' '}
                  <ConfirmButton label={t('settingsLedgerDelete')} confirmLabel={t('settingsConfirm', t('settingsLedgerDelete'))} onConfirm={() => act(() => engineCall({ method: 'deleteDomain', params: { domain: r.domain, includeSaved: false } }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <label for="page-lookup">{t('settingsPageLookup')}</label>
      <input id="page-lookup" type="url" value={address} onInput={(e) => setAddress((e.target as HTMLInputElement).value)} />{' '}
      <button type="button" id="page-lookup-go" disabled={!address.trim()} onClick={() => void engineCall({ method: 'pageInfo', params: { url: address.trim() } }).then(setInfo, () => setErr(true))}>{t('settingsPageLookupButton')}</button>
      {info === null && <p role="status">{t('settingsPageNone')}</p>}
      {info && (
        <div id="page-info" role="status">
          <p><strong>{info.title || info.url}</strong></p>
          <p>{t('settingsPageSources', [info.flags.history && t('settingsPageHistory'), info.flags.content && t('settingsPageContent'), info.flags.saved && t('settingsPageSavedFlag')].filter(Boolean).join(', '))}</p>
          <p>{t('settingsPageDetails', String(info.visitCount), new Date(info.lastVisit).toLocaleString(), String(info.textBytes), String(info.snippets))}</p>
          {info.bodyPreview && (<><p>{t('settingsPagePreview')}</p><blockquote>{info.bodyPreview}</blockquote></>)}
        </div>
      )}
      {err && <p role="alert">{t('settingsError')}</p>}
    </section>
  );
}

export function DeleteSection({ onChange }: { onChange: () => void }) {
  const [page, setPage] = useState('');
  const [site, setSite] = useState('');
  const [siteSaved, setSiteSaved] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<{ kind: 'status' | 'alert'; text: string } | undefined>();
  const run = (fn: () => Promise<{ deletedPages: number; keptSaved: number }>) =>
    void fn().then(
      (r) => { setMsg({ kind: 'status', text: t('settingsDeleted', String(r.deletedPages), String(r.keptSaved)) }); onChange(); },
      () => setMsg({ kind: 'alert', text: t('settingsDeleteError') }),
    );
  const typedOk = typed.trim() === 'DELETE';
  const rangeOk = from !== '' && to !== '' && dayStart(to) >= dayStart(from);

  return (
    <section aria-labelledby="h-delete">
      <h2 id="h-delete">{t('settingsSectionDelete')}</h2>
      <p class="status">{t('settingsDeleteIntro')}</p>

      <label for="del-page">{t('settingsDeletePage')}</label>
      <input id="del-page" type="url" value={page} onInput={(e) => setPage((e.target as HTMLInputElement).value)} />{' '}
      <ConfirmButton id="del-page-go" label={t('settingsDeleteButton')} confirmLabel={t('settingsConfirm', t('settingsDeleteButton'))} onConfirm={() => run(() => engineCall({ method: 'deleteUrls', params: { urls: [page.trim()] } }))} />

      <label for="del-site">{t('settingsDeleteSite')}</label>
      <input id="del-site" type="text" value={site} onInput={(e) => setSite((e.target as HTMLInputElement).value)} />{' '}
      <label class="inline"><input id="del-site-saved" type="checkbox" checked={siteSaved} onChange={(e) => setSiteSaved((e.target as HTMLInputElement).checked)} /> {t('settingsDeleteSiteSaved')}</label>{' '}
      <ConfirmButton id="del-site-go" label={t('settingsDeleteButton')} confirmLabel={t('settingsConfirm', t('settingsDeleteButton'))} onConfirm={() => run(() => engineCall({ method: 'deleteDomain', params: { domain: site.trim(), includeSaved: siteSaved } }))} />

      <p class="status">{t('settingsDeleteRange')}</p>
      <label for="del-from">{t('settingsDeleteRangeFrom')}</label>
      <input id="del-from" type="date" value={from} onInput={(e) => setFrom((e.target as HTMLInputElement).value)} />{' '}
      <label for="del-to">{t('settingsDeleteRangeTo')}</label>
      <input id="del-to" type="date" value={to} onInput={(e) => setTo((e.target as HTMLInputElement).value)} />{' '}
      {rangeOk ? (
        <ConfirmButton id="del-range-go" label={t('settingsDeleteButton')} confirmLabel={t('settingsConfirm', t('settingsDeleteButton'))} onConfirm={() => run(() => engineCall({ method: 'deleteRange', params: { start: dayStart(from), end: dayStart(to) + 86_400_000 } }))} />
      ) : (
        <button type="button" id="del-range-go" disabled>{t('settingsDeleteButton')}</button>
      )}

      <h3>{t('settingsDeleteConfirmType')}</h3>
      <input id="del-type" type="text" aria-label={t('settingsDeleteConfirmType')} value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autocomplete="off" />
      <p class="actions">
        <button type="button" id="del-keep-saved" disabled={!typedOk} onClick={() => run(() => engineCall({ method: 'deleteAllExceptSaved' }))}>{t('settingsDeleteKeepSaved')}</button>
      </p>
      <p class="actions">
        <button type="button" id="del-everything" class="danger" disabled={!typedOk} onClick={() => run(() => engineCall({ method: 'deleteEverything' }))}>{t('settingsDeleteEverything')}</button>
      </p>
      {msg && <p role={msg.kind}>{msg.text}</p>}
    </section>
  );
}

export function ExportSection({ onChange }: { onChange: () => void }) {
  const [msg, setMsg] = useState<{ kind: 'status' | 'alert'; text: string } | undefined>();
  const download = async (scope: 'saved' | 'all') => {
    const data = await engineCall({ method: 'exportData', params: { scope, now: Date.now() } });
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `browser-recall-${scope}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setMsg({ kind: 'alert', text: t('settingsImportTooBig') });
    let parsed;
    try {
      parsed = exportDataSchema.safeParse(JSON.parse(await file.text())); // data only: JSON.parse + schema validation, never evaluated
    } catch {
      parsed = undefined;
    }
    if (!parsed?.success) return setMsg({ kind: 'alert', text: t('settingsImportBad') });
    try {
      const r = await engineCall({ method: 'importData', params: { data: parsed.data } });
      setMsg({ kind: 'status', text: t('settingsImported', String(r.pages), String(r.snippets), String(r.skipped)) });
      onChange();
    } catch {
      setMsg({ kind: 'alert', text: t('settingsImportBad') });
    }
  };
  return (
    <section aria-labelledby="h-export">
      <h2 id="h-export">{t('settingsSectionExport')}</h2>
      <p class="status">{t('settingsExportIntro')}</p>
      <p class="actions">
        <button type="button" id="export-saved" onClick={() => void download('saved')}>{t('settingsExportSaved')}</button>{' '}
        <button type="button" id="export-all" onClick={() => void download('all')}>{t('settingsExportAll')}</button>
      </p>
      <label for="import-file">{t('settingsImport')}</label>
      <input id="import-file" type="file" accept="application/json,.json" onChange={(e) => { const input = e.target as HTMLInputElement; void upload(input.files?.[0]).then(() => { input.value = ''; }); }} />
      {msg && <p role={msg.kind}>{msg.text}</p>}
    </section>
  );
}
