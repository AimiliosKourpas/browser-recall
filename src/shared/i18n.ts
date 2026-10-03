// Typed i18n over chrome.i18n with an English fallback from the same catalogue (also used by unit tests, where chrome is absent).
import en from '../../public/_locales/en/messages.json';

export type MessageKey = keyof typeof en;

export type Getter = (key: string) => string | undefined;

export function createT(getMessage: Getter = defaultGetter) {
  return (key: MessageKey): string => getMessage(key) || en[key].message;
}

function defaultGetter(key: string): string | undefined {
  return typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(key) : undefined;
}

export const t = createT();
export const catalogue = en;
