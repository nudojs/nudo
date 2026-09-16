/**
 * LSP 表面（hover / 补全 / 用例枚举）——自 analyzer.ts 拆出的展示层。
 *
 * 这里只做「光标位置 → 类型」的查询与渲染：
 * - getTypeAtPosition / getHoverAtPosition：B 路径 Abs 节点表优先；
 *   用例函数体内走 Abs 重放（activeCases 选中 case + evalSource），
 *   失败才 TypeValue evaluateFunctionFull 兜底；
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
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type TypeValue,
  type Abs,
  type Environment,
  typeValueToString,
  typeValueToAbs,
  createEnvironment,
  generalizeFromAst,
  formatAbs,
  formatAbsMultiline,
  collectAbsNodeTypes,
  findAbsAtPosition,
  absToTypeValue,
  evalSource,
  setAbsNodeCollector,
} from "@nudojs/core";
import { parse, extractDirectives, extractFileDirectives } from "@nudojs/parser";
import type { FunctionWithDirectives } from "@nudojs/parser";
import {
  loadEnvs,
  preloadPathEnvs,
  describeAbsMember,
  builtinProtoMember,
  builtinProtoMemberNames,
} from "./evaluator/evaluator-api.ts";
import { mockDirectivesToAbsSeeds } from "./mock-abs.ts";
import { autoHarvestModules } from "./harvest-auto.ts";
import { evalAbsModuleGraph, collectAbsBindingsFromGraph } from "./abs-modules-graph.ts";
import { isBPathCapable } from "./bpath-run.ts";
import {
  resolveModule,
  locFromNode,
  collectEnvNames,
  buildNodeTypeMap,
  type CompletionItem,
  type SourceLocation,
} from "./analyzer.ts";

export type CaseInfo = {
  functionName: string;
  caseName: string;
  caseIndex: number;
};

export function getCasesForFile(filePath: string, source: string): { functionName: string; cases: { name: string; index: number }[]; loc: SourceLocation }[] {
  const ast = parse(source);
  const functions = extractDirectives(ast);
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
): Promise<TypeValue | null> {
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

/** 光标是否落在带 @nudo:case 的函数体内（该区域 hover/inlay 须走 TypeValue + activeCases）。 */
function positionInsideCaseFunction(
  source: string,
  ast: ReturnType<typeof parse>,
  line: number,
): boolean {
  try {
    const enclosing = findEnclosingFunction(extractDirectives(ast), line);
    return !!enclosing && enclosing.directives.some((d) => d.kind === "case");
  } catch {
    return false;
  }
}

/**
 * B-path 节点表 / 标识符绑定上的无损 Abs（不经 TypeValue）。
 * 用例函数体内返回 null——那里走 case Abs 重放（见 absFromCaseReplay）。
 */
function absFromBPath(
  filePath: string,
  source: string,
  line: number,
  column: number,
  ast: ReturnType<typeof parse>,
  envNames: string[],
): Abs | null {
  if (!isBPathCapable(source, envNames)) return null;
  if (positionInsideCaseFunction(source, ast, line)) return null;
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast));
    const { modules } = evalAbsModuleGraph(source, filePath);
    const absNodes = collectAbsNodeTypes(source, {
      ...seeds,
      modules,
      file: ast as never,
    });
    const absAt = findAbsAtPosition(absNodes, line, column);
    if (absAt) return absAt;
    const ident = findIdentNameAtPosition(source, line, column, ast);
    if (ident) {
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
 * 用例函数体内的 Abs 重放（T17）：按 activeCases 选中的 case 实参跑
 * evalSource + 节点收集，光标处取无损 Abs。不经 TypeValue evaluateFunctionFull。
 * 失败/空表 → undefined，调用方落 TypeValue 兜底。
 */
function absFromCaseReplay(
  filePath: string,
  source: string,
  line: number,
  column: number,
  ast: ReturnType<typeof parse>,
  activeCases?: Map<string, number>,
): Abs | null {
  const functions = extractDirectives(ast);
  const enclosingFn = findEnclosingFunction(functions, line);
  if (!enclosingFn) return null;
  const caseDirectives = enclosingFn.directives.filter((d) => d.kind === "case");
  if (caseDirectives.length === 0) return null;
  const caseIndex = activeCases?.get(enclosingFn.name) ?? 0;
  const directive = caseDirectives[Math.min(caseIndex, caseDirectives.length - 1)];

  // 约束表达式 argsAbs 主路径
  const caseArgs: Abs[] = directive.argsAbs;

  const map = new Map<Node, Abs>();
  setAbsNodeCollector((node, value) => map.set(node, value));
  try {
    const seeds = mockDirectivesToAbsSeeds(functions);
    let modules: Record<string, import("@nudojs/core").AbsModuleExports> | undefined;
    try {
      modules = evalAbsModuleGraph(source, filePath).modules;
    } catch {
      modules = undefined;
    }
    evalSource(
      source,
      { fn: enclosingFn.name, args: caseArgs },
      {
        file: ast as never,
        modules,
        seedVars: seeds.seedVars,
        seedFns: seeds.seedFns as never,
      },
    );
  } catch {
    /* 重放失败 → TypeValue 兜底 */
  } finally {
    setAbsNodeCollector(null);
  }
  if (map.size === 0) return null;
  return findAbsAtPosition(map, line, column) ?? null;
}

function safeTypeValueToAbs(tv: TypeValue): Abs {
  try {
    return typeValueToAbs(tv);
  } catch {
    return { shape: { k: "unknown" }, conf: "opaque" };
  }
}

/**
 * 光标处无损 Abs。B-path 节点表优先；用例函数体走 Abs 重放。
 * TypeValue evaluateProgram 已删除——无 Abs 时返回 null。
 */
export function getAbsAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): Abs | null {
  const ast = parse(source);
  const envNames = extractFileDirectives(ast)
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  const fromB = absFromBPath(filePath, source, line, column, ast, envNames);
  if (fromB) return fromB;

  // 用例函数体：按 activeCases 选中 case 做 Abs 重放（不经 TypeValue）
  if (positionInsideCaseFunction(source, ast, line)) {
    const fromCase = absFromCaseReplay(filePath, source, line, column, ast, activeCases);
    if (fromCase) return fromCase;
  }

  return null;
}

