/**
 * LSP 表面（hover / 补全 / 用例枚举）——自 analyzer.ts 拆出的展示层。
 *
 * 这里只做「光标位置 → 类型」的查询与渲染：
 * - getTypeAtPosition / getHoverAtPosition：求值引擎 Abs 节点表优先；
 *   用例函数体内走 Abs 重放（activeCases 选中 case + evalSource）；
 * - getCompletionsAtPosition 及补全辅助（builtinMemberAbs 微求值、
 *   array/promise/string/union 成员补全）——内置成员唯一真值来源是
 *   evaluator 的 BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS；
 * - 光标定位 helpers（标识符/函数名/包围函数/最佳节点匹配）。
 *
 * 分析编排（diagnostics / case 求值 / 调用记录）仍在 analyzer.ts；
 * 依赖的共享 helpers（resolveModule / locFromNode / collectEnvNames /
 * buildNodeTypeMap）由 analyzer 显式导出。
 */
import { dirname } from "node:path";
import type { File, Identifier, Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type Abs,
  type AbsModuleExports,
  and,
  callTranspiledExportFull,
  generalizeFromAst,
  formatAbs,
  formatAbsMultiline,
  formatShape,
  formalParamSignatureNames,
  interfaceTierOf,
  joinAbs,
  leqAbs,
  listFnDirectiveScopes,
  runTranspiled,
  setEvalAssignCollector,
  setEvalCallCollector,
  setPosCollector,
  type EvalAbsAssignRecord,
  type EvalCallRecord,
  type EvalPosRecord,
  type InterfaceSource,
  type InterfaceTierOpts,
  type Phi,
  type PolyFn,
} from "@nudojs/core";
import { parse, extractDirectivesQuiet } from "@nudojs/parser";
import type { FunctionWithDirectives } from "@nudojs/parser";
import {
  loadEnvs,
  preloadPathEnvs,
  describeAbsMember,
  builtinProtoMember,
  builtinProtoMemberNames,
} from "@nudojs/service/evaluator";
import { mockDirectivesToAbsSeeds } from "@nudojs/service";
import { evalAbsModuleGraph, collectAbsBindingsFromGraph } from "@nudojs/service";
import {
  resolveModule,
  locFromNode,
  collectEnvNames,
  type AnalysisResult,
  type CompletionItem,
  type LoadModule,
  type SourceLocation,
} from "@nudojs/service";

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
function reuseBinding(reuse: SurfaceReuse | undefined, name: string): Abs | undefined {
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

/**
 * 位置求值态 Abs（引擎重放面）：仅顶层导出函数且
 * 契约参数 Abs 齐备（Identifier 形参逐一有入口
 * Abs——解构 / 无契约形参不重放，回落声明形态面）。
 * 位置键 = Babel 口径（1-based 行，0-based 列——
 * 与插桩记录同口径）。
 */
function absNodeAtPosition(
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
  const cached = absNodeReplayCache.get(cacheKey);
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
    if (absNodeReplayCache.size >= ABS_NODE_REPLAY_CACHE_MAX) {
      absNodeReplayCache.clear();
    }
    absNodeReplayCache.set(cacheKey, { source, nodes });
  }
  const exact = nodes?.get(`${line}:${column}`);
  if (exact !== undefined || nodes === undefined) return exact;
  // 词中 hover：记录键 = Babel 起始位（$nodoPos 用 loc.start）——光标在
  // 标识符跨距内但不在首列时精确键 miss，回落到跨距解析（最窄包含
  // Identifier 的起始键）
  let best: { key: string; span: number } | undefined;
  try {
    if (fileAst) {
      traverse(fileAst, {
        Identifier(path) {
          const loc = path.node.loc;
          if (!loc) return;
          if (loc.start.line !== line) return;
          // 光标行一致 + 在跨距内（Babel end.column 为 exclusive——含尾列）
          if (column < loc.start.column || column > loc.end.column) return;
          const span = loc.end.column - loc.start.column;
          const key = `${loc.start.line}:${loc.start.column}`;
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
function isUnnarrowedAbs(a: Abs, entry: Abs): boolean {
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

export type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
};

export function getCasesForFile(filePath: string, source: string): { functionName: string; cases: { name: string; index: number }[]; loc: SourceLocation }[] {
  const ast = parse(source);
  const functions = extractDirectivesQuiet(ast);
  return functions.map((fn) => {
    const cases = fn.directives
      .filter((d) => d.kind === "case")
      .map((d, i) => ({ name: d.name, index: i }));
    return { functionName: fn.name, cases, loc: locFromNode(fn.node) };
  });
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
function positionInsideCaseFunction(
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
function absFromEval(
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
function absFromCaseReplay(
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

export type HoverInfo = {
  /** 外延展示（formatShape / formatAbs） */
  typeText: string;
  /** 内涵签名（代数 generalize） */
  intension?: string;
  /** 无损 Abs 单行展示（shape / term / pred / conf） */
  abs?: string;
  /** 无损 Abs 多行展示 */
  absMultiline?: string;
  /** check 同口径签名（`fn(params) => ret`）；IDE hover 渲染面 */
  signature?: string;
  /** CodeLens `● interface` 同源档位（A7）；仅本地 named export */
  interfaceSource?: InterfaceSource;
  /** 有效契约展示（handwritten/generated）；implicit 为 undefined */
  interfaceDisplay?: string;
  /** 契约来源侧车 canonical 路径（侧车绑定时）；契约原文链接跳转用 */
  sidecarPath?: string;
  /** 侧车绑定声明行（1-based；契约原文链接 `#L<n>` 跳转目标） */
  sidecarLine?: number;
  /**
   * 类型值变量链接面（参数折叠展示的 markdown 渲染：引用标识符
   * 如 `astNode` 包为 `[astNode](file://<定义路径>#L<行>)`）。
   * 在场时 IDE hover 直接渲染它（plain markdown——代码块内
   * 链接不渲染），契约原文行不再重复；缺席时回落 ```nudo 代码块
   * + 契约原文行（无引用变量的契约的唯一跳转入口）
   */
  linkedText?: string;
};

/** A7：hover/inlay 与 CodeLens interface 档同源（design-refine-derivation §8） */
export type HoverInterfaceOpts = InterfaceTierOpts;

/**
 * LSP hover：优先无损 Abs（类型即计算本体）。
 * 节点表也是 Abs（collectAbsNodeTypes），不经 bridge。
 *
 * 函数名/调用 callee 位置（design-hof-relations §7）：
 * intension 一律走 generalize/formatPoly（HOF fnRels 在这里）；
 * typeText 仍落 evaluator Abs（调用点显示结果类型，不是函数签名）。
 * 禁止用 evaluator 的 arity-only fn Abs 冒充权威关系源。
 *
 * A7 default 档：函数名 hover 附带 interfaceTierOf 来源 + 契约展示，
 * 与 CodeLens `● interface / <source>` 同源；选 case 时 body 仍走
 * activeCases 重放，interface 档标注不变。
 */
export function getHoverAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
  opts?: HoverInterfaceOpts,
  reuse?: SurfaceReuse,
): HoverInfo | null {
  // parse 一次（reuse.ast 优先）；失败 → AST 相关路径全部短路，
  // 不再 `file ?? parse(source)` 兜底重 parse（确定性失败，纯浪费）
  let file: ReturnType<typeof parse> | undefined;
  if (reuse?.ast !== undefined) {
    file = reuse.ast;
  } else {
    try {
      file = parse(source);
    } catch {
      file = undefined;
    }
  }
  const fnHit = findFunctionNameAtPosition(source, line, column, file);
  const fnName = fnHit?.name;
  /** 声明名位置（非调用 callee）才有 check 同口径签名面 */
  const fnDeclPos = fnHit?.isDecl ?? false;

  // interface 档（A7）：与 CodeLens 同源；仅导出函数标注
  const tier =
    fnName !== undefined
      ? interfaceTierOf(source, fnName, filePath, opts ?? {})
      : undefined;

  // intension 候选：先算、不早退，最后合并进 evaluator/TypeValue 结果
  let gDisplay: string | undefined;
  let gAbs: string | undefined;
  let gMulti: string | undefined;
  let gSig: string | undefined;
  if (fnName) {
    try {
      // refine（fromFile/侧车 ambient）与 modules（跨模块图）一并传入：
      // 缺 refine → 参数无契约种子（A1）；缺 modules → 跨模块调用 unknown
      const g = generalizeFromAst(fnName, source, {
        ...(file ? { file } : {}),
        refine: {
          fromFile: filePath,
          ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
          ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
        },
        ...(reuse?.modules ? { modules: reuse.modules } : {}),
      });
      if (g) {
        gDisplay = g.display;
        gAbs = formatAbs(g.symbolic);
        gMulti = formatAbsMultiline(g.symbolic, fnName);
        // check 同口径签名（check-signatures formatEntrySigLine
        // 同公式：formalParamSignatureNames + formatShape；throws
        // 归 check 门禁面）。契约参数优先展示声明形态
        // （entryReqs.display——判别联合的 formatShape 展开
        // 可达数万字符）；无契约参数保持推断 shape
        const reqByParam = new Map(
          (g.entryReqs ?? []).map((r) => [r.param, r.display]),
        );
        const names =
          g.formals && g.formals.length > 0 ? formalParamSignatureNames(g.formals) : g.params;
        const ps = names
          .map((p, i) => {
            const display = reqByParam.get(p);
            if (display !== undefined) return `${p}: ${display}`;
            const t = g.typeParams[i]?.value;
            // design §2：无约束 any；真 unknown 不得伪装
            const shown = !t ? "any" : t.shape.k === "unknown" ? "unknown" : formatShape(t);
            return `${p}: ${shown}`;
          })
          .join(", ");
        gSig = `${fnName}(${ps}) => ${formatShape(g.symbolic, { maxDepth: 4 })}`;
      }
    } catch {
      // ignore
    }
  }
  const withTier = <T extends HoverInfo | null>(info: T): T => {
    if (!info || !tier) return info;
    return {
      ...info,
      interfaceSource: tier.source,
      ...(tier.display !== undefined ? { interfaceDisplay: tier.display } : {}),
      ...(tier.sidecarPath !== undefined ? { sidecarPath: tier.sidecarPath } : {}),
      ...(tier.sidecarLine !== undefined ? { sidecarLine: tier.sidecarLine } : {}),
    };
  };
  const attachIntension = (info: HoverInfo | null): HoverInfo | null => {
    if (!gDisplay) return withTier(info);
    const sigField = fnDeclPos && gSig ? { signature: gSig } : {};
    if (!info) {
      // 函数名 hover：signature（check 同口径）是 IDE 渲染面；
      // abs/absMultiline/intension 保留给 nudo.hover payload（无损面）
      return withTier({
        typeText: gDisplay,
        intension: gDisplay,
        abs: gAbs,
        absMultiline: gMulti,
        ...sigField,
      });
    }
    return withTier({
      ...info,
      intension: gDisplay,
      // 外延侧已有更准 Abs 时保留；否则用 symbolic 兜底
      abs: info.abs ?? gAbs,
      absMultiline: info.absMultiline ?? gMulti,
      ...sigField,
    });
  };

  // 求值引擎：优先 Abs 节点表 / 标识符绑定，不经 TypeValue evaluateProgram。
  // 用例函数体内：Abs 重放 selected case（activeCases），再 TypeValue 兜底。
  const insideCaseFn = positionInsideCaseFunction(source, file, line, column);

  // arity-only fn Abs（shape.k=fn 且 returnType 槽空——未被调用观测过）：
  // 携带信息少于 generalize 的内涵签名（gDisplay / gSig），不作为展示面。
  // 函数名 / callee 位 hover 由此回落下方 intension 面（引擎 generalize 语义，
  // 非源码文本近似）；fn Abs 已带 returnType（被调用观测过）时仍直读 Abs。
  const deferIfArityOnlyFn = (a: Abs | null): Abs | null => {
    if (!a || !gDisplay) return a;
    return a.shape.k === "fn" && a.shape.returnType === undefined ? null : a;
  };

  if (!insideCaseFn) {
    const fromB = deferIfArityOnlyFn(absFromEval(filePath, source, line, column, file, reuse));
    if (fromB) {
      const absLine = formatAbs(fromB);
      const absMulti = formatAbsMultiline(fromB, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  } else {
    const fromCase = absFromCaseReplay(filePath, source, line, column, file, activeCases);
    if (fromCase) {
      const absLine = formatAbs(fromCase);
      const absMulti = formatAbsMultiline(fromCase, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  }

  // Abs 兜底（同源 reuse：不再内部重复 parse + 全量求值）
  const absFallback = deferIfArityOnlyFn(
    getAbsAtPosition(filePath, source, line, column, activeCases, {
      ...(reuse?.result !== undefined ? { result: reuse.result } : {}),
      ...(file !== undefined ? { ast: file } : {}),
    }),
  );
  if (absFallback) {
    const absLine = formatAbs(absFallback);
    const absMulti = formatAbsMultiline(absFallback, undefined);
    return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
  }

  // 标识符面（顺序即优先级）：
  // A 参数投影 → B 模块级绑定面 → C 体内局部（entry 实参调用 + 记录投影）。
  // 用例函数体内不再整体短路：case 重放面已删（恒 null），绑定面只覆盖
  // 模块级名（import/顶层声明），参数已在 A 先返回——不会被调用点绑定污染。
  // fnName 命中且本地 generalize 有内涵（函数名/本地 callee）时走上方
  // intension 面不进这里；fnName 命中但 gDisplay 缺失（导入函数的 callee
  // ——本文件无声明）时放行，绑定面给 fn Abs。
  const ident = findIdentNameAtPosition(source, line, column, file);
  const fnFaceMissing = fnName !== undefined && gDisplay === undefined;
  if (ident && (!fnName || fnFaceMissing)) {
    /** 标识符 hover 单行外延：`grade: string`——内涵（term/pred/conf）
     *  留给函数名 hover 的契约面，标识符面不重复展开。
     *  展开层级受限（maxDepth 4——lazy 自引用在深预算下指数
     *  展开，可达数万字符单行；超深以 `…` 截断标记） */
    const identHover = (value: Abs): HoverInfo => {
      const text = `${ident}: ${formatShape(value, { maxDepth: 4 })}`;
      return { typeText: text, abs: text };
    };
    // —— A. 参数面：光标在参数声明（含解构属性）或参数引用上时，从
    // enclosing 函数的 generalized Abs 投影参数槽位。绑定面只覆盖模块级
    // import——参数 Abs 的唯一权威源是 generalize（契约种子 + 模块图
    // 在此生效，与函数名 hover 同源）。lexical shadowing 同口径：参数先于绑定。
    let encFn: EnclosingFn | undefined;
    let gEnc: PolyFn | undefined;
    if (file) {
      encFn = findEnclosingFunction(file, line, column);
      if (encFn) {
        try {
          gEnc = generalizeFromAst(encFn.name, source, {
            file,
            refine: {
              fromFile: filePath,
              ...(opts?.loadModule ? { loadModule: opts.loadModule } : {}),
              ...(opts?.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
            },
            ...(reuse?.modules ? { modules: reuse.modules } : {}),
          });
        } catch {
          // fail-closed：generalize 失败 → 无参数面（不拖垮 hover）
        }
        // 侧车契约档（参数面 + 成员投影共用）：
        // 侧车源码 / AST 预解析（判别窄化的臂
        // 过滤与变量链接的引用解析共用）
        const encTier = interfaceTierOf(source, encFn.name, filePath, opts ?? {});
        const sidecarPath = encTier?.sidecarPath;
        let sidecarProgram: File["program"] | undefined;
        let sidecarSrc: string | undefined;
        if (
          sidecarPath !== undefined &&
          opts?.loadModule !== undefined
        ) {
          sidecarSrc = opts.loadModule(sidecarPath, sidecarPath);
          if (sidecarSrc !== undefined) {
            try {
              sidecarProgram = parse(sidecarSrc).program;
            } catch {
              sidecarProgram = undefined;
            }
          }
        }
        // —— A0. 引擎节点级 Abs 重放（求值态面——
        // 优先）：导出函数 + 契约参数 Abs 齐备
        // 时符号执行，位置直读求值态 Abs（流
        // 敏感窄化为引擎求值语义——早退守卫 /
        // 判别等值 / !== 对偶 / typeof 守卫 /
        // && / || 链，$fork 臂内 withExecPhi +
        // $narrowMemberEq 剪影）。显示口径：
        // ident 是形参且求值态与入口 Abs 等价
        // （未窄化 / 仅剥 nullish——声明位 /
        // 检查点 / 成员访问对象位 / 落回位）
        // → 下方声明形态折叠面（用户口径——
        // nullable(astNode) / astNode + 链接）；
        // 窄化位（守卫 then 分支 / 槽位读 /
        // 局部量）→ 求值态（formatShape
        // maxDepth 4）。重放未覆盖 / 失败 →
        // 回落声明形态面
        let engineAbs: Abs | undefined;
        if (gEnc) {
          const nodeAbs = absNodeAtPosition(
            filePath,
            source,
            encFn,
            gEnc,
            reuse,
            line,
            column,
            file,
          );
          if (nodeAbs !== undefined) {
            const entryAbs = gEnc.entryShapes?.get(ident)?.abs;
            if (entryAbs === undefined || !isUnnarrowedAbs(nodeAbs, entryAbs)) {
              engineAbs = nodeAbs;
            }
          }
        }
        if (engineAbs !== undefined) {
          const typeText = `${ident}: ${formatShape(engineAbs, {
            maxDepth: 4,
            showLits: true,
          })}`;
          return {
            typeText,
            abs: typeText,
            ...(sidecarPath !== undefined ? { sidecarPath } : {}),
            ...(encTier?.sidecarLine !== undefined
              ? { sidecarLine: encTier.sidecarLine }
              : {}),
          };
        }
        // 参数声明位 / 引用位：声明形态折叠（体内
        // 引用叠加流窄化——早退守卫 / 成员访问对象
        // 之后剥离 nullable 包装；等值守卫 then
        // 分支判别窄化为匹配臂——重放未覆盖时的
        // 近似面）。投影面（projectParamAbs）展示
        // 的 generalized 参数类型与声明形态同信息
        // ——一为判别联合无损展开（lazy 自引用
        // 指数展开可达数万字符单行）、一为声明
        // 原文；evaluator 流敏感面（absFromEval
        // 模块级绑定面在上方）不受影响。名称
        // 匹配（ident = 形参名）；lexical
        // shadowing 同口径：参数先于绑定
        const display = gEnc
          ? paramDisplayOf(
              gEnc,
              ident,
              encFn.node,
              file,
              line,
              column,
              sidecarPath,
              sidecarProgram,
              sidecarSrc,
              opts?.loadModule,
            )
          : undefined;
        if (display !== undefined) {
          // 类型值变量链接（侧车表达式中的引用
          // 标识符 → 定义位置）：在场时 IDE hover
          // 渲染 plain markdown（代码块内链接不
          // 渲染），契约原文行不再重复
          const linked =
            sidecarPath !== undefined &&
            sidecarProgram !== undefined &&
            sidecarSrc !== undefined
              ? linkTypeVariables(
                  ident,
                  display,
                  sidecarPath,
                  sidecarProgram,
                  sidecarSrc,
                  opts?.loadModule,
                )
              : undefined;
          const typeText = `${ident}: ${display}`;
          return {
            typeText,
            abs: typeText,
            ...(linked !== undefined ? { linkedText: linked } : {}),
            ...(sidecarPath !== undefined ? { sidecarPath } : {}),
            ...(encTier?.sidecarLine !== undefined
              ? { sidecarLine: encTier.sidecarLine }
              : {}),
          };
        }
        const paramHit = gEnc ? projectParamAbs(gEnc, ident) : undefined;
        if (paramHit) return attachIntension(identHover(paramHit));
      }
    }
    // —— B. 绑定面（模块级名：import / 顶层声明）。同源绑定优先；
    // 缺失时经模块图（相对 + 裸包）现求——case 函数体内的 import 引用
    // （vetoFindings 等）由此返回。
    const absBound = reuse?.result ? reuseBinding(reuse, ident) : undefined;
    if (absBound) return attachIntension(identHover(absBound));
    if (file) {
      try {
        const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(file), {
          fromFile: filePath,
        });
        const absBinds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const fromGraph = absBinds.get(ident);
        if (fromGraph) return attachIntension(identHover(fromGraph));
      } catch {
        // fail-closed：绑定面求值失败 → 不产出 Abs（不拖垮 hover）
      }
    }
    // —— C. 体内局部：enclosing 以 entry 形参（契约种子）实参调用一次，
    // 从赋值记录（let/var 再赋值）与调用记录（调用初始化 const）投影。
    // 非调用初始化 / 非赋值局部保持 fail-closed（诚实无信息）。
    if (encFn && gEnc) {
      const local = projectLocalAbs(filePath, source, encFn, gEnc, ident, reuse?.modules);
      if (local) return attachIntension(identHover(local));
    }
  }

  // fail-closed：Abs 节点表（collectAbsNodeTypes）已删——任意表达式
  // 光标 Abs 由标识符绑定面（absFromEval）与 interface 档覆盖

  // 无类型结果时仍返回 intension（函数名 hover 的同源保证）；
  // tier 可缺（nested / 非导出），gDisplay 有就给出
  if (gDisplay) {
    return withTier({
      typeText: gDisplay,
      intension: gDisplay,
      abs: gAbs,
      absMultiline: gMulti,
      ...(fnDeclPos && gSig ? { signature: gSig } : {}),
    });
  }
  return null;
}

/** 光标处任意标识符（绑定 hover） */
function findIdentNameAtPosition(
  source: string,
  line: number,
  column: number,
  fileAst?: ReturnType<typeof parse>,
): string | undefined {
  try {
    const ast = fileAst ?? parse(source);
    let found: string | undefined;
    traverse(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line) return;
        if (column < loc.start.column || column > loc.end.column) return;
        found = path.node.name;
      },
    });
    return found;
  } catch {
    return undefined;
  }
}

/**
 * 光标处标识符是否是函数名位置。
 * 与 listFnDirectiveScopes 绑定名同口径：裸名（f / inner / helper）、
 * `C.m` / `owner.key`（ClassMethod / ObjectMethod key）。
 */
function findFunctionNameAtPosition(
  source: string,
  line: number,
  column: number,
  fileAst?: ReturnType<typeof parse>,
): { name: string; isDecl: boolean } | undefined {
  try {
    const ast = fileAst ?? parse(source);
    let found: string | undefined;
    // 声明 id（FunctionDeclaration/VariableDeclarator/method key/property key）
    // vs 调用 callee——签名面（check 同口径）只属于前者，callee 走调用点面
    let foundDecl = false;
    // G2 绑定名（C.m / owner.key）——与 listFnDirectiveScopes 同口径
    let scopes: ReturnType<typeof listFnDirectiveScopes> | undefined;
    const scopeNameOf = (node: unknown): string | undefined => {
      scopes ??= listFnDirectiveScopes(ast as never);
      const hit = scopes.find((s) => s.node === node);
      return hit && hit.name !== "<anonymous>" ? hit.name : undefined;
    };
    traverse(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (loc.start.line !== line) return;
        if (column < loc.start.column || column > loc.end.column) return;
        const parent = path.parent;
        // 函数声明 id
        if (parent.type === "FunctionDeclaration" && parent.id === path.node) {
          found = path.node.name;
          foundDecl = true;
          return;
        }
        // 调用 callee
        if (parent.type === "CallExpression" && parent.callee === path.node) {
          found = path.node.name;
          foundDecl = false;
          return;
        }
        // ClassMethod / ObjectMethod key → G2 绑定名（C.m / owner.key）
        if (
          (parent.type === "ClassMethod" ||
            parent.type === "ClassPrivateMethod" ||
            parent.type === "ObjectMethod") &&
          (parent as { key?: unknown }).key === path.node
        ) {
          found = scopeNameOf(parent) ?? path.node.name;
          foundDecl = true;
          return;
        }
        // 变量声明的函数初始化：const helper = (n) => … / const f = function () {}
        if (parent.type === "VariableDeclarator" && parent.id === path.node) {
          const init = (parent as { init?: { type?: string } | null }).init;
          if (
            init &&
            (init.type === "ArrowFunctionExpression" ||
              init.type === "FunctionExpression")
          ) {
            found = path.node.name;
            foundDecl = true;
            return;
          }
        }
        // 对象/类属性键上的函数值：{ get: function () {} } / { get: () => {} }
        if (
          (parent.type === "ObjectProperty" ||
            parent.type === "ClassProperty" ||
            parent.type === "ClassPrivateProperty") &&
          (parent as { key?: unknown }).key === path.node
        ) {
          const val = (parent as { value?: { type?: string } | null; init?: { type?: string } | null }).value ??
            (parent as { init?: { type?: string } | null }).init;
          if (
            val &&
            (val.type === "ArrowFunctionExpression" ||
              val.type === "FunctionExpression")
          ) {
            found = scopeNameOf(parent) ?? path.node.name;
            foundDecl = true;
            return;
          }
        }
      },
    });
    return found !== undefined ? { name: found, isDecl: foundDecl } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 光标最内层 enclosing 函数（traverse 直查，不依赖指令存在——
 * extractDirectivesQuiet 只返回带指令的函数）。
 * 覆盖：函数声明 / const fn = arrow|function / 对象方法 / 类方法。
 * 返回 node（函数体节点，含 loc）供体内局部声明扫描与记录过滤。
 */
type EnclosingFn = { name: string; node: Node };

function findEnclosingFunction(
  ast: Node,
  line: number,
  column: number,
): EnclosingFn | undefined {
  let best: { name: string; startLine: number; node: Node } | undefined;
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      FunctionDeclaration(p) {
        const loc = p.node.loc;
        const name = p.node.id?.name;
        if (!loc || !name) return;
        if (loc.start.line <= line && loc.end.line >= line) {
          if (!best || loc.start.line > best.startLine) best = { name, startLine: loc.start.line, node: p.node };
        }
      },
      VariableDeclarator(p) {
        const init = p.node.init;
        if (!init || (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression")) return;
        const loc = init.loc;
        const name = (p.node.id as { name?: string } | null)?.name;
        if (!loc || !name) return;
        if (loc.start.line <= line && loc.end.line >= line) {
          if (!best || loc.start.line > best.startLine) best = { name, startLine: loc.start.line, node: init };
        }
      },
      "ObjectMethod|ClassMethod"(p) {
        const node = p.node as unknown as {
          loc?: { start: { line: number }; end: { line: number } };
          key?: { name?: string };
        };
        const name = node.key?.name;
        if (!node.loc || !name) return;
        if (node.loc.start.line <= line && node.loc.end.line >= line) {
          if (!best || node.loc.start.line > best.startLine) best = { name, startLine: node.loc.start.line, node: p.node };
        }
      },
    });
  } catch {
    // ignore
  }
  return best ? { name: best.name, node: best.node } : undefined;
}

/**
 * 参数声明形态折叠（名称匹配 + 流窄化）：ident 是形参名且
 * entryReqs 有声明形态（display——侧车表达式原文 / 指令
 * 约束名）时返回 display，替代投影面的判别联合无损展开
 * （可达数万字符单行——lazy 自引用指数展开）。无 display
 * （派生形参 / 无契约 / 解构子属性点路径不匹配）→
 * undefined，回落投影面（诚实降级）。
 *
 * 体内引用位叠加流窄化事实（有界规则集）：
 * - 成员访问对象（`node.x`，非可选链）：访问成立即排除
 *   nullish；
 * - 早退守卫之后（`if (!node) return …;`——守卫蕴含
 *   nullish 且 then 以 return/throw 结束）：后续语句排除
 *   nullish；
 * - `p.type === 'lit'` 等值守卫的 then 分支：判别窄化——
 *   联合类型值引用（`astNode`）过滤为匹配臂的 shape 文本。
 * 窄化成立时剥离 display 的 `nullable(…)` 包装（链式表达式
 * 才剥——union 字面量 / 合并形态不剥）；检查点（`!node`
 * 自身）与声明位不窄化，保持声明形态。
 */
function paramDisplayOf(
  g: PolyFn,
  ident: string,
  fnNode: Node,
  file: Node,
  line: number,
  column: number,
  sidecarPath: string | undefined,
  sidecarProgram: File["program"] | undefined,
  sidecarSrc: string | undefined,
  loadModule: LoadModule | undefined,
): string | undefined {
  const req = g.entryReqs?.find((r) => r.param === ident);
  if (req?.display === undefined) return undefined;
  const facts = flowFactsAt(fnNode, file, ident, line, column);
  let display = req.display;
  if (facts.nonNullish) display = stripNullableWrappers(display);
  // 判别窄化（等值守卫 then 分支——联合类型值
  // 引用过滤为匹配臂）
  if (
    facts.typeFilters.length > 0 &&
    sidecarPath !== undefined &&
    sidecarProgram !== undefined &&
    sidecarSrc !== undefined
  ) {
    display =
      narrowByDiscriminant(
        display,
        facts.typeFilters,
        sidecarPath,
        sidecarProgram,
        sidecarSrc,
        loadModule,
      ) ?? display;
  }
  return display;
}

/** 流窄化事实（有界规则集，见 paramDisplayOf） */
type FlowFacts = {
  nonNullish: boolean;
  /**
   * `p.type === 'lit'` 等值守卫（判别窄化）：每个
   * filter 是该位置必须匹配的 type 值集（`&&` 链的
   * 操作数——单等值守卫为单值集、`||` 组为多值集；
   * 臂须匹配所有 filter）。then 分支内生效
   * （test 求值语义）；else 分支不窄化（否定形态
   * 有界跳过）
   */
  typeFilters: Array<Set<string>>;
};

function flowFactsAt(
  fnNode: Node,
  file: Node,
  paramName: string,
  line: number,
  column: number,
): FlowFacts {
  const facts: FlowFacts = { nonNullish: false, typeFilters: [] };
  // 成员访问对象规则：光标标识符是非可选成员访问的对象
  const hit = findIdentParent(file, line, column);
  if (
    hit &&
    hit.name === paramName &&
    isNonNullishMemberObject(hit.parent, hit.ident)
  ) {
    facts.nonNullish = true;
  }
  // 早退守卫规则：从函数体起点按序走查，位置之前的语句
  // 生效（早退守卫 → nonNullish；参数赋值 → 重置）
  const body = (fnNode as { body?: { body?: Node[] } }).body?.body;
  if (body) walkStmtsForFacts(body, paramName, line, column, facts);
  return facts;
}

type Pos = { line: number; column: number };

function posCmp(a: Pos, b: Pos): number {
  return a.line !== b.line ? a.line - b.line : a.column - b.column;
}

function containsPos(n: Node, line: number, column: number): boolean {
  const loc = n.loc;
  if (!loc) return false;
  return (
    posCmp(loc.start, { line, column }) <= 0 &&
    posCmp({ line, column }, loc.end) <= 0
  );
}

/** 找到光标处标识符及其父节点（父指针需自走查，Babel 无 parent） */
function findIdentParent(
  node: Node,
  line: number,
  column: number,
): { name: string; ident: Node; parent: Node } | null {
  for (const key of Object.keys(node)) {
    if (
      key === "loc" ||
      key === "extra" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments" ||
      key === "tokens" ||
      key === "comments"
    ) {
      continue;
    }
    const v = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(v)) {
      for (const el of v) {
        if (isNode(el)) {
          if (el.type === "Identifier" && containsPos(el, line, column)) {
            return {
              name: (el as Identifier).name,
              ident: el,
              parent: node,
            };
          }
          const r = findIdentParent(el, line, column);
          if (r) return r;
        }
      }
    } else if (isNode(v)) {
      if (v.type === "Identifier" && containsPos(v, line, column)) {
        return {
          name: (v as Identifier).name,
          ident: v,
          parent: node,
        };
      }
      const r = findIdentParent(v, line, column);
      if (r) return r;
    }
  }
  return null;
}

function isNode(v: unknown): v is Node {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Node).type === "string"
  );
}

/** 非可选成员访问的对象（`node.x` 隐含 node 非 nullish；`node?.x` 不窄化） */
function isNonNullishMemberObject(parent: Node, ident: Node): boolean {
  const p = parent as unknown as {
    type: string;
    object?: Node;
    optional?: boolean;
  };
  return (
    p.type === "MemberExpression" &&
    p.object === ident &&
    p.optional !== true
  );
}

/** 语句级事实走查：位置之前生效，位置所在语句递归入内 */
function walkStmtsForFacts(
  stmts: Node[],
  paramName: string,
  line: number,
  column: number,
  facts: FlowFacts,
): void {
  const pos = { line, column };
  for (const s of stmts) {
    const loc = s.loc;
    if (!loc) continue;
    if (posCmp(loc.end, pos) <= 0) {
      applyStmtFact(s, paramName, facts);
      continue;
    }
    if (posCmp(loc.start, pos) <= 0) {
      if (s.type === "IfStatement") {
        const ifS = s as unknown as {
          test: Node;
          consequent: Node;
          alternate?: Node | null;
        };
        // then 分支：test 的等值守卫生效（判别窄化 +
        // 成员访问隐含非空）；else 分支不窄化。
        // 位置在 consequent 内——该分支的事实即
        // 位置的事实：追加后不再恢复（walk 在
        // 包含语句处终止，事实为最终值）
        if (containsPos(ifS.consequent, line, column)) {
          const testFilters = collectTypeFilters(ifS.test, paramName);
          if (testFilters.length > 0) {
            facts.typeFilters = [...facts.typeFilters, ...testFilters];
            facts.nonNullish = true;
          }
          recurseIntoBlock(ifS.consequent);
          return;
        }
        recurseIntoBlock(ifS.consequent);
        if (ifS.alternate) recurseIntoBlock(ifS.alternate);
      } else if (s.type === "SwitchStatement") {
        for (const c of (s as unknown as { cases: Node[] }).cases) {
          const cons = (c as unknown as { consequent?: Node[] }).consequent;
          if (
            Array.isArray(cons) &&
            cons.some((st) => containsPos(st, line, column))
          ) {
            walkStmtsForFacts(cons, paramName, line, column, facts);
          }
        }
      } else {
        for (const nested of nestedBlocksOf(s)) {
          if (containsPos(nested, line, column)) {
            walkStmtsForFacts(
              (nested as unknown as { body: Node[] }).body,
              paramName,
              line,
              column,
              facts,
            );
          }
        }
      }
      return;
    }
    // 语句起点在位置之后——后续语句不生效
    return;
  }
  function recurseIntoBlock(n: Node): void {
    if (!containsPos(n, line, column)) return;
    if (n.type === "BlockStatement") {
      walkStmtsForFacts(
        (n as unknown as { body: Node[] }).body,
        paramName,
        line,
        column,
        facts,
      );
    } else {
      walkStmtsForFacts([n], paramName, line, column, facts);
    }
  }
}

/** 非 if/switch 语句内嵌的块（函数体除外——窄化不跨函数边界） */
function nestedBlocksOf(s: Node): Node[] {
  const out: Node[] = [];
  const t = s as unknown as {
    body?: unknown;
    block?: unknown;
    finalizer?: unknown;
    handler?: unknown;
  };
  const add = (n: unknown): void => {
    if (n !== null && typeof n === "object" && (n as Node).type === "BlockStatement") {
      out.push(n as Node);
    }
  };
  add(t.body);
  add(t.block);
  add(t.finalizer);
  add((t.handler as { body?: unknown } | undefined)?.body);
  return out;
}

/** 位置之前语句的窄化效果：早退守卫 → nonNullish；参数赋值 → 重置 */
function applyStmtFact(s: Node, paramName: string, facts: FlowFacts): void {
  if (isParamReassignment(s, paramName)) {
    facts.nonNullish = false;
    facts.typeFilters = [];
    return;
  }
  if (s.type !== "IfStatement") return;
  const ifS = s as unknown as { test: Node; consequent: Node };
  if (!isNullishGuardOn(ifS.test, paramName)) return;
  if (endsWithReturnThrow(ifS.consequent)) facts.nonNullish = true;
}

/**
 * test 的 `p.type === 'lit'` 等值守卫收集
 * （判别窄化）：`&&` 链的每个操作数是一个
 * filter——单等值守卫（`p.type === 'X'`）为
 * 单值集、`||` 组（`p.type === 'X' ||
 * p.type === 'Y'`）为多值集；非等值操作数
 * 不贡献 filter。臂须匹配所有 filter
 * （&& 语义）。
 */
function collectTypeFilters(
  test: Node,
  paramName: string,
): Array<Set<string>> {
  if (test.type === "LogicalExpression") {
    const t = test as unknown as {
      operator: string;
      left: Node;
      right: Node;
    };
    if (t.operator === "&&") {
      return [
        ...collectTypeFilters(t.left, paramName),
        ...collectTypeFilters(t.right, paramName),
      ];
    }
    if (t.operator === "||") {
      const left = typeEqualityValue(t.left, paramName);
      const right = typeEqualityValue(t.right, paramName);
      if (left !== undefined && right !== undefined) {
        return [new Set([left, right])];
      }
      return [];
    }
    return [];
  }
  const v = typeEqualityValue(test, paramName);
  return v === undefined ? [] : [new Set([v])];
}

/** `p.type === 'lit'` 等值守卫的值（非守卫 → undefined） */
function typeEqualityValue(
  test: Node,
  paramName: string,
): string | undefined {
  if (test.type !== "BinaryExpression") return undefined;
  const t = test as unknown as {
    operator: string;
    left: Node;
    right: Node;
  };
  if (t.operator !== "===") return undefined;
  const m = isParamTypeMember(t.left, paramName)
    ? t.right
    : isParamTypeMember(t.right, paramName)
      ? t.left
      : undefined;
  return m === undefined ? undefined : literalStringValue(m);
}

/** `p.type` 成员访问（p 是参数、property 是 type、非计算非可选） */
function isParamTypeMember(n: Node, paramName: string): boolean {
  if (n.type !== "MemberExpression") return false;
  const m = n as unknown as {
    object: Node;
    property: Node;
    computed?: boolean;
    optional?: boolean;
  };
  if (m.computed === true || m.optional === true) return false;
  if (m.property.type !== "Identifier" || m.property.name !== "type") {
    return false;
  }
  return m.object.type === "Identifier" && m.object.name === paramName;
}

/** 字符串字面量值（`'X'` 或构建器 `lit('X')`——Babel 节点类型为 StringLiteral） */
function literalStringValue(v: Node): string | undefined {
  if (v.type === "StringLiteral") {
    const lv = (v as unknown as { value: unknown }).value;
    return typeof lv === "string" ? lv : undefined;
  }
  if (v.type === "CallExpression") {
    const c = v as unknown as { callee: Node; arguments: Node[] };
    if (
      c.callee.type === "Identifier" &&
      c.callee.name === "lit" &&
      c.arguments.length === 1
    ) {
      return literalStringValue(c.arguments[0]);
    }
  }
  return undefined;
}

/** 守卫 test 蕴含 paramName 为 nullish：`!p` / `p == null` / `||` 任一 / `&&` 全部 */
function isNullishGuardOn(test: Node, paramName: string): boolean {
  if (
    test.type === "UnaryExpression" &&
    (test as unknown as { operator: string }).operator === "!"
  ) {
    const arg = (test as unknown as { argument: Node }).argument;
    return arg.type === "Identifier" && arg.name === paramName;
  }
  if (
    test.type === "BinaryExpression" &&
    ["===", "=="].includes((test as unknown as { operator: string }).operator)
  ) {
    const t = test as unknown as { left: Node; right: Node };
    return isParamVsNullish(t.left, t.right, paramName) ||
      isParamVsNullish(t.right, t.left, paramName);
  }
  if (test.type === "LogicalExpression") {
    const t = test as unknown as {
      operator: string;
      left: Node;
      right: Node;
    };
    if (t.operator === "||") {
      return isNullishGuardOn(t.left, paramName) || isNullishGuardOn(t.right, paramName);
    }
    if (t.operator === "&&") {
      return isNullishGuardOn(t.left, paramName) && isNullishGuardOn(t.right, paramName);
    }
  }
  return false;
}

function isParamVsNullish(a: Node, b: Node, paramName: string): boolean {
  if (a.type !== "Identifier" || a.name !== paramName) return false;
  if ((b.type as string) === "Literal") {
    return (b as unknown as { value: unknown }).value === null ||
      (b as unknown as { value: unknown }).value === undefined;
  }
  return b.type === "Identifier" && b.name === "undefined";
}

/** then 分支以 return/throw 结束（块看末语句）——早退路径 */
function endsWithReturnThrow(node: Node): boolean {
  if (node.type === "ReturnStatement" || node.type === "ThrowStatement") return true;
  if (node.type === "BlockStatement") {
    const body = (node as unknown as { body: Node[] }).body;
    return body.length > 0 && endsWithReturnThrow(body[body.length - 1]);
  }
  return false;
}

function isParamReassignment(stmt: Node, paramName: string): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  const expr = (stmt as unknown as { expression: Node }).expression;
  if (expr.type === "AssignmentExpression") {
    const left = (expr as unknown as { left: Node }).left;
    return left.type === "Identifier" && left.name === paramName;
  }
  if (expr.type === "UpdateExpression") {
    const arg = (expr as unknown as { argument: Node }).argument;
    return arg.type === "Identifier" && arg.name === paramName;
  }
  return false;
}

/** 链式表达式（标识符 / 调用 / 属性链）——`nullable(X)` 剥离 X 的合法性 */
const CHAIN_EXPR =
  /^[A-Za-z_$][A-Za-z0-9_$]*(?:\(.*\))?(?:\.[A-Za-z_$][A-Za-z0-9_$]*(?:\(.*\))?)*$/;

/**
 * 剥离 `nullable(…)` 包装（可重复——`nullable(nullable(x))`）；
 * 仅当内层是链式表达式（构建器调用 / 引用——其类型本就不含
 * null）；union 字面量 / 合并形态（` ∧ `）不剥。` ∧ name` 合并
 * 形态只处理表达式前缀。
 */
function stripNullableWrappers(display: string): string {
  const idx = display.indexOf(" ∧ ");
  const expr = idx === -1 ? display : display.slice(0, idx);
  const rest = idx === -1 ? "" : display.slice(idx);
  let out = expr;
  while (
    out.length > 10 &&
    out.startsWith("nullable(") &&
    out.endsWith(")") &&
    CHAIN_EXPR.test(out.slice(9, -1))
  ) {
    out = out.slice(9, -1);
  }
  return out + rest;
}

/**
 * 判别窄化：`p.type === 'lit'` 等值守卫之后，
 * 纯标识符引用（联合类型值——`astNode`）窄化
 * 为匹配臂的 shape 文本（then 分支的推导
 * 类型）。解析引用定义 → union(…) 的 shape
 * 臂 → 过滤（臂的 `type` 字面量匹配所有
 * filter）→ 匹配臂文本（` | ` 拼接）。
 * 无匹配 / 非联合定义 / 非 shape 臂 / 非
 * 纯标识符 → undefined（回退声明形态）。
 */
function narrowByDiscriminant(
  refName: string,
  filters: Array<Set<string>>,
  sidecarPath: string,
  sidecarProgram: File["program"],
  sidecarSrc: string,
  loadModule: LoadModule | undefined,
): string | undefined {
  if (loadModule === undefined) return undefined;
  // 仅纯标识符引用（调用 / 属性链不窄化）
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(refName)) return undefined;
  const def = resolveTypeValueDef(
    refName,
    sidecarPath,
    sidecarProgram,
    sidecarSrc,
    loadModule,
    0,
  );
  if (def === null || def.node === undefined) return undefined;
  const arms = unionShapeArms(def.node, def.src);
  if (arms === null) return undefined;
  const matched = arms.filter((arm) => {
    const tv = arm.typeValue;
    return tv !== undefined && filters.every((f) => f.has(tv));
  });
  if (matched.length === 0) return undefined;
  return matched.map((arm) => arm.text).join(" | ");
}

/**
 * union(…) 调用的 shape 臂。臂 = shape({ … })
 * 调用的对象字面量（或直接对象字面量）——
 * 文本为源码切片（保留构建器原文）；非
 * shape 臂（如 lit(…) 字面量臂）→ null
 * （不过滤，回退）。
 */
function unionShapeArms(
  def: Node,
  src: string,
): Array<{ typeValue: string | undefined; text: string }> | null {
  if (def.type !== "CallExpression") return null;
  const c = def as unknown as { callee: Node; arguments: Node[] };
  if (c.callee.type !== "Identifier" || c.callee.name !== "union") {
    return null;
  }
  const lineStarts = computeLineStarts(src);
  const arms: Array<{ typeValue: string | undefined; text: string }> = [];
  for (const arg of c.arguments) {
    let obj: Node | undefined;
    if (arg.type === "CallExpression") {
      const a = arg as unknown as { callee: Node; arguments: Node[] };
      if (
        a.callee.type === "Identifier" &&
        a.callee.name === "shape" &&
        a.arguments.length === 1 &&
        a.arguments[0].type === "ObjectExpression"
      ) {
        obj = a.arguments[0];
      }
    } else if (arg.type === "ObjectExpression") {
      obj = arg;
    }
    if (obj === undefined || obj.loc == null) return null;
    const start = lineColToOffset(lineStarts, obj.loc.start);
    const end = lineColToOffset(lineStarts, obj.loc.end);
    if (start === -1 || end === -1 || end <= start) return null;
    arms.push({
      typeValue: objectTypeValue(obj),
      text: src.slice(start, end),
    });
  }
  return arms.length > 0 ? arms : null;
}

/** 对象字面量的 `type` 槽字面量值（判别键） */
function objectTypeValue(obj: Node): string | undefined {
  for (const prop of (obj as unknown as { properties: Node[] }).properties) {
    if (prop.type !== "ObjectProperty") continue;
    const p = prop as unknown as {
      key: Node;
      value: Node;
      computed?: boolean;
    };
    if (p.computed === true || p.key.type !== "Identifier" || p.key.name !== "type") {
      continue;
    }
    return literalStringValue(p.value);
  }
  return undefined;
}

/** 类型值变量链接段（display 文本内偏移 → markdown 链接目标） */
type TypeValueLink = { start: number; end: number; target: string };

/**
 * 类型值变量链接：折叠展示中的引用标识符（如 `nullable(astNode)`
 * 的 `astNode`）解析到其定义位置（侧车本地顶层声明 / import 表
 * / re-export 一级），在整行 `ident: display` 中包为
 * `[astNode](file://<定义>#L<行>)`（纯文本段为代码 span——
 * 代码块内链接不渲染，故调用方 plain markdown 推送）。
 * 纯 JS 表达式形态才解析（` ∧ ` 合并形态含非 JS 字符 → 放弃）；
 * 解析不出的名字（构建器如 `string`——非 import 非本地声明）
 * 不链接。无链接段 → undefined。
 */
function linkTypeVariables(
  ident: string,
  display: string,
  sidecarPath: string,
  sidecarProgram: File["program"],
  sidecarSrc: string,
  loadModule: LoadModule | undefined,
): string | undefined {
  if (loadModule === undefined || display.includes(" ∧ ")) return undefined;
  let exprAst: File;
  try {
    exprAst = parse(display);
  } catch {
    return undefined;
  }
  const lineStarts = computeLineStarts(display);
  const links: TypeValueLink[] = [];
  for (const id of collectExprIdentifiers(exprAst)) {
    const loc = id.loc;
    if (!loc) continue;
    const def = resolveTypeValueDef(
      id.name,
      sidecarPath,
      sidecarProgram,
      sidecarSrc,
      loadModule,
      0,
    );
    if (def === null) continue;
    const start = lineColToOffset(lineStarts, loc.start);
    const end = lineColToOffset(lineStarts, loc.end);
    if (start === -1 || end === -1 || end <= start) continue;
    links.push({ start, end, target: `file://${def.path}#L${def.line}` });
  }
  if (links.length === 0) return undefined;
  links.sort((a, b) => a.start - b.start);
  // 整行渲染（ident 前缀并入首个纯文本段——避免相邻代码
  // span 之间出现空 span）
  const text = `${ident}: ${display}`;
  const shift = ident.length + 2;
  const parts: string[] = [];
  let pos = 0;
  for (const seg of links) {
    const start = seg.start + shift;
    const end = seg.end + shift;
    if (start < pos) continue;
    if (start > pos) parts.push(`\`${text.slice(pos, start)}\``);
    parts.push(`[${text.slice(start, end)}](${seg.target})`);
    pos = end;
  }
  if (pos < text.length) parts.push(`\`${text.slice(pos)}\``);
  return parts.join("");
}

/** 表达式中的引用标识符（跳过成员属性 / 对象键 / 调用 callee） */
function collectExprIdentifiers(ast: File): Identifier[] {
  const out: Identifier[] = [];
  const walk = (node: Node, parent: Node | null): void => {
    for (const key of Object.keys(node)) {
      if (
        key === "loc" ||
        key === "extra" ||
        key === "leadingComments" ||
        key === "trailingComments" ||
        key === "innerComments"
      ) {
        continue;
      }
      const v = (node as unknown as Record<string, unknown>)[key];
      const visit = (el: unknown, keyName: string): void => {
        if (!isNode(el)) return;
        if (el.type === "Identifier") {
          const skip =
            (keyName === "property" &&
              (parent as unknown as { computed?: boolean } | null)?.computed !==
                true) ||
            (keyName === "key" &&
              (parent as unknown as { computed?: boolean } | null)?.computed !==
                true) ||
            (keyName === "callee" && parent !== null);
          if (!skip) out.push(el as Identifier);
          return;
        }
        walk(el, node);
      };
      if (Array.isArray(v)) {
        for (const el of v) visit(el, key);
      } else {
        visit(v, key);
      }
    }
  };
  walk(ast, null);
  return out;
}

/** 每行起始偏移（1-based 行号 → 文本内偏移） */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineColToOffset(
  lineStarts: number[],
  p: { line: number; column: number },
): number {
  const base = lineStarts[p.line - 1];
  return base === undefined ? -1 : base + p.column;
}

/** 类型值定义（定义位置 + 定义表达式 + 所在源码） */
type TypeValueDef = {
  path: string;
  line: number;
  /** 定义表达式（VariableDeclarator.init / 函数声明
   *  / default 声明）——判别窄化（union 臂过滤）用 */
  node?: Node;
  /** 定义所在文件源码（臂文本切片用） */
  src: string;
};

/**
 * 类型值定义解析：侧车本地顶层声明 → re-export 桥接
 * （`export { a as b }`）→ re-export（`export { x } from`
 * 递归依赖）→ import 表（递归依赖）。深度上限 2
 * （re-export / import 链有界）。依赖经 resolveModule
 * 解析（相对 spec + 目录 → 路径 + AST），源码经
 * loadModule 读（臂切片用）。
 */
function resolveTypeValueDef(
  name: string,
  filePath: string,
  program: File["program"],
  src: string,
  loadModule: LoadModule,
  depth: number,
): TypeValueDef | null {
  if (depth > 2) return null;
  const locals = new Map<string, { line: number; node?: Node }>();
  const imports = new Map<string, { imported: string; spec: string }>();
  const bridges = new Map<string, string>();
  const reexports = new Map<string, { local: string; spec: string }>();
  for (const stmt of program.body) {
    const t = stmt as unknown as {
      type: string;
      source?: { value: string };
      specifiers?: Node[];
      declaration?: Node;
      loc?: { start: { line: number } };
    };
    if (t.type === "ImportDeclaration" && t.specifiers && t.source) {
      for (const sp of t.specifiers) {
        const s = sp as unknown as {
          type: string;
          local: Identifier;
          imported?: Identifier;
        };
        if (s.type === "ImportSpecifier") {
          imports.set(s.local.name, {
            imported: s.imported?.name ?? "default",
            spec: t.source.value,
          });
        } else if (s.type === "ImportDefaultSpecifier") {
          imports.set(s.local.name, { imported: "default", spec: t.source.value });
        }
      }
    } else if (t.type === "VariableDeclaration" && t.declaration === undefined) {
      for (const d of (stmt as unknown as { declarations: Node[] }).declarations) {
        const dd = d as unknown as { id: Node; init?: Node };
        if (dd.id.type === "Identifier") {
          locals.set(dd.id.name, {
            line: stmt.loc?.start.line ?? 1,
            node: dd.init,
          });
        }
      }
    } else if (
      t.type === "FunctionDeclaration" &&
      (stmt as unknown as { id?: Identifier }).id
    ) {
      locals.set((stmt as unknown as { id: Identifier }).id.name, {
        line: stmt.loc?.start.line ?? 1,
        node: stmt,
      });
    } else if (t.type === "ExportNamedDeclaration") {
      const decl = t.declaration;
      if (decl) {
        if (decl.type === "VariableDeclaration") {
          for (const d of (decl as unknown as { declarations: Node[] }).declarations) {
            const dd = d as unknown as { id: Node; init?: Node };
            if (dd.id.type === "Identifier") {
              locals.set(dd.id.name, {
                line: decl.loc?.start.line ?? 1,
                node: dd.init,
              });
            }
          }
        } else if (
          decl.type === "FunctionDeclaration" &&
          (decl as unknown as { id?: Identifier }).id
        ) {
          locals.set((decl as unknown as { id: Identifier }).id.name, {
            line: decl.loc?.start.line ?? 1,
            node: decl,
          });
        }
      } else if (t.specifiers) {
        for (const sp of t.specifiers) {
          const s = sp as unknown as {
            type: string;
            local: Identifier;
            exported: Identifier;
          };
          if (s.type !== "ExportSpecifier") continue;
          const exported = s.exported.name;
          const local = s.local.name;
          if (t.source) {
            reexports.set(exported, { local, spec: t.source.value });
          } else {
            bridges.set(exported, local);
          }
        }
      }
    } else if (t.type === "ExportDefaultDeclaration") {
      locals.set("default", {
        line: stmt.loc?.start.line ?? 1,
        node: (stmt as unknown as { declaration?: Node }).declaration,
      });
    }
  }
  const viaLocal = (l: { line: number; node?: Node }): TypeValueDef => ({
    path: filePath,
    line: l.line,
    ...(l.node !== undefined ? { node: l.node } : {}),
    src,
  });
  // 1. 本地顶层声明（含 export 声明）
  const local = locals.get(name);
  if (local !== undefined) return viaLocal(local);
  // 2. re-export 桥接（export { a as b }）→ 本地 a 的声明
  const bridged = bridges.get(name);
  if (bridged !== undefined) {
    const viaB = locals.get(bridged);
    if (viaB !== undefined) return viaLocal(viaB);
  }
  // 3/4. re-export（export { x } from）/ import 表 → 依赖递归
  const viaDep = (localName: string, spec: string): TypeValueDef | null => {
    let dep: ReturnType<typeof resolveModule>;
    try {
      dep = resolveModule(spec, dirname(filePath));
    } catch {
      return null;
    }
    if (dep === null) return null;
    let depSrc: string | undefined;
    try {
      depSrc = loadModule(dep.filePath, filePath);
    } catch {
      return null;
    }
    if (depSrc === undefined) return null;
    return resolveTypeValueDef(
      localName,
      dep.filePath,
      dep.ast.program,
      depSrc,
      loadModule,
      depth + 1,
    );
  };
  const re = reexports.get(name);
  if (re !== undefined) {
    const inner = viaDep(re.local, re.spec);
    if (inner !== null) return inner;
  }
  const imp = imports.get(name);
  if (imp !== undefined) {
    return viaDep(imp.imported, imp.spec);
  }
  return null;
}

/**
 * 参数 Abs 投影：光标在参数声明/引用上时，从 enclosing 函数的 PolyFn 面
 * （entryShapes + formals）解析标识符：
 * - 直接形参（id/default）→ entryShapes[name]
 * - 解构形参（pattern）→ bound 名经 propKey 投影到 placeholder 对象 slot
 * （rename `{a: b}` 时契约可写 a 或 b，Abs 对象只有 slot a）
 * 与函数名 hover 同源（契约种子 + 模块图在此生效）。
 */
function projectParamAbs(g: PolyFn, ident: string): Abs | undefined {
  const entry = g.entryShapes;
  if (!entry) return undefined;
  for (const f of g.formals ?? []) {
    if ((f.kind === "id" || f.kind === "default") && f.name === ident) {
      return entry.get(f.name)?.abs;
    }
    if (f.kind === "rest" && (f.name === ident || f.display === ident)) {
      return entry.get(f.name)?.abs ?? entry.get(f.display)?.abs;
    }
    if (f.kind === "pattern" && f.bound.includes(ident)) {
      const abs = entry.get(f.placeholder)?.abs;
      const key = f.propKey[ident] ?? ident;
      if (abs?.shape.k === "obj") return abs.shape.slots[key]?.value;
    }
  }
  return undefined;
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

function projectLocalAbs(
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

function findIdentifierAtPosition(ast: Node, line: number, column: number): string | null {
  let found: string | null = null;
  const traverseFn = (typeof traverse === "function" ? traverse : (traverse as any).default) as typeof traverse;
  try {
    traverseFn(ast, {
      Identifier(path) {
        const loc = path.node.loc;
        if (!loc) return;
        if (
          loc.start.line === line &&
          loc.start.column <= column &&
          loc.end.column >= column
        ) {
          found = path.node.name;
          path.stop();
        }
      },
    });
  } catch {
    // ignore
  }
  return found;
}

export function getCompletionsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  reuse?: SurfaceReuse,
): CompletionItem[] {
  const textBefore = getTextBeforePosition(source, line, column);
  const dotMatch = textBefore.match(/(\w+)\.\s*\w*$/);
  if (!dotMatch) return getVariableCompletions(filePath, source, reuse);

  const objName = dotMatch[1];

  // 成员补全的接收者解析用「尾点消毒」源码（与原 source 内容不同）；
  // reuse.ast 只对原文成立，这里保持独立 parse（parseSource 自带 LRU）
  let ast;
  try {
    ast = parse(sanitizeSourceForParsing(source));
  } catch {
    try {
      ast = parse(source);
    } catch {
      return [];
    }
  }

  // Abs 接收者优先：模块图绑定无损，不经 TypeValue evaluateProgram。
  // 空结果（unknown/never/fn 无属性）再落 TypeValue 兜底。
  if (reuse?.result) {
    // 同源绑定面：直接读 analyzeFile 的 bindings，不再整文件求值
    const bound = reuseBinding(reuse, objName);
    if (bound && bound.shape.k !== "unknown" && bound.shape.k !== "never") {
      const absCompletions = getCompletionsForAbs(bound);
      if (absCompletions.length > 0) return absCompletions;
    }
    return [];
  }
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(source, filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    const bound = binds.get(objName);
    if (bound && bound.shape.k !== "unknown" && bound.shape.k !== "never") {
      const absCompletions = getCompletionsForAbs(bound);
      if (absCompletions.length > 0) return absCompletions;
    }
  } catch {
    /* fall through */
  }

  // TypeValue evaluateProgram 已删除：无 Abs 接收者 → 空
  return [];
}

function sanitizeSourceForParsing(source: string): string {
  return source.replace(/(\w+)\.\s*$/gm, "$1._ ");
}

function getTextBeforePosition(source: string, line: number, column: number): string {
  const lines = source.split("\n");
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1].slice(0, column);
}

function getVariableCompletions(
  filePath: string,
  source: string,
  reuse?: SurfaceReuse,
): CompletionItem[] {
  if (reuse?.result) {
    // 同源绑定面（analyzeFile bindings）：不再 parse + 整文件求值
    const completions: CompletionItem[] = [];
    for (const [name, info] of reuse.result.bindings) {
      if (name.startsWith("__export_")) continue;
      completions.push({
        label: name,
        kind: info.abs.shape.k === "fn" ? "method" : "variable",
        detail: absDetail(info.abs),
      });
    }
    if (completions.length > 0) return completions;
    return [];
  }
  const ast = parse(source);

  // Abs 模块图绑定优先（无损；detail 经外延桥保持既有文案）
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(ast), { fromFile: filePath });
    const binds = collectAbsBindingsFromGraph(source, filePath, {
      seedVars: seeds.seedVars,
      seedFns: seeds.seedFns as never,
    });
    if (binds.size > 0) {
      const completions: CompletionItem[] = [];
      for (const [name, absVal] of binds) {
        if (name.startsWith("__export_")) continue;
        completions.push({
          label: name,
          kind: absVal.shape.k === "fn" ? "method" : "variable",
          detail: absDetail(absVal),
        });
      }
      if (completions.length > 0) return completions;
    }
  } catch {
    /* fall through */
  }

  // TypeValue evaluateProgram 已删除：无 Abs 绑定时返回空
  return [];
}

/**
 * 内置成员签名：直接读 BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS（唯一真值）。
 */
function builtinMemberAbs(className: string, member: string): Abs | null {
  return builtinProtoMember(className, member);
}

/**
 * 内置成员补全的唯一真值来源：求值器原型近似表。
 */
function builtinProtoMembers(className: string): string[] {
  return builtinProtoMemberNames(className);
}

/**
 * 成员 detail 的展示形态：内置方法优先取 Abs 签名
 * （formatAbs 渲染为 `(a: string) => boolean` 形式）；无签名
 * （未建模）时退回 `成员名(…)@<类>` 概要。
 */
function describeMember(label: string, a: Abs | null, fallbackClass: string): string {
  if (a) {
    const s = describeAbsMember(a);
    if (s) return s;
  }
  return `${label}(…)@${fallbackClass}`;
}

function getPromiseCompletions(): CompletionItem[] {
  return builtinProtoMembers("Promise").map((m) => ({
    label: m,
    kind: "method" as const,
    detail: describeMember(m, builtinMemberAbs("Promise", m), "Promise"),
  }));
}

function getStringCompletions(): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("String")) {
    completions.push({
      label: m,
      kind: "method",
      detail: describeMember(m, builtinMemberAbs("String", m), "String"),
    });
  }
  completions.push({ label: "length", kind: "property", detail: "number" });
  return completions;
}

