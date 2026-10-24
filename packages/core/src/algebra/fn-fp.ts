/**
 * per-function fingerprint: after-edit only dirty fn + callers miss L0.
 *
 * - own: function declaration slice (incl. leading comments / refine)
 * - deps: transitively referenced sibling own hashes + non-fn top-level context
 * - context change (import/class/const...) -> all miss (conservative)
 *
 * Multi-declarator `const a = fn, b = fn` yields one fingerprint per function;
 * each own-slice is its own declarator (first also carries statement leading comments).
 */
import type { Node, File } from "@babel/types";
import { hashSource } from "./hash-source.ts";
import { stripStringsKeepComments } from "./code-text.ts";

export type FnFp = { own: string; deps: string; nRefs: number };

/** source → per-fn fingerprints. Key is full source (collision-safe); cap keeps
 *  retained text bounded: 24 × 1MB ≈ 24MB worst-case key strings. */
const fnFpCache = new Map<string, Map<string, FnFp>>();
const MAX_FN_FP_CACHE = 24;
/** Cap on cached whole-source keys so large monorepo sessions stay bounded. */
const MAX_FN_FP_SOURCE_CHARS = 1_000_000;

export function resetFnFpCache(): void {
  fnFpCache.clear();
}

type FnDeclInfo = {
  name: string;
  body: Node;
  /** Function/arrow node (own-slice end; also scanned for sibling refs incl. defaults). */
  fnNode: Node;
  /** Declarator start when from a VariableDeclaration; else undefined. */
  declaratorStart?: number;
  /** First leading-comment start on this declarator (multi-decl refine/@nudo). */
  declaratorLeadStart?: number;
};

/** Every top-level function binding in a declaration node (not just the first). */
export function getFnNameAndBodies(decl: Node): FnDeclInfo[] {
  const out: FnDeclInfo[] = [];
  if (decl.type === "FunctionDeclaration" && decl.id) {
    out.push({ name: decl.id.name, body: decl.body, fnNode: decl });
    return out;
  }
  if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) {
      if (
        d.id.type === "Identifier" &&
        d.init &&
        (d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression")
      ) {
        const comments = (d as { leadingComments?: Array<{ start?: number }> }).leadingComments;
        const first = comments?.[0];
        out.push({
          name: d.id.name,
          body: d.init.body,
          fnNode: d.init,
          declaratorStart: d.start ?? undefined,
          declaratorLeadStart: typeof first?.start === "number" ? first.start : undefined,
        });
      }
    }
  }
  return out;
}

function leadingSliceStart(stmt: Node, decl: Node): number {
  const comments =
    (stmt as { leadingComments?: Array<{ start?: number }> }).leadingComments ??
    (decl as { leadingComments?: Array<{ start?: number }> }).leadingComments;
  const first = comments?.[0];
  if (first && typeof first.start === "number") return first.start;
  return stmt.start ?? decl.start ?? 0;
}

/** Conservative: any top-level sibling name appearing in the body is a dep. */
function collectSiblingRefs(node: unknown, known: Set<string>, out: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown> & { type?: string };
  if (obj.type === "Identifier" && typeof obj.name === "string" && known.has(obj.name)) {
    out.add(obj.name);
  }
  for (const key of Object.keys(obj)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    if (
      (key === "key" || key === "property") &&
      (obj.type === "MemberExpression" ||
        obj.type === "ObjectProperty" ||
        obj.type === "ObjectMethod" ||
        obj.type === "ClassMethod" ||
        obj.type === "ClassProperty") &&
      obj.computed !== true
    ) {
      continue;
    }
    // Binding name, not a use: `function id() {}` / `class id {}` must not
    // count as a sibling ref (would make nRefs≥1 for every named decl and
    // permanently disable canSkipLiteralCallScan).
    if (
      key === "id" &&
      (obj.type === "FunctionDeclaration" ||
        obj.type === "FunctionExpression" ||
        obj.type === "ClassDeclaration" ||
        obj.type === "ClassExpression")
    ) {
      continue;
    }
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const x of v) collectSiblingRefs(x, known, out);
    } else if (v && typeof v === "object") {
      collectSiblingRefs(v, known, out);
    }
  }
}

