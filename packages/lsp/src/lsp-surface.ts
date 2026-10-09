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
  generalizeFromAst,
  formatAbs,
  formatAbsMultiline,
  formatShape,
  interfaceTierOf,
  listFnDirectiveScopes,
  type InterfaceSource,
  type InterfaceTierOpts,
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
): boolean {
  if (!ast) return false;
  try {
    const enclosing = findEnclosingFunction(extractDirectivesQuiet(ast), line);
    return !!enclosing && enclosing.directives.some((d) => d.kind === "case");
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
  const fnName = findFunctionNameAtPosition(source, line, column, file);

  // interface 档（A7）：与 CodeLens 同源；仅导出函数标注
  const tier =
    fnName !== undefined
      ? interfaceTierOf(source, fnName, filePath, opts ?? {})
      : undefined;

  // intension 候选：先算、不早退，最后合并进 evaluator/TypeValue 结果
  let gDisplay: string | undefined;
  let gAbs: string | undefined;
  let gMulti: string | undefined;
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
    if (!info) {
      return withTier({ typeText: gDisplay, intension: gDisplay, abs: gAbs, absMultiline: gMulti });
    }
    return withTier({
      ...info,
      intension: gDisplay,
      // 外延侧已有更准 Abs 时保留；否则用 symbolic 兜底
      abs: info.abs ?? gAbs,
      absMultiline: info.absMultiline ?? gMulti,
    });
  };

  // 求值引擎：优先 Abs 节点表 / 标识符绑定，不经 TypeValue evaluateProgram。
  // 用例函数体内：Abs 重放 selected case（activeCases），再 TypeValue 兜底。
  const insideCaseFn = positionInsideCaseFunction(source, file, line);

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

  // 标识符绑定优先（比粗粒度节点表更准）。用例函数体内跳过：
  // evaluator 绑定来自调用点，会盖住 activeCases 重放结果。
  const ident = findIdentNameAtPosition(source, line, column, file);
  if (ident && !fnName && !insideCaseFn) {
    if (reuse?.result) {
      // 同源绑定面：分析结果命中即返回；无绑定 = 无信息
      const absBound = reuseBinding(reuse, ident);
      if (absBound) {
        const absLine = formatAbs(absBound);
        const absMulti = formatAbsMultiline(absBound, ident);
        return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
      }
    } else if (file) {
      try {
        // 经模块图（相对 + 裸包）求 Abs 绑定
        const seeds = mockDirectivesToAbsSeeds(extractDirectivesQuiet(file), {
          fromFile: filePath,
        });
        const absBinds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const absBound = absBinds.get(ident);
        if (absBound) {
          const absLine = formatAbs(absBound);
          const absMulti = formatAbsMultiline(absBound, ident);
          return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
        }
      } catch {
        // fail-closed：绑定面求值失败 → 不产出 Abs（不拖垮 hover）
      }
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
): string | undefined {
  try {
    const ast = fileAst ?? parse(source);
    let found: string | undefined;
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
          return;
        }
        // 调用 callee
        if (parent.type === "CallExpression" && parent.callee === path.node) {
          found = path.node.name;
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
            return;
          }
        }
      },
    });
    return found;
  } catch {
    return undefined;
  }
}

function findEnclosingFunction(
  functions: FunctionWithDirectives[],
  line: number,
): FunctionWithDirectives | null {
  for (const fn of functions) {
    const loc = fn.node.loc;
    if (!loc) continue;
    if (loc.start.line <= line && loc.end.line >= line) {
      return fn;
    }
  }
  return null;
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

