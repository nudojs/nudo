/**
 * LSP 表面 — Abs 重放/执行记录域（位置求值态 + 绑定面 + 局部投影）。
 *
 * owns：SurfaceReuse 复用载荷、引擎节点级 Abs 重放（replayFnAbsNodes +
 * LRU 缓存 + absNodeAtPosition——流敏感窄化为引擎求值语义）、标识符
 * 绑定面（absFromEval / absFromCaseReplay）、公共位置查询
 * （getAbsAtPosition / getTypeAtPosition 及 async 预加载变体）、
 * 体内局部投影（执行记录插桩 runTranspiled + callTranspiledExportFull
 * → projectLocalAbs，按源指纹缓存）。
 *
 * SSR 不变量：模块级可变状态（absNodeReplayCache / fnLocalsCache）
 * 只在本模块定义与消费——不经门面（lsp-surface.ts）re-export 转发，
 * 兄弟模块直接 import 本模块的函数（vite SSR 循环图里 re-export 非
 * 实例化期绑定会拿到 undefined）。
 * 不 owns：光标定位走访（position.ts）、hover 渲染（hover.ts）。
 */
import { dirname } from "node:path";
import type { File, Node } from "@babel/types";
import { traverseEsm } from "../traverse-esm.ts";
import {
  and,
  callTranspiledExportFull,
  generalizeFromAst,
  joinAbs,
  leqAbs,
  runTranspiled,
  setEvalAssignCollector,
  setEvalCallCollector,
  setPosCollector,
  type Abs,
  type AbsModuleExports,
  type EvalAbsAssignRecord,
  type EvalCallRecord,
  type EvalPosRecord,
  type Phi,
  type PolyFn,
} from "@nudojs/core";
import { extractDirectivesQuiet, parse } from "@nudojs/parser";
import { preloadPathEnvs } from "@nudojs/service/evaluator";
import {
  collectAbsBindingsFromGraph,
  collectEnvNames,
  mockDirectivesToAbsSeeds,
  type AnalysisResult,
  type LoadModule,
} from "@nudojs/service";
import {
  findEnclosingFunction,
  findIdentNameAtPosition,
  type EnclosingFn,
} from "./position.ts";
/**
 * 高频 IDE 入口（hover / completion / signatureHelp）的复用载荷：
 * - `result`：getCachedOrAnalyze 的 AnalysisResult——提供时绑定查询直接读
 *   `result.bindings`（analyzeFile 已算过同源 collectAbsBindingsFromGraph），
 *   不再每次 transpile + new Function 整文件求值；
 * - `ast`：随条目缓存的文件 AST（cachedAstFor），替代各 helper 内部重复 parse。
 * 两者都可缺省——缺省时回落旧行为（内部 parse + 全量求值），公共签名不变。
 */
export type SurfaceReuse = {
  result?: AnalysisResult;
  ast?: File;
  /**
   * eval 模块图（`evalAnalysisModules` 组装）。函数名 hover 的 intension
   * （generalizeFromAst）必须带图：缺图时跨模块 import 塌缩 unknown，
   * 求值引擎的精确结果反而被 `(_p0: A1) => unknown` 兜底盖住。
   */
  modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
};

/** SurfaceReuse.result.bindings 的单绑定读（缺省安全） */
export function reuseBinding(reuse: SurfaceReuse | undefined, name: string): Abs | undefined {
  return reuse?.result?.bindings.get(name)?.abs;
}

/**
 * 引擎节点级 Abs 重放（hover 求值态面）：transpile
 * （recordPositions 插桩）+ 符号执行导出函数（入口
 * Φ 种子 + 契约参数 Abs）——收集 (行:列) → 求值态
 * Abs。流敏感窄化为**引擎求值语义**（Φ-native B：
 * $fork 臂内 withExecPhi(Φ∧test) + $narrowMemberEq /
 * $narrowTypeOf / $removeNullish 剪影——早退守卫 /
 * 判别等值 / typeof 守卫 / && / || 链全覆盖），非
 * LSP 层近似。fail-closed：求值失败 / 预算超限 →
 * undefined（调用方回落声明形态面）。
 */
