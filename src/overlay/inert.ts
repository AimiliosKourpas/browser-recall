// body.inert bookkeeping for the overlay. While the overlay is open the page body is inert so a page that steals focus or listens
// to every key cannot receive the typing (ADR-003, M0 S6). The page's ORIGINAL inert state is captured exactly and restored exactly.
export interface InertSnapshot {
  body: HTMLElement;
  /** value of the `inert` attribute before we touched it; null = attribute absent */
  attribute: string | null;
}

export function applyInert(body: HTMLElement): InertSnapshot {
  const snapshot: InertSnapshot = { body, attribute: body.getAttribute('inert') };
  body.setAttribute('inert', '');
  return snapshot;
}

export function restoreInert(snapshot: InertSnapshot | undefined): void {
  if (!snapshot) return;
  if (snapshot.attribute === null) snapshot.body.removeAttribute('inert');
  else snapshot.body.setAttribute('inert', snapshot.attribute);
}
