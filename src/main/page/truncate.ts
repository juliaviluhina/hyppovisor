// Byte-bounded truncation with an explicit flag (FR-021). Never silent.

export interface Truncated {
  value: string;
  truncated: boolean;
}

const MARKER = "\n…[truncated by HyppoVisor: content exceeded the size limit]";

/** Truncate `s` so its UTF-8 byte length does not exceed `maxBytes`. */
export function truncateToBytes(s: string, maxBytes: number): Truncated {
  const bytes = Buffer.byteLength(s, "utf8");
  if (bytes <= maxBytes) return { value: s, truncated: false };

  // Cut on a code-point boundary, leaving room for the marker.
  const budget = Math.max(0, maxBytes - Buffer.byteLength(MARKER, "utf8"));
  let end = Math.min(s.length, budget);
  while (end > 0 && Buffer.byteLength(s.slice(0, end), "utf8") > budget) end--;
  return { value: s.slice(0, end) + MARKER, truncated: true };
}