function replayFnAbsNodes(
  source: string,
  opts: {
    fnName: string;
    args: Abs[];
    phi?: Phi;
    modules?: SurfaceReuse["modules"];
  },
): Map<string, Abs> | undefined {
  const collected = new Map<string, Abs>();
  const prev = setPosCollector((r: EvalPosRecord) => {
    const key = `${r.line}:${r.column}`;
    if (!collected.has(key)) collected.set(key, r.abs);
  });
  try {
    const exports = runTranspiled(source, {
      mode: "analyze",
      modules: opts.modules,
      recordPositions: true,
    });
    callTranspiledExportFull(exports, opts.fnName, opts.args, {
      phi: opts.phi,
    });
    return collected;
  } catch {
    return undefined;
  } finally {
    setPosCollector(prev);
  }
}

/** 重放缓存（filePath#fnName → 源码 + 位置表）：
 * hover 高频——同源码同函数不重跑；容量有界
 * （超限清空——会话级 hover 函数集合有界） */
const absNodeReplayCache = new Map<
  string,
  { source: string; nodes: Map<string, Abs> | undefined }
>();
const ABS_NODE_REPLAY_CACHE_MAX = 64;

/** LRU 淘汰：Map 迭代序 = 插入序，命中即 delete+set 移到最新端；
 * 超限删最旧（首个 key）。此前为「超限全清」——多文件浏览填满后
 * 一次清空，后续 hover 全部冷重放（大文件同步重放数百 ms），编辑/
 * 诊断/inlay 同一事件循环排队，客户端感知 hover 卡死无响应。 */
function replayCacheGet(key: string) {
  const hit = absNodeReplayCache.get(key);
  if (hit !== undefined) {
    absNodeReplayCache.delete(key);
    absNodeReplayCache.set(key, hit);
  }
  return hit;
}

function replayCachePut(key: string, entry: { source: string; nodes: Map<string, Abs> | undefined }) {
  if (absNodeReplayCache.size >= ABS_NODE_REPLAY_CACHE_MAX) {
    const oldest = absNodeReplayCache.keys().next().value;
    if (oldest !== undefined) absNodeReplayCache.delete(oldest);
  }
  absNodeReplayCache.set(key, entry);
}

/**
 * 位置求值态 Abs（引擎重放面）：仅顶层导出函数且
 * 契约参数 Abs 齐备（Identifier 形参逐一有入口
 * Abs——解构 / 无契约形参不重放，回落声明形态面）。
 * 位置键 = Babel 口径（1-based 行，0-based 列——
 * 与插桩记录同口径）。
 */
