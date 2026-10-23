/**
 * AI3 — what-if 绑定注入（CLI 与 LSP 同构）。
 * 把 `{name, type}` 注入为 `@nudo:as`，供 analyzeFile 观察 target 推断。
 *
 * 不变量：注入的类型表达式要么**按原样**表达，要么**明说**降级成了 `unknown`；
 * 认不出的名字（`Date` / `T.Foo` …）不静默洗成 `any()`（`any()` 与 `unknown`
 * 在 `@nudo:as` 文法里本就是同一个 Abs——洗成 `any()` 只会把「表达不了」
 * 藏起来，并让 `applied` 回显说谎）。
 */
import { parse, programBody, getDeclaratorId } from "@nudojs/parser";
import { CONSTRAINT_EXPR_RE } from "@nudojs/core";
import type { File, Statement, VariableDeclaration } from "@babel/types";

export type TypeBinding = { name: string; type: string };

/**
 * 顶层 `|` 切分；字符串内不切。
 *
 * ★ 族 28 接线（Bug 840）：与 parseCaseArgExpr 的**新**字面量文法一致 ——
 * 引号内 `\` **是**转义（`\"` 不闭合字符串）。
 * 旧口径（`\` 不当转义）会让 `"a\" | number` 在引号处提前闭合 ⇒
 * 把**字符串内**的 `|` 误切成两个成员（切出来的成员随后解析失败）。
 */