// ---------------------------------------------------------------------------
// Abs 接收者补全
// ---------------------------------------------------------------------------

/** Abs → 补全 detail（外延口径："1" / "number"） */
function absDetail(a: Abs): string {
  try {
    return formatShape(a);
  } catch {
    return formatAbs(a);
  }
}

function absIsFn(a: Abs): boolean {
  return a.shape.k === "fn";
}

/** Abs 接收者的成员补全；空数组表示该形态无可派生成员（调用方可回退） */
function getCompletionsForAbs(a: Abs): CompletionItem[] {
  const s = a.shape;
  switch (s.k) {
    case "obj": {
      const completions: CompletionItem[] = [];
      for (const [key, slot] of Object.entries(s.slots)) {
        completions.push({
          label: key,
          kind: absIsFn(slot.value) ? "method" : "property",
          detail: absDetail(slot.value),
        });
      }
      return completions;
    }
    case "brand":
      return getCompletionsForAbs(s.shape);
    case "sum":
      return getSumCompletions(s.members);
    case "tuple":
      // Abs 定长元组（含 path conf——map 同长/filter 子集和的臂成员）：length
      // 就是字面量长度。旧口径只放 exact 元组、path 元组回退 TypeValue 求宽
      // array——filter 的不确定谓词臂已是精确子序列和（长度集合诚实），
      // 不再需要按「假精确」熔断。
      return getArrayCompletionsAbs(s.elements.length);
    case "arr":
      return getArrayCompletionsAbs(undefined);
    case "eff":
      if (s.eff === "promise") return getPromiseCompletions();
      return [];
    case "prim":
      if (s.type === "string") return getStringCompletions();
      return [];
    default:
      // fn / never / unknown / any：无属性面
      return [];
  }
}