export function absNodeAtPosition(
  filePath: string,
  source: string,
  encFn: EnclosingFn,
  g: PolyFn,
  reuse: SurfaceReuse | undefined,
  line: number,
  column: number,
  fileAst?: ReturnType<typeof parse>,
): Abs | undefined {
  const entryReqs = g.entryReqs;
  if (!entryReqs || entryReqs.length === 0) return undefined;
  const params = (encFn.node as { params?: Node[] }).params;
  if (!params || params.length === 0) return undefined;
  const args: Abs[] = [];
  for (const p of params) {
    if (p.type !== "Identifier") return undefined;
    const abs = g.entryShapes?.get(p.name)?.abs;
    if (abs === undefined) return undefined;
    args.push(abs);
  }
  const cacheKey = `${filePath}#${encFn.name}`;
  const cached = replayCacheGet(cacheKey);
  let nodes: Map<string, Abs> | undefined;
  if (cached && cached.source === source) {
    nodes = cached.nodes;
  } else {
    nodes = replayFnAbsNodes(source, {
      fnName: encFn.name,
      args,
      phi: and(...entryReqs.map((r) => r.pred)),
      modules: reuse?.modules,
    });
    replayCachePut(cacheKey, { source, nodes });
  }
  const exact = nodes?.get(`${line}:${column}`);
  if (exact !== undefined || nodes === undefined) return exact;
  // 词中 / 非标识符位回落：记录键 = Babel 起始位（$nudoPos 用 loc.start）
  // ——光标在节点跨距内但不在起始列时精确键 miss，回落到跨距解析。
  // 候选泛化为**任意带 loc 节点**（return 关键字位 / 表达式内非标识符
  // 位（`?.[` / `[0]`）由 ReturnStatement / MemberExpression 记录覆盖），
  // 仅当该节点起始键已有记录才参赛，取最小 span——词中标识符位
  // 标识符节点 span 最小且其值读记录在起始键上，行为不变
  let best: { key: string; span: number } | undefined;
  try {
    if (fileAst) {
      traverseEsm()(fileAst, {
        enter(path) {
          const loc = path.node.loc;
          if (!loc) return;
          const { start, end } = loc;
          // 跨行包含：行区间内（同行看列区间；Babel end.column 为
          // exclusive 字符区间——尾列容忍与既有标识符口径一致）
          if (line < start.line || line > end.line) return;
          if (line === start.line && column < start.column) return;
          if (line === end.line && column > end.column) return;
          const key = `${start.line}:${start.column}`;
          if (!nodes.has(key)) return;
          const span = (end.line - start.line) * 100000 + (end.column - start.column);
          if (best === undefined || span < best.span) best = { key, span };
        },
      });
    }
  } catch {
    // fail-closed：跨距解析失败 → 保持精确键 miss
  }
  return best !== undefined ? nodes.get(best.key) : undefined;
}

/** 重放求值态是否「未窄化」：与入口 Abs
 * 等价（leqAbs 双向）——未窄化（声明位 /
 * 检查点）或仅剥 nullish（早退守卫 / 成员
 * 访问对象 / 落回位）→ 声明形态折叠面
 * 保持用户口径；否则（判别等值 / !== 对偶
 * / typeof 守卫窄化、槽位读、局部量）
 * → 求值态展示 */
export function isUnnarrowedAbs(a: Abs, entry: Abs): boolean {
  if (absEquiv(a, entry)) return true;
  const nonNullish = nonNullishPartOf(entry);
  return nonNullish !== undefined && absEquiv(a, nonNullish);
}

function absEquiv(a: Abs, b: Abs): boolean {
  return leqAbs(a, b, {}).ok && leqAbs(b, a, {}).ok;
}

/** 入口 Abs 的非 nullish 部分（sum 成员
 * 过滤 nullish 字面量臂——`nullable(X)`
 * → X）；非 sum / 无 nullish 臂 →
 * undefined（入口本身即非空——无需剥） */
function nonNullishPartOf(entry: Abs): Abs | undefined {
  const sh = entry.shape as { k: string; members?: Abs[] };
  if (sh.k !== "sum" || !sh.members) return undefined;
  const kept = sh.members.filter((m) => !isNullishLitMember(m));
  if (kept.length === sh.members.length) return undefined;
  let out = kept[0];
  for (const m of kept.slice(1)) out = joinAbs(out, m);
  return out;
}

function isNullishLitMember(m: Abs): boolean {
  const t = m.term as { op?: string; value?: unknown } | undefined;
  return t?.op === "lit" && (t.value === null || t.value === undefined);
}

/** Async entry to getTypeAtPosition with path-env preloading (see analyzeFileAsync). */
export async function getTypeAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): Promise<Abs | null> {
  const envNames = collectEnvNames(filePath, source, false);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return getTypeAtPosition(filePath, source, line, column, activeCases);
}

/** Async entry to getAbsAtPosition（与 getTypeAtPositionAsync 同预加载口径） */
export async function getAbsAtPositionAsync(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): Promise<Abs | null> {
  const envNames = collectEnvNames(filePath, source, false);
  if (envNames.length > 0) {
    await preloadPathEnvs(envNames, dirname(filePath));
  }
  return getAbsAtPosition(filePath, source, line, column, activeCases);
}