/** 顶层函数绑定（own 片按声明器；指纹与可达性共用同一份勘测）。 */
type TopFnBinding = {
  name: string;
  fnNode: Node;
  /** own 片起点（首个声明器含语句前导注释，后续声明器含自身前导注释）。 */
  sliceStart: number;
  /** own 片终点（已按 `Math.max(end, sliceStart)` 收敛）。 */
  sliceEnd: number;
};

/**
 * 顶层绑定勘测（**唯一**一份）：函数绑定 + 类声明 + 非函数顶层语句。
 *
 * 指纹（`computeFnFingerprints` 的 own/deps/context）与可达性归因
 * （`reachableTopBindings`）共用本函数 ⇒「哪些顶层声明算函数/类」只有一个口径。
 * `contextStmts` 是非函数顶层语句（import / class / 顶层 const…），指纹把它
 * 整段折进 deps 的 context 哈希（保守：类或常量改动让所有函数变脏）。
 */
function topLevelBindings(file: File): {
  fns: TopFnBinding[];
  classes: Array<{ name: string; node: Node }>;
  contextStmts: Node[];
  /** 全部顶层语句（含函数声明语句；执行期归属勘测用，不参与指纹）。 */
  stmts: Node[];
} {
  const fns: TopFnBinding[] = [];
  const classes: Array<{ name: string; node: Node }> = [];
  const contextStmts: Node[] = [];
  const stmts: Node[] = file.program.body;

  for (const stmt of file.program.body) {
    let decl: Node = stmt;
    if (stmt.type === "ExportNamedDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    } else if (stmt.type === "ExportDefaultDeclaration" && stmt.declaration) {
      decl = stmt.declaration;
    }
    const fnInfos = getFnNameAndBodies(decl);
    if (fnInfos.length > 0) {
      const lead = leadingSliceStart(stmt, decl);
      for (let i = 0; i < fnInfos.length; i++) {
        const info = fnInfos[i]!;
        // First declarator carries statement leading comments; later ones start
        // at their own leading comments so sibling edits do not dirty this own-hash.
        const sliceStart =
          i === 0
            ? lead
            : (info.declaratorLeadStart ??
              info.declaratorStart ??
              info.fnNode.start ??
              lead);
        const end = info.fnNode.end ?? info.declaratorStart ?? decl.end ?? stmt.end ?? sliceStart;
        fns.push({
          name: info.name,
          fnNode: info.fnNode,
          sliceStart,
          sliceEnd: Math.max(end, sliceStart),
        });
      }
    } else {
      if (decl.type === "ClassDeclaration" && decl.id) {
        classes.push({ name: decl.id.name, node: decl });
      }
      contextStmts.push(stmt);
    }
  }
  return { fns, classes, contextStmts, stmts };
}

/** 源码跨度（行 1-based / 列 0-based，与 Babel `loc` 同口径）。 */
export type SourceSpan = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

/** 节点的源码跨度（无 loc ⇒ undefined）。 */
export function nodeSpan(node: unknown): SourceSpan | undefined {
  const loc = (
    node as
      | {
          loc?: {
            start?: { line?: number; column?: number };
            end?: { line?: number; column?: number };
          };
        }
      | undefined
  )?.loc;
  const st = loc?.start;
  const en = loc?.end;
  if (!st || !en || st.line === undefined || en.line === undefined) return undefined;
  return {
    startLine: st.line,
    startColumn: st.column ?? 0,
    endLine: en.line,
    endColumn: en.column ?? 0,
  };
}

/** 下钻时跳过的非 AST 键（位置 / 注释 / 原始文本缓存）。 */
const NON_AST_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "comments",
  "tokens",
  "errors",
]);

type MemberLikeNode = Node & {
  computed?: boolean;
  static?: boolean;
  key?: unknown;
  value?: unknown;
  params?: unknown[];
  body?: unknown;
  decorators?: unknown[];
};

/**
 * 收集**装载期之外**（推迟执行）的源码跨度。
 *
 * 判据只看**执行时机**（不是绑定名勘测；顶层语句清单来自
 * {@link topLevelBindings}，不另做一份勘测）：
 * - 函数（声明 / 表达式 / 箭头）整棵推迟 —— 调用时才跑（含参数默认值）；
 * - 方法（对象 / 类）：函数体与参数默认值推迟；**计算键**不推迟（定义期求值）；
 * - 类字段：实例字段初始化器推迟（`new` 时跑）；静态字段初始化器不推迟
 *   （装载期跑），但其内部的函数体照常推迟；计算键不推迟；
 * - `static {}` 块不推迟（装载期跑），内部函数体照常推迟。
 *
 * 装饰器表达式在定义期求值 ⇒ 不推迟（内部函数体照常按上面规则推迟）。
 */
