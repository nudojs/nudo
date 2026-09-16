/**
 * LSP 表面（hover / 补全 / 用例枚举）——自 analyzer.ts 拆出的展示层。
 *
 * 这里只做「光标位置 → 类型」的查询与渲染：
 * - getTypeAtPosition / getHoverAtPosition：B 路径 Abs 节点表优先，
 *   用例函数体内回退 TypeValue + activeCases 重放；
 * - getCompletionsAtPosition 及补全辅助（builtinMemberType 微求值、
 *   array/promise/string/union 成员补全）——内置成员唯一真值来源是
 *   evaluator 的 BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS；
 * - 光标定位 helpers（标识符/函数名/包围函数/最佳节点匹配）。
 *
 * 分析编排（diagnostics / case 求值 / 调用记录）仍在 analyzer.ts；
 * 依赖的共享 helpers（resolveModule / locFromNode / collectEnvNames /
 * buildNodeTypeMap）由 analyzer 显式导出。纯迁移，零行为变化。
 */
import { dirname } from "node:path";
import type { Node } from "@babel/types";
import traverse from "@babel/traverse";
import {
  type TypeValue,
  type Environment,
  typeValueToString,
  createEnvironment,
  generalizeFromAst,
  formatAbs,
  formatAbsMultiline,
  getFnSig,
  collectAbsNodeTypes,
  findAbsAtPosition,
  absToTypeValue,
} from "@nudojs/core";
import { parse, extractDirectives, extractFileDirectives } from "@nudojs/parser";
import type { FunctionWithDirectives } from "@nudojs/parser";
import {
  evaluate,
  evaluateFunctionFull,
  evaluateProgram,
  setModuleResolver,
  setCurrentFileDir,
  setCurrentSource,
  resetMemo,
  resetEnvModules,
  resetMockModules,
  setEnvModules,
  setNodeTypeCollector,
  loadEnvs,
  preloadPathEnvs,
  BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS,
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

export function getTypeAtPosition(
  filePath: string,
  source: string,
  line: number,
  column: number,
  activeCases?: Map<string, number>,
): TypeValue | null {
  const ast = parse(source);
  const fileDirectives = extractFileDirectives(ast);
  const envNames = fileDirectives
    .filter((d) => d.kind === "env")
    .flatMap((d) => d.envs);

  // B 路径 capable：节点表来自 evalProgramAbs（模块图注入），不跑 TypeValue evaluateProgram。
  // 用例函数体内除外：那里的权威类型是 activeCases 选中的用例实参重放。
  if (
    isBPathCapable(source, envNames) &&
    !positionInsideCaseFunction(source, ast, line)
  ) {
    try {
      const seeds = mockDirectivesToAbsSeeds(extractDirectives(ast));
      const { modules } = evalAbsModuleGraph(source, filePath);
      const absNodes = collectAbsNodeTypes(source, {
        ...seeds,
        modules,
        file: ast as never,
      });
      const absAt = findAbsAtPosition(absNodes, line, column);
      if (absAt) return absToTypeValue(absAt);
      // 标识符绑定兜底
      const ident = findIdentNameAtPosition(source, line, column, ast);
      if (ident) {
        const binds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const bound = binds.get(ident);
        if (bound) return absToTypeValue(bound);
      }
    } catch {
      /* fall through to TypeValue */
    }
  }

  resetMemo();
  resetEnvModules();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));
  setCurrentSource(source);

  const globalEnv = createEnvironment();

  {
    const loaded = envNames.length > 0 ? loadEnvs(envNames, globalEnv) : { modules: {} };
    const auto = autoHarvestModules(source, dirname(filePath));
    const modules = { ...loaded.modules, ...auto };
    if (Object.keys(modules).length > 0) setEnvModules(modules);
  }

  evaluateProgram(ast, globalEnv);

  const nodeTypeMap = new Map<Node, TypeValue>();
  buildNodeTypeMap(ast, globalEnv, nodeTypeMap);

  const functions = extractDirectives(ast);
  const enclosingFn = findEnclosingFunction(functions, line);

  if (enclosingFn) {
    const caseDirectives = enclosingFn.directives.filter((d) => d.kind === "case");
    if (caseDirectives.length > 0) {
      const caseIndex = activeCases?.get(enclosingFn.name) ?? 0;
      const directive = caseDirectives[Math.min(caseIndex, caseDirectives.length - 1)];

      const fnNodeTypeMap = new Map<Node, TypeValue>();
      setNodeTypeCollector((node, tv) => fnNodeTypeMap.set(node, tv));
      evaluateFunctionFull(enclosingFn.node, directive.args, globalEnv);
      setNodeTypeCollector(null);

      for (const [node, tv] of fnNodeTypeMap) {
        nodeTypeMap.set(node, tv);
      }
    }
  }

  setModuleResolver(null);
  resetEnvModules();
  resetMockModules();
  return findBestTypeAtPosition(nodeTypeMap, globalEnv, ast, line, column);
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
  // 光标落在带 @nudo:case 的函数体内时交给 TypeValue：那里按 activeCases
  // 重放用例实参；B 路径节点表来自调用点求值，会盖住用例切换。
  const insideCaseFn = positionInsideCaseFunction(
    source,
    file ?? parse(source),
    line,
  );

  if (isBPathCapable(source, envNames) && !insideCaseFn) {
    try {
      const seeds = mockDirectivesToAbsSeeds(extractDirectives(file ?? parse(source)));
      const { modules } = evalAbsModuleGraph(source, filePath);
      const absNodes = collectAbsNodeTypes(source, {
        ...seeds,
        modules,
        ...(file ? { file: file as never } : {}),
      });
      const absAt = findAbsAtPosition(absNodes, line, column);
      const ident = findIdentNameAtPosition(source, line, column, file);
      if (ident && !fnName) {
        const binds = collectAbsBindingsFromGraph(source, filePath, {
          seedVars: seeds.seedVars,
          seedFns: seeds.seedFns as never,
        });
        const bound = binds.get(ident);
        if (bound) {
          const absLine = formatAbs(bound);
          const absMulti = formatAbsMultiline(bound, ident);
          return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
        }
      }
      if (absAt) {
        const absLine = formatAbs(absAt);
        const absMulti = formatAbsMultiline(absAt, undefined);
        return attachIntension({ typeText: absLine, abs: absLine, absMultiline: absMulti });
      }
    } catch {
      /* fall through */
    }
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

  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  if (!globalEnv.has(objName)) {
    setModuleResolver(null);
    return [];
  }

  const objType = globalEnv.lookup(objName);
  const completions = getCompletionsForType(objType);

  setModuleResolver(null);
  return completions;
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
  resetMemo();
  setModuleResolver(resolveModule);
  setCurrentFileDir(dirname(filePath));

  const globalEnv = createEnvironment();
  evaluateProgram(ast, globalEnv);

  const ownBindings = globalEnv.getOwnBindings();
  const completions: CompletionItem[] = [];
  for (const [name, tv] of Object.entries(ownBindings)) {
    if (name.startsWith("__export_")) continue;
    completions.push({
      label: name,
      kind: tv.kind === "function" ? "method" : "variable",
      detail: typeValueToString(tv),
    });
  }

  setModuleResolver(null);
  return completions;
}