/** 光标是否落在带 @nudo:case 的函数体内（该区域 hover/inlay 须走 Abs + activeCases）。 */
export function positionInsideCaseFunction(
  source: string,
  ast: ReturnType<typeof parse> | undefined,
  line: number,
  column?: number,
): boolean {
  if (!ast) return false;
  try {
    const enclosing = findEnclosingFunction(ast, line, column ?? 0);
    if (!enclosing) return false;
    return extractDirectivesQuiet(ast).some(
      (f) => f.node === enclosing.node && f.directives.some((d) => d.kind === "case"),
    );
  } catch {
    return false;
  }
}

/**
 * evaluator 节点表 / 标识符绑定上的无损 Abs（不经 TypeValue）。
 * 用例函数体内返回 null——那里走 case Abs 重放（见 absFromCaseReplay）。
 * reuse 提供 AnalysisResult 时绑定查询直接读 result.bindings（analyzeFile
 * 同源产物），跳过 collectAbsBindingsFromGraph 的整文件求值。
 */
export function absFromEval(
  filePath: string,
  source: string,
  line: number,
  column: number,
  ast: ReturnType<typeof parse> | undefined,
  reuse?: SurfaceReuse,
): Abs | null {
  if (!ast) return null;
  // fail-closed：节点级 Abs 收集（collectAbsNodeTypes/evalProgramAbs）已删；
  // 仅标识符绑定面（evalAbsModuleGraph 的 collectAbsBindingsFromGraph）
  if (positionInsideCaseFunction(source, ast, line)) return null;
  try {
    const ident = findIdentNameAtPosition(source, line, column, ast);
    if (ident) {
      if (reuse?.result) {
        // 分析结果同源绑定面：命中即返回；无绑定 = 无信息（不再跑全量求值兜底）
        return reuseBinding(reuse, ident) ?? null;
      }
      const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
      const binds = collectAbsBindingsFromGraph(source, filePath, {
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
      });
      const bound = binds.get(ident);
      if (bound) return bound;
    }
  } catch {
    /* fall through */
  }
  return null;
}

/**
 * fail-closed：用例函数体的 Abs 重放（evalSource + 节点收集）已删——
 * case 选中态的光标 Abs 不再有执行态重放（entry 态 Abs 由上层面提供）。
 */
export function absFromCaseReplay(
  _filePath: string,
  _source: string,
  _line: number,
  _column: number,
  _ast?: File,
  _activeCases?: Map<string, number>,
): Abs | null {
  return null;
}

/**
 * 光标处无损 Abs。evaluator 节点表优先；用例函数体走 Abs 重放。
 */
export function getAbsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
  reuse?: SurfaceReuse,
): Abs | null {
  const ast = reuse?.ast ?? parse(source);

  const fromB = absFromEval(filePath, source, line, column, ast, reuse);
  if (fromB) return fromB;

  // 用例函数体：按 activeCases 选中 case 做 Abs 重放
  if (positionInsideCaseFunction(source, ast, line)) {
    const fromCase = absFromCaseReplay(filePath, source, line, column, ast, activeCases);
    if (fromCase) return fromCase;
  }

  return null;
}

/** 光标处类型（Abs）。evaluator 节点表优先；用例函数体走 Abs 重放。 */
export function getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
  reuse?: SurfaceReuse,
): Abs | null {
  return getAbsAtPosition(filePath, source, line, column, activeCases, reuse);
}

/**
 * 体内局部 Abs 投影（hover C 面）。观测通道 = 执行记录插桩：
 * - 调用初始化 `const vetos = vetoFindings(x)` → EvalCallRecord.result
 *   （callLoc 与声明 init 的 loc 精确对位）；
 * - 再赋值 `let acc; acc = …` → EvalAbsAssignRecord.next（范围内 join）。
 * 一次 entry 实参调用（typeParams.value，契约种子已注入）驱动全 body。
 * 结果按 (file, fn, 源指纹) 缓存——hover 连续触发不重跑。
 */