function collectDeferredSpans(node: unknown, out: SourceSpan[]): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const x of node) collectDeferredSpans(x, out);
    return;
  }
  const n = node as MemberLikeNode;
  const t = n.type;
  if (
    t === "FunctionDeclaration" ||
    t === "FunctionExpression" ||
    t === "ArrowFunctionExpression"
  ) {
    const span = nodeSpan(n);
    if (span) out.push(span);
    return;
  }
  if (t === "ObjectMethod" || t === "ClassMethod" || t === "ClassPrivateMethod") {
    // 计算键在类/对象**定义期**求值 ⇒ 键子树照常下钻（其中的函数体仍推迟）
    if (n.computed === true) collectDeferredSpans(n.key, out);
    collectDeferredSpans(n.decorators, out);
    for (const p of n.params ?? []) {
      const span = nodeSpan(p);
      if (span) out.push(span);
    }
    const bodySpan = nodeSpan(n.body);
    if (bodySpan) out.push(bodySpan);
    return;
  }
  if (
    t === "ClassProperty" ||
    t === "ClassPrivateProperty" ||
    t === "ClassAccessorProperty"
  ) {
    if (n.computed === true) collectDeferredSpans(n.key, out);
    collectDeferredSpans(n.decorators, out);
    if (n.static === true) {
      // 静态初始化器在装载期执行 ⇒ 不推迟（内部函数体照常下钻）
      collectDeferredSpans(n.value, out);
    } else {
      // 实例字段初始化器在 `new` 时执行 ⇒ 整段推迟
      const span = nodeSpan(n.value);
      if (span) out.push(span);
    }
    return;
  }
  const fields = n as unknown as Record<string, unknown>;
  for (const key of Object.keys(fields)) {
    if (NON_AST_KEYS.has(key)) continue;
    collectDeferredSpans(fields[key], out);
  }
}

/** 同一份 AST 的推迟跨度缓存（归因面每个入口查一次，不缓存就是 O(入口数 × AST)）。 */
const deferredSpanCache = new WeakMap<File, SourceSpan[]>();

/**
 * **装载期之外**（推迟执行）的源码跨度清单 —— L2 fail-closed 归因用。
 *
 * 装载期（module-init）= 顶层语句体 / 顶层初始化表达式 / 类定义期执行面
 * （`static {}`、静态字段初始化器、计算键、`extends` 表达式）：这些东西先于
 * **任何**入口调用执行。位置落在返回的跨度**内** = 某次调用 / `new` 才跑 ⇒
 * 归因按入口可达性（Bug 1153）；落在**外** = 装载期 ⇒ 归因到**每个**入口
 * （Bug 1155）。
 *
 * 保守边界：立即调用函数表达式（IIFE）的函数体按 AST 结构属于函数体 ⇒
 * 记入推迟面（不归因；与改造前一致，宁可少报）。
 */
export function deferredExecutionSpans(file: File): SourceSpan[] {
  const hit = deferredSpanCache.get(file);
  if (hit) return hit;
  const out: SourceSpan[] = [];
  for (const stmt of topLevelBindings(file).stmts) collectDeferredSpans(stmt, out);
  deferredSpanCache.set(file, out);
  return out;
}

/** 顶层绑定引用图（函数绑定；`includeClasses` 时类声明也是节点）。 */
type ReachGraph = {
  nodes: Map<string, Node>;
  /** 名 → 直接引用的兄弟顶层绑定名。 */
  edges: Map<string, Set<string>>;
};

/** 同一份 AST 的图缓存：`computeFnFingerprints` 每个函数查一次闭包，
 *  不缓存就是 O(函数数 × AST) 的重复遍历。 */
const reachGraphCache = new WeakMap<File, { fnsOnly?: ReachGraph; withClasses?: ReachGraph }>();