export function getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): TypeValue | null {
  // TypeValue evaluateProgram/evaluateFunctionFull 已删除：统一走 Abs 再 bridge
  const absVal = getAbsAtPosition(filePath, source, line, column, activeCases);
  return absVal ? absToTypeValue(absVal) : null;
}

export type HoverInfo = {
  /** 外延 TypeValue 展示（bridge 有损，仅兜底） */
  typeText: string;
  /** 内涵签名（代数 generalize） */
  intension?: string;
  /** 无损 Abs 单行展示（shape / term / pred / conf） */
  abs?: string;
  /** 无损 Abs 多行展示 */
  absMultiline?: string;
};

/**
 * LSP hover：优先无损 Abs（类型即计算本体），TypeValue 仅作外延对照。
 * 节点表也是 Abs（collectAbsNodeTypes），不经 bridge。
 *
 * 函数名/调用 callee 位置（design-hof-relations §7）：
 * intension 一律走 generalize/formatPoly（HOF fnRels 在这里）；
 * typeText 仍落 B-path / TypeValue（调用点显示结果类型，不是函数签名）。
 * 禁止用 B-path 的 arity-only fn Abs 冒充权威关系源。
 */
export function getHoverAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): HoverInfo | null {
  let file: ReturnType<typeof parse> | undefined;
  try {
    file = parse(source);
  } catch {
    file = undefined;
  }
  const envNames = collectEnvNames(filePath, source, false);
  const fnName = findFunctionNameAtPosition(source, line, column, file);

  // intension 候选：先算、不早退，最后合并进 B-path/TypeValue 结果
  let gDisplay: string | undefined;
  let gAbs: string | undefined;
  let gMulti: string | undefined;
  if (fnName) {
    try {
      const g = generalizeFromAst(fnName, source, file ? { file } : {});
      if (g) {
        gDisplay = g.display;
        gAbs = formatAbs(g.symbolic);
        gMulti = formatAbsMultiline(g.symbolic, fnName);
      }
    } catch {
      // ignore
    }
  }
  const attachIntension = (info: HoverInfo | null): HoverInfo | null => {
    if (!gDisplay) return info;
    if (!info) {
      return { typeText: gDisplay, intension: gDisplay, abs: gAbs, absMultiline: gMulti };
    }
    return {
      ...info,
      intension: gDisplay,
      // 外延侧已有更准 Abs 时保留；否则用 symbolic 兜底
      abs: info.abs ?? gAbs,
      absMultiline: info.absMultiline ?? gMulti,
    };
  };

  // B 路径：优先 Abs 节点表 / 标识符绑定，不经 TypeValue evaluateProgram。
  // 用例函数体内：Abs 重放 selected case（activeCases），再 TypeValue 兜底。
  const insideCaseFn = positionInsideCaseFunction(
    source,
    file ?? parse(source),
    line,
  );

  if (!insideCaseFn) {
    const fromB = absFromBPath(
      filePath,
      source,
      line,
      column,
      file ?? parse(source),
      envNames,
    );
    if (fromB) {
      const absLine = formatAbs(fromB);
      const absMulti = formatAbsMultiline(fromB, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  } else {
    const fromCase = absFromCaseReplay(
      filePath,
      source,
      line,
      column,
      file ?? parse(source),
      activeCases,
    );
    if (fromCase) {
      const absLine = formatAbs(fromCase);
      const absMulti = formatAbsMultiline(fromCase, undefined);
      return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
    }
  }

  // Abs 兜底（含 case 重放失败后的 TypeValue 桥）
  const absFallback = getAbsAtPosition(filePath, source, line, column, activeCases);
  if (absFallback) {
    const absLine = formatAbs(absFallback);
    const absMulti = formatAbsMultiline(absFallback, undefined);
    return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
  }

  const tv = getTypeAtPosition(filePath, source, line, column, activeCases);
  const info: HoverInfo | null = tv ? { typeText: typeValueToString(tv) } : null;

  // 标识符绑定优先（比粗粒度节点表更准）。用例函数体内跳过：
  // B-path 绑定来自调用点，会盖住 activeCases 重放结果。
  const ident = findIdentNameAtPosition(source, line, column, file);
  if (ident && !fnName && !insideCaseFn) {
    try {
      // 经模块图（相对 + 裸包）求 Abs 绑定
      if (isBPathCapable(source, []) || !/\brequire\s*\(/.test(source)) {
        const seeds = mockDirectivesToAbsSeeds(extractDirectives(file ?? parse(source)));
        const absBinds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const absBound = absBinds.get(ident);
        if (absBound) {
          const absLine = formatAbs(absBound);
          const absMulti = formatAbsMultiline(absBound, ident);
          if (info) {
            info.abs = absLine;
            info.absMultiline = absMulti;
            return attachIntension(info);
          }
          return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
        }
      }
    } catch {
      // ignore
    }
  }

  // 任意表达式：Abs 节点表（无损）
  try {
    if (
      !insideCaseFn &&
      (isBPathCapable(source, []) || !/\brequire\s*\(|\bimport\s*[{'"*]/.test(source))
    ) {
      const seeds = mockDirectivesToAbsSeeds(
        extractDirectives(file ?? parse(source)),
      );
      const { modules } = evalAbsModuleGraph(source, filePath);
      const nodeTypes = collectAbsNodeTypes(source, {
        ...seeds,
        modules,
        ...(file ? { file } : {}),
      });
      const absAt = findAbsAtPosition(nodeTypes, line, column);
      if (absAt) {
        const absLine = formatAbs(absAt);
        const absMulti = formatAbsMultiline(absAt, undefined);
        if (info) {
          info.abs = absLine;
          info.absMultiline = absMulti;
        } else {
          return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
        }
      }
    }
  } catch {
    // ignore
  }

  return attachIntension(info);
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

/** 光标处标识符是否是顶层/导出函数名 */
function findFunctionNameAtPosition(
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
        // 仅函数声明 id / 调用 callee；const x = 1 的 id 归绑定路径
        const parent = path.parent;
        if (
          parent.type === "FunctionDeclaration" &&
          parent.id === path.node
        ) {
          found = path.node.name;
        } else if (
          parent.type === "CallExpression" &&
          parent.callee === path.node
        ) {
          found = path.node.name;
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

function findBestTypeAtPosition(
  nodeTypeMap: Map<Node, TypeValue>,
  globalEnv: Environment,
  ast: Node,
  line: number,
  column: number,
): TypeValue | null {
  let bestMatch: TypeValue | null = null;
  let bestSize = Infinity;

  for (const [node, tv] of nodeTypeMap) {
    const loc = node.loc;
    if (!loc) continue;
    if (
      loc.start.line <= line &&
      loc.end.line >= line &&
      (loc.start.line < line || loc.start.column <= column) &&
      (loc.end.line > line || loc.end.column >= column)
    ) {
      const size = (loc.end.line - loc.start.line) * 10000 + (loc.end.column - loc.start.column);
      if (size < bestSize) {
        bestSize = size;
        bestMatch = tv;
      }
    }
  }

  if (!bestMatch) {
    const identAtPos = findIdentifierAtPosition(ast, line, column);
    if (identAtPos && globalEnv.has(identAtPos)) {
      bestMatch = globalEnv.lookup(identAtPos);
    }
  }

  return bestMatch;
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
): CompletionItem[] {
  const textBefore = getTextBeforePosition(source, line, column);
  const dotMatch = textBefore.match(/(\w+)\.\s*\w*$/);
  if (!dotMatch) return getVariableCompletions(filePath, source);

  const objName = dotMatch[1];

  const safeSource = sanitizeSourceForParsing(source);

  let ast;
  try {
    ast = parse(safeSource);
  } catch {
    try {
      ast = parse(source);
    } catch {
      return [];
    }
  }

  // Abs 接收者优先：模块图绑定无损，不经 TypeValue evaluateProgram。
  // 空结果（unknown/never/fn 无属性）再落 TypeValue 兜底。
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast));
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

function getVariableCompletions(filePath: string, source: string): CompletionItem[] {
  const ast = parse(source);

  // Abs 模块图绑定优先（无损；detail 经外延桥保持既有文案）
  try {
    const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast));
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

function getArrayCompletions(tv: TypeValue): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("Array")) {
    const detail = describeMember(m, builtinMemberAbs("Array", m), "Array");
    completions.push({ label: m, kind: "method", detail });
  }
  completions.push({
    label: "length",
    kind: "property",
    // tuple 长度是精确字面量；array 是 number（保持原展示语义）
    detail: tv.kind === "tuple" ? `${tv.elements.length}` : "number",
  });
  return completions;
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

/**
 * union 接收者：各成员补全取交集（对成员全部「可能存在」的公共键），
 * detail 为各成员该键类型字符串的并集渲染。键序取首个含该键的成员序，
 * 稳定且与成员书写顺序一致。无公共键返回空——打点补全只展示确定可用
 * 的成员，不做「部分成员才有」的投机提示。
 */
function getUnionCompletions(tv: TypeValue & { kind: "union" }): CompletionItem[] {
  const members = tv.members;
  if (members.length === 0) return [];

  const labelsByMember = members.map((m) => getCompletionsForType(m));
  // 首个非空成员集的键序作基准；对空集成员（无任何已知成员，如 unknown）
  // 视为「任何键都可能存在」——跳过其过滤而非让交集归零
  const baseIdx = labelsByMember.findIndex((labels) => labels.length > 0);
  if (baseIdx === -1) return [];

  const common: CompletionItem[] = [];
  for (const base of labelsByMember[baseIdx]) {
    let allPresent = true;
    const memberTypes: string[] = [base.detail ?? base.label];
    for (let i = 0; i < members.length; i++) {
      if (i === baseIdx) continue;
      const labels = labelsByMember[i];
      if (labels.length === 0) continue; // 该成员无已知成员集 → 不约束交集
      const hit = labels.find((l) => l.label === base.label);
      if (!hit) {
        allPresent = false;
        break;
      }
      memberTypes.push(hit.detail ?? hit.label);
    }
    if (allPresent) {
      common.push({ ...base, detail: memberTypes.join(" | ") });
    }
  }
  return common;
}

function getCompletionsForType(tv: TypeValue): CompletionItem[] {
  const completions: CompletionItem[] = [];

  if (tv.kind === "object") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "instance") {
    for (const [key, val] of Object.entries(tv.properties)) {
      completions.push({
        label: key,
        kind: val.kind === "function" ? "method" : "property",
        detail: typeValueToString(val),
      });
    }
    return completions;
  }

  if (tv.kind === "union") {
    return getUnionCompletions(tv);
  }

  if (tv.kind === "array" || tv.kind === "tuple") {
    return getArrayCompletions(tv);
  }

  if (tv.kind === "promise") {
    return getPromiseCompletions();
  }

  if (tv.kind === "primitive" && tv.type === "string") {
    return getStringCompletions();
  }

  return completions;
}

// ---------------------------------------------------------------------------
// Abs 接收者补全（TypeValue 退出主路径）
// ---------------------------------------------------------------------------

/** Abs → 补全 detail：经 TypeValue 桥保持与既有展示口径一致（"1" / "number"） */
function absDetail(a: Abs): string {
  try {
    return typeValueToString(absToTypeValue(a));
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
      // 仅 exact 定长元组走 Abs（字面量数组）；path 元组（filter 等仍挂
      // 定长形状）回退 TypeValue——那里 filter 结果已 widen 成 array，
      // length 显示 number，避免假精确。
      if (a.conf === "exact") return getArrayCompletionsAbs(s.elements.length);
      return [];
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
      common.push({ ...base, detail: memberTypes.join(" | ") });
    }
  }
  return common;
}

