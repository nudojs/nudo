/**
 * Abs 重求值 / intension 挂载 / 调用记录转换辅助。
 * 自 analyzer.ts 机械拆出；语义未改。evaluator 仍是唯一引擎（失败 fail-closed）。
 *
 * 不变量 / Invariants:
 * - 调用记录归因（targetModule/targetExport）指向**真正定义该绑定的模块**——
 *   穿透 `export *` / `export { x } from` / `import + export { x }` 再导出链；
 *   解析不出时回落 import 目标（不猜、不静默丢记录）。
 * - `intension.display` 与同一载荷的 `abs`/`resultAbs` **同源**：符号面
 *   （generalize）解析不出被调方（跨模块 import 的绑定）时退成 bare unknown，
 *   此时 display 改由**求值面**结果合成——`unknown` 只在真的推断失败时出现。
 */
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { File, Node } from "@babel/types";
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
  formatShape,
  localNamedExports,
  type Abs,
} from "@nudojs/core";
import { parse } from "@nudojs/parser";
import { sourceHasModuleDependency, sourceHasRequireCall } from "@nudojs/core/internal";
import { resolveModuleFile, statFingerprint } from "./load-module.ts";
import {
  neverAbs,
  type CallRecord,
} from "./evaluator/call-record.ts";
import { tryEvalCallFull } from "./eval-run.ts";
import { mockScopeSelected } from "./mock-abs.ts";
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
 * @nudo:mock 不阻断 Abs：已编译为 seedVars/seedFns 注入 evalAbsModuleGraph。
 * 相对 import 经 Abs 模块图注入后，也不再阻断 Abs 路径。
 * 字符串/注释里的 require/import 文本不算依赖。
 */
export function isSelfContainedSource(source: string, envNames: string[]): boolean {
  if (envNames.length > 0) return false;
  return !sourceHasModuleDependency(source);
}

/** Abs 模块图可处理：env 由 loadEnvs 处理（内置 + 预加载路径型） */
export function absModulesOk(source: string, envNames: string[]): boolean {
  void source;
  void envNames;
  return true;
}




/**
 * import 本地绑定面：本地名 → (模块绝对路径, 导出名)。
 *
 * `exportName === "*"` = **命名空间绑定**（ESM `import * as ns` / CJS
 * `const ns = require(...)`）——成员调用 `ns.helper` 的成员名即模块导出名。
 */
export type AbsImportLocal = {
  /** import 到的模块（绝对路径；裸包说明符原样） */
  modulePath: string;
  /** 导入的导出名（`*` = 命名空间绑定） */
  exportName: string;
  /**
   * 命名空间绑定被**直接**调用时的解析名（CJS `const ms = require("ms");
   * ms(5000)` ⇒ 被调方是 module.exports 本身 ⇒ 归到 default 槽）。ESM
   * 命名空间对象不可调用（运行时 TypeError）⇒ 该形态只对 CJS 成立。
   * 缺省 = 用 `exportName` 本身（ESM 命名空间 ⇒ `"*"`）。
   */
  directExportName?: string;
  /**
   * Bug 286：命名空间绑定的**成员调用点**索引。
   * key = 调用表达式起点 `"行:列"`（Babel 0 基列；与 eval 侧 `callLoc`
   * 同一坐标面）；value = 成员名。用来给调用记录补**接收者限定**
   * （`ns.helper`）——否则记录只带成员名（`helper`），归因侧的点号拆分
   * 永远走不到 ⇒ targetModule/targetExport 空 ⇒ 记录整条被丢弃。
   */
  nsCallSites?: Map<string, string>;
};

/** 入口 import 局部绑定 → 解析后的模块路径 + 导出名 */
export function buildAbsImportLocalMap(
  source: string,
  fromFile: string,
): Map<string, AbsImportLocal> {
  const out = new Map<string, AbsImportLocal>();
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
            // Bug 286：CJS `const ns = require("./m.js")` 是**命名空间绑定**
            // （require 拿到的是 module.exports 对象），不是 default 导入 ⇒
            // exportName 必须是 "*"。此前登记成 "default" ⇒ 归因侧的基名
            // 匹配（exportName === "*"）永远走不到 ⇒ `ns.helper(...)` 的
            // 调用点证据整条丢弃（domain-exceeds 门禁假绿）。
            // directExportName：命名空间被**直接**调用时（`ns(...)`）被调方
            // 是 module.exports 本身 ⇒ 仍归 default 槽（保持既有行为）。
            out.set(d.id.name, {
              modulePath,
              exportName: "*",
              directExportName: "default",
            });
          }
        }
      }
    }
    indexNamespaceCallSites(file, out);
  } catch {
    /* ignore */
  }
  return out;
}

