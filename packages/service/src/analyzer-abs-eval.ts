/**
 * Abs 重求值 / intension 挂载 / 调用记录转换辅助。
 * 自 analyzer.ts 机械拆出；语义未改。B-path 仍是唯一引擎（失败 fail-closed）。
 */
import { existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Node } from "@babel/types";
import {
  generalizeFromAst,
  termToString,
  predToString,
  getFnImpl,
  $call,
  unknown as absUnknown,
  absFunction,
  formatAbs,
  formatAbsMultiline,
  type Abs,
} from "@nudojs/core";
import { parse } from "@nudojs/parser";
import {
  neverAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { tryBPathCallFull } from "./bpath-run.ts";
import type { CaseResult, FunctionAnalysis } from "./analyzer-types.ts";

/**
 * Abs 是否比既有结果更有信息量。
 * 仅在既有侧 unknown / 裸 prim 且新结果带约束时替换，
 * 避免用粗结果盖掉 mock/callsite 已精确投影的结构。
 */
export function absIsBetter(next: Abs, prev: Abs): boolean {
  const isBareUnknown = (a: Abs): boolean => a.shape.k === "unknown" && !a.term;
  const isNever = (a: Abs): boolean => a.shape.k === "never";
  const isStructured = (a: Abs): boolean =>
    a.term?.op === "lit" ||
    a.shape.k === "obj" ||
    a.shape.k === "arr" ||
    a.shape.k === "tuple" ||
    a.shape.k === "sum" ||
    a.shape.k === "fn" ||
    a.shape.k === "brand" ||
    a.shape.k === "eff";
  const hasPred = (a: Abs): boolean => !!a.pred && a.pred.op !== "true";

  if (isBareUnknown(prev)) return !isBareUnknown(next);
  if (isBareUnknown(next) || isNever(next)) return false;
  if (isStructured(prev)) return false;
  if (hasPred(next) && prev.shape.k === "prim" && !hasPred(prev)) return true;
  return false;
}
/**
 * 自包含 = 无 import/require、无 @nudo:env。
 * @nudo:mock 不阻断 Abs：已编译为 seedVars/seedFns 注入 evalProgramAbs。
 * 相对 import 经 Abs 模块图注入后，也不再阻断 Abs 路径。
 */
export function isSelfContainedSource(source: string, envNames: string[]): boolean {
  if (envNames.length > 0) return false;
  return !/\brequire\s*\(|\bimport\s*[{'"*]/.test(source);
}

/** Abs 模块图可处理：env 由 loadEnvs 处理（内置 + 预加载路径型） */
export function absModulesOk(source: string, envNames: string[]): boolean {
  void source;
  void envNames;
  return true;
}




/** 入口 import 局部绑定 → 解析后的模块路径 + 导出名 */
export function buildAbsImportLocalMap(
  source: string,
  fromFile: string,
): Map<string, { modulePath: string; exportName: string }> {
  const out = new Map<string, { modulePath: string; exportName: string }>();
  try {
    const file = parse(source);
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration") {
        const spec = stmt.source.value;
        let modulePath: string | null = null;
        if (spec.startsWith(".") || spec.startsWith("/")) {
          modulePath = resolveImportAbs(spec, fromFile);
        } else if (!spec.startsWith("node:")) {
          // 裸包：用说明符本身作 module 标（externalFunctions 可显示）
          modulePath = spec;
        }
        if (!modulePath) continue;
        for (const s of stmt.specifiers) {
          if (s.type === "ImportSpecifier") {
            const imported =
              s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
            out.set(s.local.name, { modulePath, exportName: imported });
          } else if (s.type === "ImportDefaultSpecifier") {
            out.set(s.local.name, { modulePath, exportName: "default" });
          } else if (s.type === "ImportNamespaceSpecifier") {
            // `import * as ns`：成员调用 `ns.helper` 由 callRecordFromAbsCall
            // 按 `ns.helper` / 点号拆分解析到 targetExport=helper
            out.set(s.local.name, { modulePath, exportName: "*" });
          }
        }
        continue;
      }
      // CJS: const { double } = require("./util.js")
      if (stmt.type === "VariableDeclaration") {
        for (const d of stmt.declarations) {
          if (d.init?.type !== "CallExpression") continue;
          const callee = d.init.callee;
          if (callee.type !== "Identifier" || callee.name !== "require") continue;
          const arg0 = d.init.arguments[0];
          if (!arg0 || arg0.type !== "StringLiteral") continue;
          const spec = arg0.value;
          let modulePath: string | null = null;
          if (spec.startsWith(".") || spec.startsWith("/")) {
            modulePath = resolveImportAbs(spec, fromFile);
          } else if (!spec.startsWith("node:")) {
            modulePath = spec;
          }
          if (!modulePath) continue;
          if (d.id.type === "ObjectPattern") {
            for (const p of d.id.properties) {
              if (p.type !== "ObjectProperty" || p.computed) continue;
              if (p.key.type !== "Identifier" || p.value.type !== "Identifier") continue;
              out.set(p.value.name, { modulePath, exportName: p.key.name });
            }
          } else if (d.id.type === "Identifier") {
            out.set(d.id.name, { modulePath, exportName: "default" });
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function resolveImportAbs(spec: string, fromFile: string): string | null {
  const base = dirname(resolve(fromFile));
  const p = resolve(base, spec);
  for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")]) {
    if (existsSync(cand) && !statSync(cand).isDirectory()) return cand;
  }
  return null;
}

/** Abs 原生重求值（无损）；B-path 唯一引擎，失败返回 undefined（fail-closed） */
export function tryEvalAbsRaw(
  source: string,
  fnName: string,
  args: Abs[],
  filePath?: string,
  mocks?: Record<string, Abs>,
  assignedName?: string,
): Abs | undefined {
  return tryEvalAbsFull(source, fnName, args, filePath, mocks, assignedName)?.result;
}

/**
 * Abs 原生重求值 + throws（T19）：B-path 带 throws；失败返回 undefined。
 * require 源码不走 Abs。
 */
export function tryEvalAbsFull(
  source: string,
  fnName: string,
  args: Abs[],
  filePath?: string,
  mocks?: Record<string, Abs>,
  assignedName?: string,
): { result: Abs; throws: Abs; throwLoc?: { line: number; column: number } } | undefined {
  if (/\brequire\s*\(/.test(source)) return undefined;
  // fail-closed：B-only（ast-eval analyzeFnFull 兜底已删——无 throwLoc 补充、
  // 无 Abs 重求值；B 失败 → undefined）
  try {
    if (filePath) {
      const viaB =
        tryBPathCallFull(source, filePath, fnName, args, { mocks }) ??
        (assignedName ? tryBPathCallFull(source, filePath, assignedName, args, { mocks }) : undefined);
      if (viaB) {
        const r = viaB.result;
        if (r && !(r.shape.k === "unknown" && !r.term)) {
          const throws = viaB.throws ?? { shape: { k: "never" }, conf: "exact" };
          return { result: r, throws };
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * entry@ 的 Abs 原生路径：自包含源码走 B-path（类型即计算）。
 * 含 import/require 或求值失败时返回 undefined。
 */
export function tryEvalEntryAbs(
  source: string,
  fnName: string,
  args: Abs[],
  filePath?: string,
  mocks?: Record<string, Abs>,
  assignedName?: string,
): Abs | undefined {
  return tryEvalAbsRaw(source, fnName, args, filePath, mocks, assignedName);
}

/**
 * entry@ 附加内涵摘要（代数 generalize + 无损 Abs）。
 * 失败静默——不改变外延 TypeValue。
 */
export function tryAttachIntension(
  caseResult: CaseResult,
  source: string,
  fnName: string,
): void {
  try {
    const g = generalizeFromAst(fnName, source);
    if (!g) return;
    const sym = g.symbolic;
    const intension: NonNullable<CaseResult["intension"]> = {
      display: g.display,
      abs: formatAbs(sym),
      absMultiline: formatAbsMultiline(sym, fnName),
    };
    if (sym.term && sym.term.op !== "lit") {
      intension.term = termToString(sym.term);
    }
    if (sym.pred && sym.pred.op !== "true") {
      intension.pred = predToString(sym.pred);
    }
    intension.conf = sym.conf;
    caseResult.intension = intension;
  } catch {
    // ignore
  }
}

/**
 * C3.3：把 generalize 的 fnRels / entryShapes / symbolic 挂到 FunctionAnalysis，
 * 供 dts 泛型投影。无关系时不写 hof（避免空壳噪音）。
 */
export function attachHofSnapshot(analysis: FunctionAnalysis, source: string): void {
  if (analysis.hof) return;
  try {
    const g = generalizeFromAst(analysis.name, source);
    if (!g) return;
    const fnRels = g.fnRels
      ? [...g.fnRels.entries()].map(([param, rec]) => ({ param, abs: rec.abs }))
      : undefined;
    const entryShapes = g.entryShapes
      ? [...g.entryShapes.entries()].map(([param, rec]) => ({ param, abs: rec.abs }))
      : undefined;
    if (!fnRels?.length && !entryShapes?.length) return;
    analysis.hof = {
      ...(fnRels?.length ? { fnRels } : {}),
      ...(entryShapes?.length ? { entryShapes } : {}),
      symbolic: g.symbolic,
    };
  } catch {
    // ignore — dts 回退到 case widen 路径
  }
}

/** 把一次 Abs 求值结果挂到 case 的 intension（无损） */
export function attachAbsToIntension(
  caseResult: CaseResult,
  absVal: Abs,
  label?: string,
): void {
  const prev = caseResult.intension ?? {};
  caseResult.abs = absVal;
  caseResult.intension = {
    ...prev,
    abs: formatAbs(absVal),
    absMultiline: formatAbsMultiline(absVal, label ?? caseResult.name),
    conf: absVal.conf,
  };
}

export function safeAbsOrUnknown(a: unknown): Abs {
  if (a && typeof a === "object" && "shape" in (a as object) && "conf" in (a as object)) {
    return a as Abs;
  }
  // C3.1：调用点实参是宿主 JS 函数（transpile 导出）→ 包成可调用 Abs
  if (typeof a === "function") {
    const fn = a as (...args: Abs[]) => unknown;
    const n = Math.max(0, fn.length);
    const params = Array.from({ length: n }, (_, i) => `arg${i}`);
    return absFunction(params, {
      body: { type: "BlockStatement", body: [], directives: [] } as never,
      apply: (args: Abs[]) => {
        try {
          const r = fn(...args);
          if (r && typeof r === "object" && "shape" in (r as object)) return r as Abs;
          return absUnknown;
        } catch {
          return absUnknown;
        }
      },
    });
  }
  return absUnknown;
}

/**
 * B-path / Abs program 调用记录 → CallRecord（Abs 唯一）。
 * threw 时 result 位为 never、throws 位为抛出值。
 */
export function callRecordFromAbsCall(
  r: {
    fnName: string;
    args: Abs[];
    result: Abs;
    callLoc?: { line: number; column: number };
    threw?: boolean;
  },
  impMap?: Map<string, { modulePath: string; exportName: string }>,
): CallRecord {
  const argAbs = r.args.map(safeAbsOrUnknown);
  const threw = !!r.threw;
  const thrownOrResult = safeAbsOrUnknown(r.result);
  const rec: CallRecord = {
    fnName: r.fnName,
    argAbs,
    resultAbs: threw ? neverAbs : thrownOrResult,
    throwsAbs: threw ? thrownOrResult : neverAbs,
    callLoc: r.callLoc,
  };
  const imp =
    impMap?.get(r.fnName) ??
    // `ns.helper` / `Class.method`：先整名，再按首段点号拆命名空间成员
    (() => {
      const dot = r.fnName.indexOf(".");
      if (dot <= 0) return undefined;
      const base = impMap?.get(r.fnName.slice(0, dot));
      if (!base || base.exportName !== "*") return undefined;
      return {
        modulePath: base.modulePath,
        exportName: r.fnName.slice(dot + 1),
      };
    })();
  if (imp) {
    rec.targetModule = imp.modulePath;
    rec.targetExport = imp.exportName;
  }
  return rec;
}
