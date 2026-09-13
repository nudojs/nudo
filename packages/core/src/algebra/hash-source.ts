/**
 * Session-memo content key. Not cryptographic: dual 32-bit FNV-1a mix + length
 * keeps birthday collisions negligible for LRU-sized caches (hundreds of entries)
 * without paying for a full digest on every edit.
 */
let lastHashSource: string | undefined;
let lastHashOut: string | undefined;

export function hashSource(s: string): string {
  if (s === lastHashSource && lastHashOut !== undefined) return lastHashOut;
  let h1 = 2166136261;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 16777619);
    h2 = Math.imul(h2 ^ c, 16777619);
  }
  lastHashSource = s;
  lastHashOut = `${(h1 >>> 0).toString(36)}-${(h2 >>> 0).toString(36)}_${s.length.toString(36)}`;
  return lastHashOut;
}

export function resetHashSourceCache(): void {
  lastHashSource = undefined;
  lastHashOut = undefined;
}
