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
  // Last non-empty line is real code → normalize trailing whitespace only,
  // then still try stripping a trailing block comment below.
  if (trimmedLast !== "" && !trimmedLast.startsWith("//") && !trimmedLast.startsWith("/*")) {
    let body = source.slice(0, end);
    if (body.endsWith("*/")) {
      body = stripTrailingBlockComments(body);
      return body + "\n";
    }
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
    // Multi-line trailing block comment (/* ... */) without @nudo.
    if (last.trim() === "*/" || last.trimStart().startsWith("/*")) {
      const joined = stripTrailingBlockComments(lines.join("\n"));
      const stripped = joined.split("\n");
      if (stripped.length < lines.length) {
        lines.length = 0;
        lines.push(...stripped);
        continue;
      }
    }
    break;
  }
  let body = lines.join("\n").replace(/\s+$/, "");
  body = stripTrailingBlockComments(body);
  return body + "\n";
}

/**
 * Strip trailing `/* ... *\/` comments that sit alone on their line(s) and
 * carry no @nudo directive. Heuristic: `/*` must start a line (after indent)
 * so we do not cut inside strings. Returns body without a trailing newline.
 */
function stripTrailingBlockComments(body: string): string {
  let t = body.replace(/\s+$/, "");
  while (t.endsWith("*/")) {
    const start = t.lastIndexOf("/*");
    if (start < 0) break;
    const block = t.slice(start);
    if (block.includes("@nudo")) break;
    const before = t.slice(0, start);
    const lineStart = before.lastIndexOf("\n") + 1;
    if (before.slice(lineStart).trim() !== "") break;
    t = before.replace(/\s+$/, "");
  }
  return t;
}
