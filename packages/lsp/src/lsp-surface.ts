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
import type { File, Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type Abs,
  type AbsModuleExports,
  callTranspiledExportFull,
  generalizeFromAst,
  formatAbs,
  formatAbsMultiline,
  formatShape,
  formalParamSignatureNames,
  interfaceTierOf,
  joinAbs,
  listFnDirectiveScopes,
  runTranspiled,
  setEvalAssignCollector,
  setEvalCallCollector,
  type EvalAbsAssignRecord,
  type EvalCallRecord,
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
        // check 同口径签名（check-signatures formatEntrySigLine 同公式：
        // formalParamSignatureNames + formatShape；throws 归 check 门禁面）
        const names =
          g.formals && g.formals.length > 0 ? formalParamSignatureNames(g.formals) : g.params;
        const ps = names
          .map((p, i) => {
            const t = g.typeParams[i]?.value;
            // design §2：无约束 any；真 unknown 不得伪装
            const shown = !t ? "any" : t.shape.k === "unknown" ? "unknown" : formatShape(t);
            return `${p}: ${shown}`;
          })
          .join(", ");
        gSig = `${fnName}(${ps}) => ${formatShape(g.symbolic)}`;
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

  if (!insideCaseFn) {
    const fromB = absFromEval(filePath, source, line, column, file, reuse);
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
  const absFallback = getAbsAtPosition(filePath, source, line, column, activeCases, {
    ...(reuse?.result !== undefined ? { result: reuse.result } : {}),
    ...(file !== undefined ? { ast: file } : {}),
  });
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
     *  留给函数名 hover 的契约面，标识符面不重复展开 */
    const identHover = (value: Abs): HoverInfo => {
      const text = `${ident}: ${formatShape(value)}`;
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
  // 调用初始化声明 → 调用记录 result（callLoc 对位 init 起点）
  for (const d of declaredCallInits(enc.node)) {
    const rec = calls.find(
      (c) => c.callLoc && c.callLoc.line === d.line && c.callLoc.column === d.column,
    );
    if (rec) out.set(d.name, rec.result);
  }
  // 范围内再赋值 → join（路径不敏感的诚实答案）
  if (loc) {
    for (const r of assigns) {
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