const fnLocalsCache = new Map<string, Map<string, Abs> | null>();

function hashSource(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length}:${(h >>> 0).toString(36)}`;
}

export function projectLocalAbs(
  filePath: string,
  source: string,
  enc: EnclosingFn,
  g: PolyFn,
  ident: string,
  modules?: SurfaceReuse["modules"],
): Abs | undefined {
  const key = `${filePath}|${enc.name}|${hashSource(source)}`;
  let locals = fnLocalsCache.get(key);
  if (locals === undefined) {
    locals = collectEnclosingFnLocals(source, enc, g, modules);
    if (fnLocalsCache.size >= 32) {
      const oldest = fnLocalsCache.keys().next().value;
      if (oldest !== undefined) fnLocalsCache.delete(oldest);
    }
    fnLocalsCache.set(key, locals); // null（求值失败）也缓存——失败不重跑
  }
  return locals?.get(ident);
}

function collectEnclosingFnLocals(
  source: string,
  enc: EnclosingFn,
  g: PolyFn,
  modules?: SurfaceReuse["modules"],
): Map<string, Abs> | null {
  const assigns: EvalAbsAssignRecord[] = [];
  const calls: EvalCallRecord[] = [];
  const prevAssign = setEvalAssignCollector((r) => assigns.push(r));
  const prevCall = setEvalCallCollector((r) => calls.push(r));
  try {
    const run = runTranspiled(source, {
      mode: "analyze",
      ...(modules
        ? { modules: modules as Record<string, AbsModuleExports | Record<string, unknown>> }
        : {}),
    });
    if (!Object.hasOwn(run, enc.name)) return null;
    const args = g.typeParams.map((t) => t.value);
    const phi: Phi | undefined =
      g.entryReqs && g.entryReqs.length > 0
        ? g.entryReqs.length === 1
          ? g.entryReqs[0]!.pred
          : ({ op: "and", args: g.entryReqs.map((r) => r.pred) } as Phi)
        : undefined;
    callTranspiledExportFull(run, enc.name, args, phi ? { phi } : undefined);
  } catch {
    // fail-closed：求值失败 → 无局部面（不拖垮 hover）
    return null;
  } finally {
    setEvalAssignCollector(prevAssign);
    setEvalCallCollector(prevCall);
  }
  const loc = (enc.node as { loc?: { start: { line: number }; end: { line: number } } }).loc;
  const out = new Map<string, Abs>();
  // 调用初始化声明 → 调用记录 result（callLoc 对位 init 起点）。
  // 帧过滤（depth === 0）：递归函数内层帧以重入态重执行同一调用位
  // （含 cycle 截断的 opaque unknown），不代表本函数单次入口的绑定值；
  // 顶层帧的同位多条记录（联合 fork）做 join——路径不敏感的诚实答案
  for (const d of declaredCallInits(enc.node)) {
    const recs = calls.filter(
      (c) =>
        c.callLoc &&
        c.callLoc.line === d.line &&
        c.callLoc.column === d.column &&
        (c.depth ?? 0) === 0,
    );
    if (recs.length > 0) {
      out.set(d.name, recs.map((c) => c.result).reduce((a, b) => joinAbs(a, b)));
    }
  }
  // 范围内再赋值 → join（路径不敏感的诚实答案）。
  // 帧过滤同上：递归内层帧的重入赋值不算本函数单次入口的绑定流
  if (loc) {
    for (const r of assigns) {
      if ((r.depth ?? 0) !== 0) continue;
      if (r.line === undefined || r.line < loc.start.line || r.line > loc.end.line) continue;
      const prev = out.get(r.name);
      out.set(r.name, prev ? joinAbs(prev, r.next) : r.next);
    }
  }
  return out;
}

/**
 * enclosing 函数体内（不含嵌套函数作用域）调用初始化的变量声明：
 * `const x = f(…)` → { name: x, init 调用起点 }。
 * 手写 AST 走访（不下钻 Function/ObjectMethod/ClassMethod——闭包
 * 有自己的作用域，hover 闭包内标识符时 enclosing 即闭包自身）。
 */
const NESTED_SCOPE_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

function declaredCallInits(fnNode: Node): Array<{ name: string; line: number; column: number }> {
  const out: Array<{ name: string; line: number; column: number }> = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      id?: { type?: string; name?: string };
      init?: { type?: string; loc?: { start: { line: number; column: number } } };
    };
    if (n.type === "VariableDeclarator") {
      const start = n.init?.loc?.start;
      if (
        n.id?.type === "Identifier" &&
        n.init?.type === "CallExpression" &&
        start
      ) {
        out.push({ name: n.id.name!, line: start.line, column: start.column });
      }
    }
    if (n !== fnNode && typeof n.type === "string" && NESTED_SCOPE_TYPES.has(n.type)) return;
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end" || k.endsWith("Comments")) continue;
      const v = (node as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        for (const c of v) walk(c);
      } else if (v && typeof v === "object" && typeof (v as { type?: string }).type === "string") {
        walk(v);
      }
    }
  };
  walk(fnNode);
  return out;
}

// ---------------------------------------------------------------------------
// 作用域绑定面（Bug 789 · 绑定下沉）
// ---------------------------------------------------------------------------

/**
 * 作用域感知的绑定查询（Bug 789 · 绑定下沉）。
 *
 * 成员补全面要拿到**接收者**的 Abs 才能投影成员表，而接收者 Abs 的唯一
 * 来源是 `reuseBinding`（模块级 `result.bindings`）⇒ 该表由 service 的
 * `collectBindings` 填充，**只遍历顶层语句**（函数体内不递归）⇒ 函数局部
 * 量 / 形参**不在表里** ⇒ 成员面一律零候选（连 `string` 局部量也是 0 项）
 * ⇒ 「决定补全成败的不是接收者什么类型，而是它声明在不在模块顶层」。
 *
 * 本查询按**光标所在作用域**解析名字：
 * - **形参**：契约种子 Abs（`generalizeFromAst` 的 `entryShapes`）——与 hover
 *   的「A 参数面」同源；无契约 ⇒ 形参无约束 ⇒ 不给 Abs（不猜）。
 * - **局部量**：引擎节点级 Abs 重放（`recordPositions` 插桩在**声明位**记录
 *   初始化求值态 Abs）——与模块级绑定面同口径（都是「声明值」）。
 *
 * fail-closed：解析 / 求值失败 ⇒ undefined（调用方回落模块级绑定面）。
 *
 * 作用域 = **光标所在的最内层 enclosing 函数**（`findEnclosingFunction`，行粒度
 * 判定——与 hover 求值面同口径）；闭包变量（声明在外层函数）不在本查询口径内
 * ⇒ 落回模块级绑定面。
 *
 * `parseText` 必须是**消毒后**的源码（尾随点改写成合法成员访问）——与
 * 重放用的文本同一份 ⇒ AST 位置与插桩记录键同坐标系。
 */
export function lookupScopedBinding(
  filePath: string,
  parseText: string,
  line: number,
  column: number,
  name: string,
  reuse: SurfaceReuse | undefined,
  opts?: { loadModule?: LoadModule; autoBind?: boolean },
): Abs | undefined {
  const ast = scopeAst(parseText);
  if (!ast) return undefined;
  const enc = findEnclosingFunction(ast, line, column);
  if (!enc) return undefined;
  const decl = scopeDeclaration(enc.node, name);
  if (!decl) return undefined;
  const params = (enc.node as { params?: Node[] }).params ?? [];
  // 无参函数不需要泛化（契约种子只在有形参时才有意义）⇒ 免掉侧车指纹 I/O
  const g =
    params.length > 0
      ? generalizeScoped(enc.name, parseText, ast, filePath, reuse, opts)
      : undefined;
  if (decl.kind === "param") return g?.entryShapes?.get(name)?.abs;
  const nodes = scopedReplayNodes(filePath, parseText, enc, g, reuse);
  return nodes?.get(`${decl.line}:${decl.column}`);
}

/** 作用域分析的 AST（parseText 已是消毒文本——消毒不改标识符位置）。 */
function scopeAst(parseText: string): File | undefined {
  try {
    return parse(parseText);
  } catch {
    return undefined;
  }
}

/** 作用域内的名字声明：形参 / 局部量（局部量带**声明位**——重放的记录键）。 */
type ScopeDecl = { kind: "param" } | { kind: "local"; line: number; column: number };

/**
 * enclosing 函数作用域内的声明（形参 + 体内局部量）。
 *
 * 体内局部量：不下钻嵌套函数作用域（嵌套函数有自己的作用域——hover 闭包内
 * 标识符时 enclosing 即闭包自身）。
 */
function scopeDeclaration(fnNode: Node, name: string): ScopeDecl | undefined {
  const params = (fnNode as { params?: Node[] }).params ?? [];
  for (const p of params) {
    if (p.type === "Identifier" && p.name === name) return { kind: "param" };
  }
  let hit: ScopeDecl | undefined;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as {
      type?: string;
      id?: { type?: string; name?: string; loc?: { start: { line: number; column: number } } };
    };
    if (n.type === "VariableDeclarator" && n.id?.type === "Identifier" && n.id.name === name) {
      const start = n.id.loc?.start;
      if (start) hit = { kind: "local", line: start.line, column: start.column };
    }
    if (n !== fnNode && typeof n.type === "string" && NESTED_SCOPE_TYPES.has(n.type)) return;
    for (const k of Object.keys(node)) {
      if (k === "loc" || k === "start" || k === "end" || k.endsWith("Comments")) continue;
      const v = (node as Record<string, unknown>)[k];
      if (Array.isArray(v)) {
        for (const c of v) walk(c);
      } else if (v && typeof v === "object" && typeof (v as { type?: string }).type === "string") {
        walk(v);
      }
    }
  };
  walk(fnNode);
  return hit;
}

/**
 * 契约泛化（形参种子 / 入口 Φ）——与 hover 求值面同源（generalizeFromAst）。
 * fail-closed：泛化失败 ⇒ undefined（无契约种子 ⇒ 形参按 any 处理）。
 */
function generalizeScoped(
  fnName: string,
  parseText: string,
  ast: File,
  filePath: string,
  reuse: SurfaceReuse | undefined,
  opts?: { loadModule?: LoadModule; autoBind?: boolean },
): PolyFn | undefined {
  try {
    return generalizeFromAst(fnName, parseText, {
      file: ast,
      refine: {
        fromFile: filePath,
        ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
        ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      },
      ...(reuse?.modules ? { modules: reuse.modules } : {}),
    });
  } catch {
    return undefined;
  }
}

/**
 * 作用域重放的位置表（(file, fn, 源文本) 缓存——与 hover 的重放缓存**分开
 * 命名空间**：两端口径不同（种子 / 源文本），共用一个键会互相挤掉）。
 */
function scopedReplayNodes(
  filePath: string,
  parseText: string,
  enc: EnclosingFn,
  g: PolyFn | undefined,
  reuse: SurfaceReuse | undefined,
): Map<string, Abs> | undefined {
  const cacheKey = `${filePath}#scope:${enc.name}`;
  const cached = replayCacheGet(cacheKey);
  if (cached && cached.source === parseText) return cached.nodes;
  const args = g ? g.typeParams.map((t) => t.value) : [];
  const reqs = g?.entryReqs;
  const phi = reqs && reqs.length > 0 ? and(...reqs.map((r) => r.pred)) : undefined;
  const nodes = replayFnAbsNodes(parseText, {
    fnName: enc.name,
    args,
    ...(phi ? { phi } : {}),
    ...(reuse?.modules ? { modules: reuse.modules } : {}),
  });
  replayCachePut(cacheKey, { source: parseText, nodes });
  return nodes;
}