/**
 * Bug 286：命名空间绑定的**成员调用点**索引（`ns.helper(...)` 的位置 → 成员名）。
 *
 * eval 侧只记**成员名**（`helper`），不带接收者 ⇒ 归因侧（点号拆分）拿不到
 * 基名 ⇒ targetModule / targetExport 空 ⇒ 匹配侧整条丢弃 ⇒ error 级
 * `nudo:interface-domain-exceeds` 永不触发（假绿）。这里在**源码面**把
 * 「调用点位置 → 接收者绑定名 + 成员名」钉住，供调用记录补接收者限定。
 *
 * 只认**标识符接收者**（`ns.helper(...)`）：接收者是表达式（`ns.a.b(...)`）
 * 时不猜——留原样（成员名），行为不变。
 */
function indexNamespaceCallSites(file: File, out: Map<string, AbsImportLocal>): void {
  const nsBindings = new Set<string>();
  for (const [local, entry] of out) {
    if (entry.exportName === "*") nsBindings.add(local);
  }
  if (nsBindings.size === 0) return;
  /** 接收者绑定名 → (调用点位置 → 成员名) */
  const byReceiver = new Map<string, Map<string, string>>();
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return;
    const o = n as {
      type?: string;
      callee?: unknown;
      loc?: { start?: { line?: number; column?: number } } | null;
      [k: string]: unknown;
    };
    if (o.type === "CallExpression") {
      const callee = o.callee as
        | {
            type?: string;
            computed?: boolean;
            object?: { type?: string; name?: string };
            property?: { type?: string; name?: string; value?: unknown };
          }
        | undefined;
      if (
        callee?.type === "MemberExpression" &&
        callee.object?.type === "Identifier" &&
        nsBindings.has(callee.object.name ?? "")
      ) {
        const objName = callee.object.name ?? "";
        const member = memberNameOf(callee);
        const start = o.loc?.start;
        if (member !== undefined && start?.line !== undefined && start.column !== undefined) {
          let sites = byReceiver.get(objName);
          if (!sites) {
            sites = new Map<string, string>();
            byReceiver.set(objName, sites);
          }
          sites.set(`${start.line}:${start.column}`, member);
        }
      }
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end" || key === "tokens") continue;
      const v = o[key];
      if (Array.isArray(v)) {
        for (const item of v) visit(item);
      } else if (v && typeof v === "object") {
        visit(v);
      }
    }
  };
  visit(file.program);
  for (const [local, entry] of out) {
    const sites = byReceiver.get(local);
    if (sites && sites.size > 0) entry.nsCallSites = sites;
  }
}

/** 成员表达式的成员名（`ns.helper` / `ns["helper"]`）；动态键 ⇒ undefined */
function memberNameOf(callee: {
  computed?: boolean;
  property?: { type?: string; name?: string; value?: unknown };
}): string | undefined {
  const p = callee.property;
  if (!p) return undefined;
  if (p.type === "Identifier" && callee.computed !== true) return p.name;
  if (p.type === "StringLiteral") return typeof p.value === "string" ? p.value : undefined;
  return undefined;
}

/**
 * Bug 286：给**命名空间成员调用**的记录名补接收者限定（`helper` → `ns.helper`）。
 *
 * 与类成员调用（`Brand.method`）同形：接收者的**本地绑定名** + `.` + 成员名。
 * 依据 = 源码面的成员调用点索引（位置 + 成员名双对得上才补；不猜）。
 * 已带点号的记录（类方法 `Brand.method`）不动。
 */
function qualifyNamespaceMemberName(
  fnName: string,
  callLoc: { line: number; column: number } | undefined,
  impMap: Map<string, AbsImportLocal> | undefined,
): string {
  if (!impMap || !callLoc) return fnName;
  if (fnName.includes(".")) return fnName;
  const key = `${callLoc.line}:${callLoc.column}`;
  for (const [local, entry] of impMap) {
    const member = entry.nsCallSites?.get(key);
    if (member === undefined) continue;
    if (member !== fnName) continue;
    return `${local}.${fnName}`;
  }
  return fnName;
}

