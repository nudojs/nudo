/**
 * Analysis-stable source key: strip trailing noise that cannot affect types.
 * Keeps every line that may carry @nudo directives.
 *
 * Fast path: already-stable sources return the same string identity (O(1)
 * compare in B-path / analysis caches when the caller reuses the buffer).
 */
export function stableAnalyzeKeySource(source: string): string {
  // Scan back over trailing whitespace/newlines (usually a few chars).
  let end = source.length;
  while (end > 0) {
    const ch = source.charCodeAt(end - 1);
    if (ch === 10 || ch === 13 || ch === 32 || ch === 9) {
      end--;
      continue;
    }
    break;
  }
  const lineStart = source.lastIndexOf("\n", end - 1) + 1;
  const lastLine = source.slice(lineStart, end);
  const trimmedLast = lastLine.trim();
  // Last non-empty line is real code → normalize trailing whitespace only.
  if (trimmedLast !== "" && !trimmedLast.startsWith("//")) {
    const after = source.slice(end);
    if (after === "" || after === "\n") return source;
    return source.slice(0, end) + "\n";
  }

  const lines = source.split("\n");
  while (lines.length > 0) {
    const last = lines[lines.length - 1]!;
    if (last.trim() === "") {
      lines.pop();
      continue;
    }
    if (last.trimStart().startsWith("//") && !last.includes("@nudo")) {
      lines.pop();
      continue;
    }
    break;
  }
  return lines.join("\n").replace(/\s+$/, "") + "\n";
}
