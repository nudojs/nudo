/**
 * AI3 — what-if 绑定注入（CLI 与 LSP 同构）。
 * 把 `{name, type}` 注入为 `@nudo:as`，供 analyzeFile 观察 target 推断。
 */
import { parse } from "@nudojs/parser";

export type TypeBinding = { name: string; type: string };

function splitTopLevelUnion(expr: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "|" && depth === 0) {
      members.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  members.push(expr.slice(start));
  return members.map((m) => m.trim()).filter(Boolean);
}

/** agent 面类型表达式 → `@nudo:as` 文法 */
export function typeExprToDirective(expr: string): string {
  const members = splitTopLevelUnion(expr);
  if (members.length === 0) return "any()";
  const mapped = members.map((m) => {
    if (m.startsWith("T.")) return "any()";
    if (m === "number" || m === "string" || m === "boolean") return `${m}()`;
    if (m === "unknown" || m === "any") return "any()";
    if (m === "null" || m === "undefined" || m === "true" || m === "false") return m;
    if (/^-?\d+(\.\d+)?$/.test(m)) return m;
    if (/^["']/.test(m)) return m;
    if (/[([{]|=>/.test(m) && !m.startsWith("T.")) return m;
    if (/^(number|string|boolean|any|array|shape|lit|union|fn)\s*\(/.test(m)) return m;
    return "any()";
  });
  return mapped.length === 1 ? mapped[0]! : `union(${mapped.join(", ")})`;
}

function declaredNames(stmt: any, out: Set<string>): void {
  if (stmt.type === "FunctionDeclaration" && stmt.id) out.add(stmt.id.name);
  else if (stmt.type === "ClassDeclaration" && stmt.id) out.add(stmt.id.name);
  else if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) {
      if (decl.id?.type === "Identifier") out.add(decl.id.name);
    }
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    declaredNames(stmt.declaration, out);
  }
}

export function injectBindings(
  source: string,
  bindings: TypeBinding[],
): { source: string; applied: string[]; unapplied: string[] } {
  const applied: string[] = [];
  const unapplied: string[] = [];
  if (bindings.length === 0) return { source, applied, unapplied };

  const ast = parse(source) as unknown as {
    program: { body: Array<Record<string, any>> };
  };
  const declLines = new Map<string, number>();
  for (const stmt of ast.program.body) {
    const names = new Set<string>();
    declaredNames(stmt, names);
    if (names.size === 0 || !stmt.loc) continue;
    const anchorLine =
      stmt.leadingComments?.[0]?.loc?.start.line ?? stmt.loc.start.line;
    for (const name of names) {
      if (!declLines.has(name)) declLines.set(name, anchorLine);
    }
  }

  const byLine = new Map<number, TypeBinding[]>();
  for (const binding of bindings) {
    const line = declLines.get(binding.name);
    if (line === undefined) {
      unapplied.push(binding.name);
      continue;
    }
    const group = byLine.get(line) ?? [];
    group.push(binding);
    byLine.set(line, group);
    applied.push(binding.name);
  }

  const insertions: Array<{ index: number; text: string }> = [];
  for (const [line, group] of byLine) {
    insertions.push({
      index: line - 1,
      text: `// @nudo:as ${typeExprToDirective(group[0]!.type)}`,
    });
  }
  insertions.sort((a, b) => b.index - a.index);
  const lines = source.split("\n");
  for (const ins of insertions) lines.splice(ins.index, 0, ins.text);
  return { source: lines.join("\n"), applied, unapplied };
}