/**
 * 顶层可达性图。
 *
 * 类节点只在 `includeClasses` 时为节点：指纹的 deps 只认**兄弟函数**
 * （类名进图会改变 `nRefs`/deps ⇒ generalize memo 键漂移），而归因面需要
 * 「函数入口 `new K()` ⇒ K 的构造器/方法体可达」。两种图各自缓存。
 */
function reachGraphOf(file: File, includeClasses: boolean): ReachGraph {
  const cached = reachGraphCache.get(file);
  const hit = includeClasses ? cached?.withClasses : cached?.fnsOnly;
  if (hit) return hit;

  const nodes = new Map<string, Node>();
  const bindings = topLevelBindings(file);
  for (const fn of bindings.fns) nodes.set(fn.name, fn.fnNode);
  if (includeClasses) {
    for (const cls of bindings.classes) {
      // 同名不覆盖（合法源码里函数/类不能同名；重复 var 声明按首个节点保守处理）
      if (!nodes.has(cls.name)) nodes.set(cls.name, cls.node);
    }
  }

  const edges = new Map<string, Set<string>>();
  const known = new Set(nodes.keys());
  for (const [name, node] of nodes) {
    const refs = new Set<string>();
    collectSiblingRefs(node, known, refs);
    edges.set(name, refs);
  }

  const graph: ReachGraph = { nodes, edges };
  const slot = cached ?? {};
  if (includeClasses) slot.withClasses = graph;
  else slot.fnsOnly = graph;
  reachGraphCache.set(file, slot);
  return graph;
}

/** 从直接引用集合出发的传递闭包（`seen` 收敛 ⇒ 互递归必终止）。 */
function closureFrom(edges: Map<string, Set<string>>, startRefs: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...startRefs];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return seen;
}

/** 可达的顶层绑定（名字 + AST 节点）。 */
export type TopBindingReach = { name: string; node: Node };

/**
 * 从入口节点出发**可达**的顶层绑定（传递闭包）。
 *
 * L2 fail-closed 归因用：转译器拒绝的构造落在入口**可达的辅助函数 / 类**
 * 里时，该入口的 total 性同样不可判定（同一函数体内联与拆到辅助函数等价）。
 *
 * - `start` 为字符串 ⇒ 按顶层绑定名取节点（函数绑定或类声明）；
 * - `start` 为 AST 节点 ⇒ 直接以该节点为起点（类方法入口用**方法节点**，
 *   不牵连同类的其它方法）；直接引用的扫描范围 = 该节点整棵子树。
 * - `includeClasses`（默认 `true`）：类声明也是图节点。指纹侧传 `false`
 *   ⇒ 输出与改造前逐字节一致。
 *
 * 结果**不含**起点自身（除非环回：递归/互递归会把它带回来）。互递归靠
 * `closureFrom` 的 `seen` 收敛 ⇒ 必终止。
 */
export function reachableTopBindings(
  file: File,
  start: string | Node,
  opts: { includeClasses?: boolean } = {},
): TopBindingReach[] {
  const graph = reachGraphOf(file, opts.includeClasses !== false);
  const startNode = typeof start === "string" ? graph.nodes.get(start) : start;
  if (!startNode) return [];
  // 字符串起点 = 图节点 ⇒ 直接复用它预先算好的直接引用（免二次扫描）；
  // AST 节点起点（类方法等非图节点）现扫该子树。两种口径都是
  // `collectSiblingRefs`。
  const refs =
    typeof start === "string"
      ? (graph.edges.get(start) ?? new Set<string>())
      : (() => {
          const s = new Set<string>();
          collectSiblingRefs(startNode, new Set(graph.nodes.keys()), s);
          return s;
        })();
  const out: TopBindingReach[] = [];
  for (const name of closureFrom(graph.edges, refs)) {
    const node = graph.nodes.get(name);
    if (node) out.push({ name, node });
  }
  return out;
}