export function resolveImportAbs(spec: string, fromFile: string): string | null {
  return resolveModuleFile(spec, fromFile) ?? null;
}

/* ------------------------------------------------------------------ *
 * 再导出链：导出名 → 真正定义该绑定的模块
 *
 * `export * from` / `export { x } from` / `export { x as y } from` /
 * `import { x } …; export { x }` 都会让「调用方 import 的模块」≠
 * 「定义该函数的模块」。归因只认 import 目标时，中间 barrel 会把跨文件
 * 调用点证据整条吞掉（domain-exceeds 门禁假绿）。这里把导出名沿再导出
 * 链解引用到定义位点。
 * ------------------------------------------------------------------ */

/** 再导出链最大跳数（环保护） */
const MAX_REEXPORT_HOPS = 8;

/** 模块导出索引上限（超出即整体清空——重建成本 = 一次 parse） */
const MODULE_INDEX_MAX = 512;

/** 导出名 → 定义位点 */
export type ExportSite = {
  /** 真正定义该绑定的模块（绝对路径） */
  modulePath: string;
  /** 定义位点上的导出名（改名再导出时与 import 侧的名字不同） */
  exportName: string;
};

/** 单模块的导出索引（一次解析，多名复用） */
type ModuleExportIndex = {
  mtimeMs: number;
  size: number;
  /** 本模块直接定义并导出的名字（localNamedExports 口径：含 CJS 形态） */
  local: Set<string>;
  /** `export { local as exported } from "spec"` → 目标说明符 + 本地名 */
  reExport: Map<string, { spec: string; local: string }>;
  /** `export { local as exported }`（无 source）→ 本地名 */
  exportList: Map<string, string>;
  /** `export * from "spec"` 的说明符 */
  starSpecs: string[];
  /** 本地 import 绑定 → { spec, exportName } */
  imports: Map<string, { spec: string; exportName: string }>;
  /** 解析结果缓存（导出名 → 定义位点；undefined = 解析不出） */
  sites: Map<string, ExportSite | undefined>;
};

/** 模块导出索引缓存（按 mtime+size 失效——同 size 同 mtime 的编辑是既有残余） */
const moduleIndexCache = new Map<string, ModuleExportIndex>();

function buildModuleExportIndex(
  source: string,
  mtimeMs: number,
  size: number,
): ModuleExportIndex {
  const idx: ModuleExportIndex = {
    mtimeMs,
    size,
    local: localNamedExports(source),
    reExport: new Map(),
    exportList: new Map(),
    starSpecs: [],
    imports: new Map(),
    sites: new Map(),
  };
  try {
    const file = parse(source);
    for (const stmt of file.program.body) {
      if (stmt.type === "ImportDeclaration") {
        const spec = stmt.source.value;
        for (const s of stmt.specifiers) {
          if (s.type === "ImportSpecifier") {
            const imported =
              s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
            idx.imports.set(s.local.name, { spec, exportName: imported });
          } else if (s.type === "ImportDefaultSpecifier") {
            idx.imports.set(s.local.name, { spec, exportName: "default" });
          }
          // 命名空间导入（* as ns）：成员名不在 import 面上，不进索引
        }
        continue;
      }
      if (stmt.type === "ExportNamedDeclaration") {
        const src = stmt.source?.value;
        for (const s of stmt.specifiers) {
          if (s.type !== "ExportSpecifier") continue;
          const exported =
            s.exported.type === "Identifier" ? s.exported.name : String(s.exported);
          const local = s.local.type === "Identifier" ? s.local.name : String(s.local);
          if (src) idx.reExport.set(exported, { spec: src, local });
          else idx.exportList.set(exported, local);
        }
        continue;
      }
      if (stmt.type === "ExportAllDeclaration") {
        const src = stmt.source?.value;
        if (src) idx.starSpecs.push(src);
        continue;
      }
    }
  } catch {
    /* 解析失败：索引只剩 local（localNamedExports 已容错） */
  }
  return idx;
}

