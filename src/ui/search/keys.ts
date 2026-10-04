// Keyboard map of the search surface (PRODUCT_SPEC §5.2). Pure so it can be unit-tested; the component just applies the result.
export type KeyAction = { kind: 'move'; delta: number } | { kind: 'open'; active: boolean; closeWindow: boolean } | { kind: 'close' } | { kind: 'focus-filters' } | { kind: 'none' };

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
}

export function actionForKey(e: KeyInput, hasResults: boolean): KeyAction {
  if (e.isComposing || e.key === 'Process') return { kind: 'none' }; // IME: Enter confirms the composition, never opens a result
  switch (e.key) {
    case 'ArrowDown':
      return hasResults ? { kind: 'move', delta: 1 } : { kind: 'none' };
    case 'ArrowUp':
      return hasResults ? { kind: 'move', delta: -1 } : { kind: 'none' };
    case 'Enter':
      if (!hasResults) return { kind: 'none' };
      if (e.ctrlKey || e.metaKey) return { kind: 'open', active: false, closeWindow: false }; // background tab, stay in search
      return { kind: 'open', active: true, closeWindow: true }; // Enter and Shift+Enter: new foreground tab
    case 'Escape':
      return { kind: 'close' };
    case 'k':
    case 'K':
      return e.ctrlKey || e.metaKey ? { kind: 'focus-filters' } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}

/** Wraps around the ends of the list. */
export function moveIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return 0;
  return (((current + delta) % length) + length) % length;
}

/** Toggles an operator token ("is:saved", "when:week") in a query: add when absent, remove when present. */
export function toggleToken(query: string, token: string, exclusiveGroup: string[] = []): string {
  const parts = query.split(/\s+/).filter(Boolean);
  const has = parts.includes(token);
  const kept = parts.filter((p) => p !== token && !exclusiveGroup.includes(p));
  if (!has) kept.push(token);
  return kept.join(' ');
}