function computeFnFingerprints(source: string, file: File): Map<string, FnFp> {
  const { fns, contextStmts } = topLevelBindings(file);
  const contextParts: string[] = [];
  for (const stmt of contextStmts) {
    if (typeof stmt.start === "number" && typeof stmt.end === "number") {
      contextParts.push(source.slice(stmt.start, stmt.end));
    } else {
      contextParts.push(stmt.type);
    }
  }

  const context = hashSource(contextParts.join("\n "));
  const own = new Map<string, string>();
  for (const fn of fns) own.set(fn.name, hashSource(source.slice(fn.sliceStart, fn.sliceEnd)));

  const result = new Map<string, FnFp>();
  for (const fn of fns) {
    // 按**名字**取闭包（与改造前的 `edges.get(name)` 同口径：重名 var 声明
    // 取最后一条）；`includeClasses:false` ⇒ deps 只含兄弟函数。
    const depParts: string[] = [];
    for (const reach of reachableTopBindings(file, fn.name, { includeClasses: false })) {
      depParts.push(`${reach.name}=${own.get(reach.name) ?? "?"}`);
    }
    depParts.sort();
    result.set(fn.name, {
      own: own.get(fn.name)!,
      deps: hashSource(`${depParts.join(",")} ${context}`),
      nRefs: depParts.length,
    });
  }
  return result;
}

/** source -> (fnName -> own/deps); LRU */
export function fnFingerprints(source: string, file: File): Map<string, FnFp> {
  if (source.length > MAX_FN_FP_SOURCE_CHARS) {
    return computeFnFingerprints(source, file);
  }
  const hit = fnFpCache.get(source);
  if (hit !== undefined) {
    fnFpCache.delete(source);
    fnFpCache.set(source, hit);
    return hit;
  }
  const fp = computeFnFingerprints(source, file);
  if (fnFpCache.size >= MAX_FN_FP_CACHE) {
    const oldest = fnFpCache.keys().next().value;
    if (oldest !== undefined) fnFpCache.delete(oldest);
  }
  fnFpCache.set(source, fp);
  return fp;
}

/** L0 source part: per-fn fingerprint when AST available; else full-file hash */
export function generalizeSourceKeyPart(
  source: string,
  fnName: string,
  file?: File,
): string {
  if (!file) return `w:${hashSource(source)}`;
  const fp = fnFingerprints(source, file).get(fnName);
  if (fp) return `f:${fp.own}:${fp.deps}`;
  return `u:${hashSource(source)}`;
}

/** Any CallExpression / NewExpression / dynamic import in the AST. */
function hasAnyCallLike(node: unknown, depth = 0): boolean {
  if (!node || typeof node !== "object") return false;
  // Depth cap: unexplored subtree must be treated as "may contain a call"
  // (return true). Returning false would let canSkipLiteralCallScan skip
  // scanLiteralCalls and miss constraint violations in deep expressions.
  if (depth > 80) return true;
  const obj = node as Record<string, unknown> & { type?: string };
  if (
    obj.type === "CallExpression" ||
    obj.type === "NewExpression" ||
    obj.type === "OptionalCallExpression" ||
    obj.type === "ImportExpression"
  ) {
    return true;
  }
  for (const key of Object.keys(obj)) {
    if (
      key === "loc" ||
      key === "start" ||
      key === "end" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments"
    ) {
      continue;
    }
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const x of v) if (hasAnyCallLike(x, depth + 1)) return true;
    } else if (v && typeof v === "object") {
      if (hasAnyCallLike(v, depth + 1)) return true;
    }
  }
  return false;
}

function hasModuleSyntax(file: File): boolean {
  for (const stmt of file.program.body) {
    if (stmt.type === "ImportDeclaration") return true;
    if (stmt.type === "ExportAllDeclaration") return true;
    if (stmt.type === "ExportNamedDeclaration" && stmt.source) return true;
  }
  return false;
}

/**
 * 无 refine、无模块语法、无兄弟调用、无任何调用表达式 → scanLiteralCalls 可整段跳过。
 * 必须保守：`const x = f(-1)` / `if (f(-1))` / `require("x")` 都含 CallExpression，
 * 只认顶层 ExpressionStatement 会漏报约束违规。
 */
export function canSkipLiteralCallScan(source: string, file: File): boolean {
  // 指令住注释：字符串里的 `@nudo:contract` 不挡跳过
  if (stripStringsKeepComments(source).includes("@nudo:contract")) return false;
  if (hasModuleSyntax(file)) return false;
  if (hasAnyCallLike(file)) return false;
  const fps = fnFingerprints(source, file);
  for (const fp of fps.values()) {
    if (fp.nRefs > 0) return false;
  }
  return true;
}