/** 模块导出索引（读盘 + 解析；mtime+size 命中即复用） */
function moduleExportIndex(modulePath: string): ModuleExportIndex | undefined {
  let st: { mtimeMs: number; size: number } | undefined;
  try {
    st = statFingerprint(modulePath);
  } catch {
    return undefined;
  }
  if (st === undefined) return undefined;
  const cached = moduleIndexCache.get(modulePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached;
  let source: string;
  try {
    source = readFileSync(modulePath, "utf-8");
  } catch {
    return undefined;
  }
  const idx = buildModuleExportIndex(source, st.mtimeMs, st.size);
  if (moduleIndexCache.size >= MODULE_INDEX_MAX) moduleIndexCache.clear();
  moduleIndexCache.set(modulePath, idx);
  return idx;
}

/** 相对说明符 → 绝对路径（读盘失败不抛——归因是尽力面，不阻断分析） */
function safeResolveImport(spec: string, fromFile: string): string | undefined {
  try {
    return resolveImportAbs(spec, fromFile) ?? undefined;
  } catch {
    return undefined;
  }
}

function resolveExportSiteAt(
  idx: ModuleExportIndex,
  modulePath: string,
  exportName: string,
  hop: number,
  seen: Set<string>,
): ExportSite | undefined {
  if (hop > MAX_REEXPORT_HOPS) return undefined;
  const key = `${modulePath}\0${exportName}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  // 1. 本地定义优先（ESM：显式导出盖过 `export *`）
  if (idx.local.has(exportName)) return { modulePath, exportName };
  // 2. `export { x as y } from "m"`：跟到 m 的 x
  const re = idx.reExport.get(exportName);
  if (re) {
    const target = safeResolveImport(re.spec, modulePath);
    if (!target) return undefined;
    const sub = moduleExportIndex(target);
    if (!sub) return { modulePath: target, exportName: re.local };
    return (
      resolveExportSiteAt(sub, target, re.local, hop + 1, seen) ?? {
        modulePath: target,
        exportName: re.local,
      }
    );
  }
  // 3. `export { x }`（x 来自 import）→ 跟到 import 的源头
  const local = idx.exportList.get(exportName);
  if (local !== undefined) {
    const imp = idx.imports.get(local);
    if (!imp) return { modulePath, exportName };
    const target = safeResolveImport(imp.spec, modulePath);
    if (!target) return undefined;
    const sub = moduleExportIndex(target);
    if (!sub) return { modulePath: target, exportName: imp.exportName };
    return (
      resolveExportSiteAt(sub, target, imp.exportName, hop + 1, seen) ?? {
        modulePath: target,
        exportName: imp.exportName,
      }
    );
  }
  // 4. `export * from "m"`：m 定义了该名才认。同名来自**不同模块** ⇒ 歧义
  //    （ESM 规范：该名不可用）⇒ 解析不出（Bug 269，与 abs-modules 的合并
  //    口径一致——两条路径都不得给歧义名一个确定定义位点）。
  const starHits: ExportSite[] = [];
  for (const spec of idx.starSpecs) {
    const target = safeResolveImport(spec, modulePath);
    if (!target) continue;
    const sub = moduleExportIndex(target);
    if (!sub) continue;
    const r = resolveExportSiteAt(sub, target, exportName, hop + 1, new Set(seen));
    if (!r) continue;
    if (starHits.some((h) => h.modulePath === r.modulePath && h.exportName === r.exportName)) {
      continue;
    }
    starHits.push(r);
  }
  return starHits.length === 1 ? starHits[0] : undefined;
}

/**
 * 导出名 → 真正定义该绑定的模块（穿透再导出链）。
 * 解析不出（非文件路径 / 读不到 / 链上没定义）→ undefined（调用方回落
 * import 目标，不猜）。
 */
export function resolveExportSite(
  modulePath: string,
  exportName: string,
): ExportSite | undefined {
  // 裸包说明符不是文件路径——harvest 面另说，这里不猜
  if (!isAbsolute(modulePath)) return undefined;
  const idx = moduleExportIndex(modulePath);
  if (!idx) return undefined;
  if (idx.sites.has(exportName)) return idx.sites.get(exportName);
  const site = resolveExportSiteAt(idx, modulePath, exportName, 0, new Set());
  idx.sites.set(exportName, site);
  return site;
}

/** Abs 原生重求值（无损）；evaluator 唯一引擎，失败返回 undefined（fail-closed） */
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
 * Abs 原生重求值 + throws（T19）：evaluator 带 throws；失败返回 undefined。
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
  // 真实 require 源码不走 Abs（字符串/注释里的 require( 文本不是依赖）
  if (sourceHasRequireCall(source)) return undefined;
  // fail-closed：B-only（ast-eval analyzeFnFull 兜底已删——无 throwLoc 补充、
  // 无 Abs 重求值；B 失败 → undefined）
  try {
    if (filePath) {
      // mock 表按**被求值的函数作用域**选（Bug 455）：同名 `@nudo:mock`
      // 各归各函数（assignedName 是另一个被调名 ⇒ 按它自己选）。
      const viaB =
        tryEvalCallFull(source, filePath, fnName, args, {
          mocks: mocks ? mockScopeSelected(mocks, fnName) : undefined,
        }) ??
        (assignedName
          ? tryEvalCallFull(source, filePath, assignedName, args, {
              mocks: mocks ? mockScopeSelected(mocks, assignedName) : undefined,
            })
          : undefined);
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
 * entry@ 的 Abs 原生路径：自包含源码走 evaluator（类型即计算）。
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
 * 符号面退化（bare unknown）时的 display 骨架：等求值面结果到达后合成
 * display（与 abs 同源）。key = CaseResult（case 生命周期内唯一）。
 */
const pendingDisplay = new WeakMap<CaseResult, { head: string }>();

/** bare unknown = 推断失败（CLAUDE.md：unknown 只在真失败时出现） */
function isBareUnknown(a: Abs): boolean {
  return a.shape.k === "unknown" && !a.term;
}

/**
 * display 的参数段（`name: (ps)`）——按括号配对切，函数型形参里的括号
 * 不误切。切不出时退回 `name: ()`。
 */
function displayParamHead(display: string, fnName: string): string {
  const open = display.indexOf("(");
  if (open < 0) return `${fnName}: ()`;
  let depth = 0;
  for (let i = open; i < display.length; i++) {
    const ch = display[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return display.slice(0, i + 1);
    }
  }
  return `${fnName}: ()`;
}

/**
 * entry@ 附加内涵摘要（代数 generalize + 无损 Abs）。
 * 失败静默——不改变外延 TypeValue。
 *
 * display 与 abs **同源**：符号面（generalize）解析不出被调方时（被调方
 * 是跨模块 import 进来的绑定）符号结果退成 bare unknown，display 会写成
 * `() => unknown`——与同一载荷的求值面（resultAbs / abs 有确切值）自相
 * 矛盾，且与 `nudo check` 的签名相反。此时**不写** display，改由求值面
 * 结果在 attachAbsToIntension 里合成（unknown 只在真失败时出现）。
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
      abs: formatAbs(sym),
      absMultiline: formatAbsMultiline(sym, fnName),
    };
    if (isBareUnknown(sym)) {
      // 符号面没解析出被调方 → display 等求值面合成（骨架先记下）
      pendingDisplay.set(caseResult, { head: displayParamHead(g.display, fnName) });
    } else {
      intension.display = g.display;
    }
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
  const next: NonNullable<CaseResult["intension"]> = {
    ...prev,
    abs: formatAbs(absVal),
    absMultiline: formatAbsMultiline(absVal, label ?? caseResult.name),
    conf: absVal.conf,
  };
  // 符号面退化时 display 缺席——用**求值面**结果补上（与 abs 同源）：
  // `unknown` 只在真的推断失败时出现。
  const pending = pendingDisplay.get(caseResult);
  if (pending && next.display === undefined) {
    next.display = `${pending.head} => ${formatShape(absVal)}`;
  }
  caseResult.intension = next;
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
    // 严格性不可得：本入口只拿得到宿主函数值（body 是**合成空块**，派发由
    // apply 接管），调用方未透传分析源种类 ⇒ 不写 strict（sloppy，保守）。
    // 真实模块函数声明走 abs-modules-graph 的导出桥（按模块 AST 判定）。
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
 * evaluator / Abs program 调用记录 → CallRecord（Abs 唯一）。
 * threw 时 result 位为 never、throws 位为抛出值。
 */
export function callRecordFromAbsCall(
  r: {
    fnName: string;
    args: Abs[];
    result: Abs;
    callLoc?: { line: number; column: number };
    /** BUG-028：省略 = producer 缺陷——fail-closed
     * （throwsAbs=unknown，不当干净成功；类型级
     * 执法见 EvalCallRecord.threw 必填） */
    threw?: boolean;
  },
  impMap?: Map<string, AbsImportLocal>,
): CallRecord {
  const argAbs = r.args.map(safeAbsOrUnknown);
  const threw = r.threw === true;
  // threw 省略：无法区分成功 / 异常——throws 域
  // 升 unknown（may-throw anything），不把 payload
  // 当干净成功结果（isLeakedCallRecord 只查
  // never+never，拦不住「payload 作 result +
  // never 作 throws」的组合）
  const threwUnknown = r.threw === undefined;
  const thrownOrResult = safeAbsOrUnknown(r.result);
  // Bug 286：命名空间成员调用（`ns.helper(...)`）的 eval 记录只带**成员名**
  // （`helper`）⇒ 归因侧点号拆分永远走不到 ⇒ targetModule/targetExport 空 ⇒
  // 匹配侧整条丢弃 ⇒ error 级 nudo:interface-domain-exceeds 永不触发（假绿）。
  // 这里补**接收者限定**（`ns.helper`，与类成员调用 `Brand.method` 同形）。
  const fnName = qualifyNamespaceMemberName(r.fnName, r.callLoc, impMap);
  const rec: CallRecord = {
    fnName,
    argAbs,
    resultAbs: threw ? neverAbs : thrownOrResult,
    throwsAbs: threw
      ? thrownOrResult
      : threwUnknown
        ? absUnknown
        : neverAbs,
    callLoc: r.callLoc,
  };
  const imp = resolveCalleeImport(fnName, impMap);
  if (imp) {
    // 归因到**真正定义该绑定的模块**（穿透再导出链）——中间 barrel 不是
    // 定义文件，认它会让跨文件调用点证据永远配不上被检查文件。
    const site = resolveExportSite(imp.modulePath, imp.resolveName);
    rec.targetModule = site?.modulePath ?? imp.modulePath;
    rec.targetExport = imp.recordName ?? site?.exportName ?? imp.resolveName;
  }
  return rec;
}

/** 被调名的 import 归因（解析用名 + 记录用名） */
type CalleeImport = {
  /** import 到的模块（绝对路径；裸包说明符原样） */
  modulePath: string;
  /** 解析定义位点用的导出名 */
  resolveName: string;
  /** 记录用导出名（具名类方法用完整点号名；其余用解析结果） */
  recordName?: string;
};

/** import 面上按**导出名**反查（`import { C as S }`：本地名 ≠ 导出名） */
function findImportByExportName(
  impMap: Map<string, AbsImportLocal>,
  exportName: string,
): AbsImportLocal | undefined {
  for (const v of impMap.values()) {
    if (v.exportName === exportName) return v;
  }
  return undefined;
}

/**
 * 被调名 → import 归因。
 * - 整名命中（`area`）：直接取该本地绑定的 import。
 * - 点号名（`ns.helper` / `Class.method`）：按**最后一个点**拆基名 / 成员名。
 *   · 基名是**命名空间导入**（exportName === "*"）→ 成员名即模块导出名。
 *   · 基名是**具名导入**（`import { C }` / `import { C as S }`）→ 被调方是
 *     该类的方法：定义位点 = 类所在模块，记录名 = 完整点号名（`C.run`）。
 *     此前只认命名空间导入，具名类导入在此被整条丢弃（调用点证据消失）。
 */
function resolveCalleeImport(
  fnName: string,
  impMap?: Map<string, AbsImportLocal>,
): CalleeImport | undefined {
  if (!impMap) return undefined;
  const direct = impMap.get(fnName);
  if (direct) {
    return {
      modulePath: direct.modulePath,
      // 命名空间绑定被**直接**调用（CJS `const ms = require("ms"); ms(5000)`）：
      // 被调方是 module.exports 本身 ⇒ 归到 default 槽（directExportName）。
      resolveName: direct.directExportName ?? direct.exportName,
    };
  }
  // 最后一个点：接收者绑定名（本地标识符，无点）+ 成员名（导出名，无点）
  const dot = fnName.lastIndexOf(".");
  if (dot <= 0) return undefined;
  const baseName = fnName.slice(0, dot);
  const member = fnName.slice(dot + 1);
  // 基名 = 本地绑定名；`import { C as S }` 时基名是类名 → 按导出名反查
  const base = impMap.get(baseName) ?? findImportByExportName(impMap, baseName);
  if (!base) return undefined;
  if (base.exportName === "*") {
    // 命名空间导入：成员名即模块导出名
    return { modulePath: base.modulePath, resolveName: member };
  }
  // 具名导入（类）：被调方是该类的方法——定义位点跟到类所在模块
  return {
    modulePath: base.modulePath,
    resolveName: base.exportName,
    recordName: fnName,
  };
}
