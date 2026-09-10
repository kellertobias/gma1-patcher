export const LINE_SIZE = 512;
export const MAX_LINES = 64;
export const UNPATCHED = -1;

/** 0-based absolute address -> "line.slot" (e.g. "2.341"), "-" when unpatched. */
export function formatAddress(a: number): string {
  if (a < 0) return '-';
  return `${Math.floor(a / LINE_SIZE) + 1}.${String((a % LINE_SIZE) + 1).padStart(3, '0')}`;
}

/**
 * "2.341", "2/341" or "2:341" -> line 2 slot 341; a plain number is a 1-based absolute address;
 * "-" or "" means unpatched. Returns null for invalid input.
 */
export function parseAddress(text: string): number | null {
  const t = text.trim();
  if (t === '-' || t === '') return UNPATCHED;
  const m = /^(\d+)\s*[.:/]\s*(\d+)$/.exec(t);
  if (m) {
    const line = Number(m[1]);
    const slot = Number(m[2]);
    if (line < 1 || line > MAX_LINES || slot < 1 || slot > LINE_SIZE) return null;
    return (line - 1) * LINE_SIZE + slot - 1;
  }
  if (!/^\d+$/.test(t)) return null;
  const a = Number(t);
  return a >= 1 && a <= MAX_LINES * LINE_SIZE ? a - 1 : null;
}

export function formatRange(a: number, size: number): string {
  if (a < 0) return '-';
  if (size <= 1) return formatAddress(a);
  return `${formatAddress(a)}–${String(((a + size - 1) % LINE_SIZE) + 1).padStart(3, '0')}`;
}