function getArrayCompletionsAbs(tupleLen?: number): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("Array")) {
    const detail = describeMember(m, builtinMemberAbs("Array", m), "Array");
    completions.push({ label: m, kind: "method", detail });
  }
  completions.push({
    label: "length",
    kind: "property",
    detail: tupleLen !== undefined ? `${tupleLen}` : "number",
  });
  return completions;
}

/**
 * sum 接收者：各成员补全取交集（与 getUnionCompletions 同口径），
 * detail 为各成员该键类型字符串的并集渲染。
 */
function getSumCompletions(members: Abs[]): CompletionItem[] {
  if (members.length === 0) return [];
  const labelsByMember = members.map((m) => getCompletionsForAbs(m));
  const baseIdx = labelsByMember.findIndex((labels) => labels.length > 0);
  if (baseIdx === -1) return [];

  const common: CompletionItem[] = [];
  for (const base of labelsByMember[baseIdx]!) {
    let allPresent = true;
    const memberTypes: string[] = [base.detail ?? base.label];
    for (let i = 0; i < members.length; i++) {
      if (i === baseIdx) continue;
      const labels = labelsByMember[i]!;
      if (labels.length === 0) continue;
      const hit = labels.find((l) => l.label === base.label);
      if (!hit) {
        allPresent = false;
        break;
      }
      memberTypes.push(hit.detail ?? hit.label);
    }
    if (allPresent) {
      // 臂渲染去重：`[] | [1] | ["a"]` 的 length 臂 0|1|1|2 → 0|1|2
      common.push({ ...base, detail: [...new Set(memberTypes)].join(" | ") });
    }
  }
  return common;
}

