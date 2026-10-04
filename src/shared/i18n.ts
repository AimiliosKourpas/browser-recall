// Typed i18n over chrome.i18n with an English fallback from the same catalogue (also used by unit tests, where chrome is absent).
import en from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof en;

export type Getter = (key: string, substitutions?: string[]) => string | undefined;

/** `$1`, `$2`… in a message are replaced by the substitutions (same convention as chrome.i18n). */
const substitute = (message: string, subs: string[] = []): string => message.replace(/\$(\d)/g, (_, i: string) => subs[Number(i) - 1] ?? '');

export function createT(getMessage: Getter = defaultGetter) {
  return (key: MessageKey, ...subs: string[]): string => getMessage(key, subs) || substitute(en[key].message, subs);
}

function defaultGetter(key: string, subs: string[] = []): string | undefined {
  return typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(key, subs) : undefined;
}

export const t = createT();
export const catalogue = en;