/**
 * 内置成员的真实签名：把「<类>.prototype.<成员>」交给 evaluator 微求值。
 * 这是唯一真值来源（与诊断/求值同表——BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS），
 * 不在补全侧另建平行类型系统。evaluate 直接返回 TypeValue（或 return/throw
 * 控制标记，此处到不了）；无 kind 的结果一律视为不可用返回 null 由调用方回退。
 * 微求值受 evaluator 全局态（当前 env、resolver）影响，仅用于补全展示。
 */
function builtinMemberType(memberExpr: string): TypeValue | null {
  try {
    const result: unknown = evaluate(parse(`${memberExpr};`), createEnvironment());
    if (!result || typeof result !== "object" || !("kind" in result)) return null;
    return result as TypeValue;
  } catch {
    return null;
  }
}

/**
 * 内置成员补全的唯一真值来源：求值器原型近似表
 * （BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS）。表内新增建模的方法
 * （如 flatMap）自动进入补全，不再手工同步平行名单；表外方法未建模，
 * 微求值拿 undefined、列出只会得到回退文案，故不派生。
 */
function builtinProtoMembers(className: string): string[] {
  const table = BUILTIN_PROTOTYPE_METHOD_APPROXIMATIONS[className];
  return table ? Object.keys(table) : [];
}

/**
 * 成员 detail 的展示形态：内置方法优先取 evaluator 的真实 fnSig
 * （typeValueToString 渲染为 `(a: string) => boolean` 形式）；无签名
 * （未建模或求值异常）时退回 `成员名(…)@<类>` 概要。取舍：不伪造平行签名，
 * 缺席就明示缺席——detail 永远可解释、与求值结果一致。
 */
function describeMember(label: string, tv: TypeValue | null, fallbackClass: string): string {
  if (tv) {
    const sig = getFnSig(tv);
    if (sig) {
      const paramNames = tv.kind === "function" ? tv.params : [];
      const params = sig.paramTypes.map((p, i) => `${paramNames[i] ?? `arg${i}`}: ${typeValueToString(p)}`).join(", ");
      return `(${params}) => ${typeValueToString(sig.returnType)}`;
    }
    if (tv.kind !== "function") return typeValueToString(tv);
  }
  return `${label}(…)@${fallbackClass}`;
}

function getArrayCompletions(tv: TypeValue): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("Array")) {
    const detail = describeMember(m, builtinMemberType(`Array.prototype.${m}`), "Array");
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
    detail: describeMember(m, builtinMemberType(`Promise.prototype.${m}`), "Promise"),
  }));
}

function getStringCompletions(): CompletionItem[] {
  const completions: CompletionItem[] = [];
  for (const m of builtinProtoMembers("String")) {
    completions.push({
      label: m,
      kind: "method",
      detail: describeMember(m, builtinMemberType(`"s".${m}`), "String"),
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

