/**
 * AI3 — what-if 绑定注入（CLI 与 LSP 同构）。
 * 把 `{name, type}` 注入为 `@nudo:as`，供 analyzeFile 观察 target 推断。
 */
import { parse } from "@nudojs/parser";
import { CONSTRAINT_EXPR_RE } from "@nudojs/core";

export type TypeBinding = { name: string; type: string };

/**
 * 顶层 `|` 切分；字符串内不切。与 parseCaseArgExpr 一致：引号内 `\` 不是转义。
 */
function splitTopLevelUnion(expr: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (inString) {
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
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
    if (CONSTRAINT_EXPR_RE.test(m)) return m;
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

type AstNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: { line: number } } | null;
  leadingComments?: Array<{ loc?: { start: { line: number } } | null }> | null;
  declarations?: AstNode[];
  declaration?: AstNode | null;
  id?: { type: string; name?: string; start?: number; end?: number } | null;
  init?: { start?: number | null; end?: number | null } | null;
  kind?: string;
  program?: { body: AstNode[] };
};

/**
 * `@nudo:as` 是语句级 init 覆盖（见 transpile matchAsOverride）。
 * 多声明符 `const a=1, b=2` 若不拆开，一个 as 会盖住全部 Identifier init。
 * 在注入前把「含绑定名的多声明符声明」拆成单声明符语句。
 */
function splitMultiDeclarators(source: string, bound: Set<string>): string {
  if (bound.size === 0) return source;
  let ast: AstNode;
  try {
    ast = parse(source) as unknown as AstNode;
  } catch {
    return source;
  }
  const body = ast.program?.body ?? [];
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  const visit = (stmt: AstNode): void => {
    let decl: AstNode | null = null;
    let isExport = false;
    if (stmt.type === "VariableDeclaration") decl = stmt;
    else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration?.type === "VariableDeclaration") {
      decl = stmt.declaration;
      isExport = true;
    }
    if (!decl) return;
    const decls = decl.declarations ?? [];
    if (decls.length <= 1) return;
    const names = new Set<string>();
    declaredNames(stmt, names);
    if (![...names].some((n) => bound.has(n))) return;
    if (decls.some((d) => !d.id || d.id.type !== "Identifier")) return;
    if (stmt.start == null || stmt.end == null) return;

    const kw = decl.kind ?? "const";
    const prefix = isExport ? `export ${kw}` : kw;
    const parts = decls.map((d) => {
      const idName = d.id!.name!;
      const initSrc =
        d.init && d.init.start != null && d.init.end != null
          ? source.slice(d.init.start, d.init.end)
          : "";
      return `${prefix} ${idName}${initSrc ? ` = ${initSrc}` : ""};`;
    });
    replacements.push({ start: stmt.start, end: stmt.end, text: parts.join("\n") });
  };

  for (const stmt of body) visit(stmt);

  if (replacements.length === 0) return source;
  replacements.sort((a, b) => b.start - a.start);
  let out = source;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

export function injectBindings(
  source: string,
  bindings: TypeBinding[],
): { source: string; applied: string[]; unapplied: string[] } {
  const applied: string[] = [];
  const unapplied: string[] = [];
  if (bindings.length === 0) return { source, applied, unapplied };

  const bound = new Set(bindings.map((b) => b.name));
  const rewritten = splitMultiDeclarators(source, bound);

  const ast = parse(rewritten) as unknown as {
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
  }

  const insertions: Array<{ index: number; text: string }> = [];
  for (const [line, group] of byLine) {
    // 语句级 as 只能表达一个类型；拆分后正常一行一个。同侧行撞车时只认第一个。
    const b = group[0]!;
    insertions.push({
      index: line - 1,
      text: `// @nudo:as ${typeExprToDirective(b.type)}`,
    });
    applied.push(`${b.name}: ${b.type}`);
    for (const shadowed of group.slice(1)) unapplied.push(shadowed.name);
  }
  insertions.sort((a, b) => b.index - a.index);
  const lines = rewritten.split("\n");
  for (const ins of insertions) lines.splice(ins.index, 0, ins.text);
  return { source: lines.join("\n"), applied, unapplied };
}