function splitTopLevelUnion(expr: string): string[] {
  const members: string[] = [];
  let start = 0;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!;
    if (inString) {
      // 转义感知：`\` + 任意字符 ⇒ 整体跳过（不闭合字符串）
      if (c === "\\") {
        i++;
        continue;
      }
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

/**
 * agent 面类型表达式 → `@nudo:as` 文法。
 *
 * `faithful=false` ⇒ 该表达式**认不出**（裸名字如 `Date`、TS 类型引用 `T.*`）。
 * 认不出的表达式**不静默洗成 `any()`**：按文档契约（agent.md「any other name
 * becomes `unknown`」）落到 `unknown`——`@nudo:as unknown` 是指令文法里的合法
 * 载荷（`parseCaseArgExpr` → `absUnknown()`），且与 `any()` 同一个 Abs。
 *
 * 整条表达式只要有一项认不出，**整条**降级为 `unknown`：联合成员里塞裸
 * `unknown` 不是合法的约束构建器实参（`union(number(), unknown)` 会炸）。
 */
function mapTypeExpr(expr: string): { directive: string; faithful: boolean } {
  const members = splitTopLevelUnion(expr);
  if (members.length === 0) return { directive: "unknown", faithful: false };
  let faithful = true;
  const mapped = members.map((m) => {
    // TS 类型引用：`T.*` 文法已物理删除，认不出
    if (m.startsWith("T.")) {
      faithful = false;
      return "unknown";
    }
    if (m === "number" || m === "string" || m === "boolean") return `${m}()`;
    if (m === "unknown" || m === "any") return "any()";
    if (m === "null" || m === "undefined" || m === "true" || m === "false") return m;
    if (/^-?\d+(\.\d+)?$/.test(m)) return m;
    if (/^["']/.test(m)) return m;
    if (/[([{]|=>/.test(m)) return m;
    if (CONSTRAINT_EXPR_RE.test(m)) return m;
    // 认不出的裸名字（`Date` / `notatype` / `bigint` …）——不洗成 any()
    faithful = false;
    return "unknown";
  });
  if (!faithful) return { directive: "unknown", faithful: false };
  return {
    directive: mapped.length === 1 ? mapped[0]! : `union(${mapped.join(", ")})`,
    faithful: true,
  };
}

/** agent 面类型表达式 → `@nudo:as` 文法（认不出的表达式落到 `unknown`） */
export function typeExprToDirective(expr: string): string {
  return mapTypeExpr(expr).directive;
}

function declaredNames(stmt: Statement, out: Set<string>): void {
  if (stmt.type === "FunctionDeclaration" && stmt.id) out.add(stmt.id.name);
  else if (stmt.type === "ClassDeclaration" && stmt.id) out.add(stmt.id.name);
  else if (stmt.type === "VariableDeclaration") {
    for (const decl of stmt.declarations) {
      const id = getDeclaratorId(decl);
      if (id) out.add(id.name);
    }
  } else if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
    declaredNames(stmt.declaration, out);
  }
}

/**
 * `@nudo:as` 是语句级 init 覆盖（见 transpile matchAsOverride）。
 * 多声明符 `const a=1, b=2` 若不拆开，一个 as 会盖住全部 Identifier init。
 * 在注入前把「含绑定名的多声明符声明」拆成单声明符语句。
 */
function splitMultiDeclarators(source: string, bound: Set<string>): string {
  if (bound.size === 0) return source;
  let ast: File;
  try {
    ast = parse(source);
  } catch {
    return source;
  }
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  const visit = (stmt: Statement): void => {
    let decl: VariableDeclaration | null = null;
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
      const idName = getDeclaratorId(d)?.name ?? "";
      const initSrc =
        d.init && d.init.start != null && d.init.end != null
          ? source.slice(d.init.start, d.init.end)
          : "";
      return `${prefix} ${idName}${initSrc ? ` = ${initSrc}` : ""};`;
    });
    replacements.push({ start: stmt.start, end: stmt.end, text: parts.join("\n") });
  };

  for (const stmt of programBody(ast)) visit(stmt);

  if (replacements.length === 0) return source;
  replacements.sort((a, b) => b.start - a.start);
  let out = source;
  for (const r of replacements) {
    out = out.slice(0, r.start) + r.text + out.slice(r.end);
  }
  return out;
}

/**
 * 顶层声明的**语句身份**（Bug 1036）：字符区间 + 所在行。
 *
 * 注入点按**区间**落 ⇒ 同一行的多条声明各自落在自己的声明前（行号口径
 * 会撞车 ⇒ 假设落到别的变量上）。
 */
type DeclSite = { start: number; end: number; line: number };

export function injectBindings(
  source: string,
  bindings: TypeBinding[],
): { source: string; applied: string[]; unapplied: string[] } {
  const applied: string[] = [];
  const unapplied: string[] = [];
  // 形状校验下沉（Bug 961）：`bindings` 必须是数组——此前非数组一路传到
  // `bindings.map` 才炸（裸 JS TypeError `bindings.map is not a function`
  // 当工具错误回给客户端，是引擎内部实现细节，不是可诊断信息）。
  if (!Array.isArray(bindings)) {
    throw new TypeError("injectBindings: bindings must be an array of { name, type }");
  }
  if (bindings.length === 0) return { source, applied, unapplied };

  // 缺 `name` 的项：此前 `unapplied.push(undefined)` ⇒ `join` 渲染成**空串**
  // ⇒ 提示行变成「…: 」（冒号后什么都没有），用户以为「没有未应用的绑定」，
  // 实际是自己的请求少了一个字段。给具名提示。
  const named = (b: unknown): string =>
    b !== null && typeof b === "object" && typeof (b as { name?: unknown }).name === "string"
      ? (b as { name: string }).name
      : "";
  const bound = new Set(bindings.map((b) => named(b)));
  const rewritten = splitMultiDeclarators(source, bound);

  const ast = parse(rewritten);
  // 锚点 = **声明语句自身**（Bug 1036）。
  //
  // 旧口径优先取 `leadingComments[0].loc.start.line`：Babel 会把上一行的
  // **行尾注释**同时挂成下一条声明的 `leadingComments[0]`
  // （`const a = 1; // 说明` ⇒ `const b = 2;` 的 leading 里有「说明」）
  // ⇒ 锚点被劫持到上一行 ⇒ 假设落到**另一个变量**上，而回显仍说
  // 「Bindings applied: …」⇒ 工具回答的是另一个问题（假成功）。
  //
  // 只记**行号**也不够：同一行两条声明（`const a = 1; const b = 2;`）行号
  // 撞车 ⇒ 后者被判成「同侧撞车、丢弃」⇒ 假设仍然落到**另一个变量**上，
  // 且失败理由被渲染成「no top-level declaration found」（**编的理由**）。
  //
  // ⇒ 记**字符区间**（语句身份）：注入点按区间落，同一行的多条声明各自
  // 落在**自己**的声明前（行中声明 ⇒ 插在它自己的字符位 + 换行；行首
  // 声明 ⇒ 插在整行之前，并按 `isCommentOnlyLine` 把前置注释块整块上移，
  // 使 JSDoc / 前置注释仍与语句相邻）。
  const declSites = new Map<string, DeclSite>();
  for (const stmt of programBody(ast)) {
    const names = new Set<string>();
    declaredNames(stmt, names);
    if (names.size === 0 || !stmt.loc || stmt.start == null) continue;
    const site: DeclSite = {
      start: stmt.start,
      end: stmt.end ?? stmt.start,
      line: stmt.loc.start.line,
    };
    for (const name of names) {
      if (!declSites.has(name)) declSites.set(name, site);
    }
  }

  const bySite = new Map<DeclSite, TypeBinding[]>();
  for (const binding of bindings) {
    const name = named(binding);
    const site = name === "" ? undefined : declSites.get(name);
    if (site === undefined) {
      unapplied.push(name === "" ? "<missing name>" : name);
      continue;
    }
    // `type` 非字符串（畸形请求）不得让 mapTypeExpr 裸崩——按「认不出」
    // 降级为 unknown（与既有降级口径一致）。
    const type =
      binding !== null && typeof binding === "object" && typeof (binding as { type?: unknown }).type === "string"
        ? (binding as { type: string }).type
        : "";
    const group = bySite.get(site) ?? [];
    group.push({ name, type });
    bySite.set(site, group);
  }

  // 注入点 = **字符偏移**（Bug 1036）：行中声明落在它自己的字符位之前，
  // 行首声明落在整行之前（前置注释块整块上移）。
  const lines = rewritten.split("\n");
  const lineStarts: number[] = [0];
  for (let i = 0; i < rewritten.length; i++) {
    if (rewritten[i] === "\n") lineStarts.push(i + 1);
  }
  /** 该声明的注入字符偏移 */
  const insertionOffsetOf = (site: DeclSite): number => {
    const lineIdx = site.line - 1;
    const lineStart = lineStarts[lineIdx] ?? site.start;
    // 本行在声明之前只有空白 ⇒ 声明是本行的**第一条**语句 ⇒ 整行插入
    if (!/^\s*$/.test(rewritten.slice(lineStart, site.start))) return site.start;
    // 注入点上移：语句正上方若是**整块注释**（JSDoc / 前置注释），
    // 插在块**之前**而不是块与语句之间 ⇒ 注释块仍与语句相邻
    // （插在中间会把 JSDoc 从声明上摘掉 ⇒ `@nudo:mock` / `@nudo:contract`
    // 等 JSDoc 指令静默失效）。
    let idx = lineIdx;
    while (idx > 0 && isCommentOnlyLine(lines[idx - 1]!)) idx--;
    return lineStarts[idx] ?? lineStart;
  };

  const insertions: Array<{ offset: number; text: string }> = [];
  for (const [site, group] of bySite) {
    // 语句级 as 只能表达一个类型；拆分后正常一条声明一个。
    // 同一条声明被点名两次时只认第一个（第二个进 unapplied）。
    const b = group[0]!;
    const mapped = mapTypeExpr(b.type);
    insertions.push({
      offset: insertionOffsetOf(site),
      text: `// @nudo:as ${mapped.directive}`,
    });
    // 回显必须与**实际注入**一致：认不出的表达式注入的是 `unknown`，
    // 回显用户原文会把「已降级」说成「按原样应用」——降级时明说降到了什么。
    applied.push(
      mapped.faithful
        ? `${b.name}: ${b.type}`
        : `${b.name}: ${mapped.directive} (requested "${b.type}" is not expressible; applied as ${mapped.directive})`,
    );
    for (const shadowed of group.slice(1)) unapplied.push(shadowed.name);
  }
  // 从后往前插 ⇒ 先插的偏移不被后插的推移
  insertions.sort((a, b) => b.offset - a.offset);
  let out = rewritten;
  for (const ins of insertions) {
    out = out.slice(0, ins.offset) + ins.text + "\n" + out.slice(ins.offset);
  }
  return { source: out, applied, unapplied };
}

/**
 * 该行是否**只含注释**（行注释 / 块注释首行 / JSDoc 续行 `*`）。
 *
 * what-if 注入点上移的判据（见 `injectBindings`）：只有「整行都是注释」
 * 才算前置注释块的一行；`const a = 1; // 说明` 这种**代码 + 行尾注释**
 * 不算（它是上一条语句的尾巴，不是下一条语句的前置块）。
 */
function isCommentOnlyLine(line: string): boolean {
  return /^\s*(?:\/\/|\/\*|\*)/.test(line);
}
