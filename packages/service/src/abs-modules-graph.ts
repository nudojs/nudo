/**
 * Host：import 图（相对 + 裸包 harvest）→ Abs 导出表 → 注入入口。
 * 读 fs / 解析路径 / harvest 在这里；core 只收 modules 表。
 */

import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { parse } from "@nudojs/parser";
import {
  absFunction,
  bindingsOf,
  tryRunTranspiled,
  callTranspiledExportApply,
  foldStaticStringExpr,
  hostFnCtorFacet,
  namespaceAbsOf,
  undefAbs,
  unknown,
  abs,
  type Abs,
  type AbsModuleExports,
} from "@nudojs/core";
import type { Node } from "@babel/types";
import { bareSpecToAbsModules } from "@nudojs/harvester";
import { hashSource, stablePathKey } from "@nudojs/core/internal";
import { resolveNpmJsEntryDetailed } from "./evaluator/resolve-npm.ts";
import { moduleResolveCandidates } from "./load-module.ts";
import { BoundedLruMap } from "./lru-map.ts";

/** seedFns → Abs fn（本地副本，避免 mock-abs ↔ 本模块循环依赖） */
function seedFnsToMocks(
  seedVars: Record<string, Abs>,
  seedFns: Record<string, { params: string[]; body: unknown; async?: boolean }>,
): Record<string, Abs> {
  const out: Record<string, Abs> = { ...seedVars };
  for (const [name, fn] of Object.entries(seedFns)) {
    out[name] = absFunction(fn.params, {
      body: fn.body as never,
      async: fn.async ?? false,
    });
  }
  return out;
}

export type AbsLoadModule = (spec: string, fromFile: string) => string | undefined;

/** 相对/绝对说明符 → 首个可读候选（路径 + 内容一次读出）；无命中 undefined */
function readFirstRel(
  spec: string,
  fromFile: string,
): { path: string; content: string } | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    for (const cand of moduleResolveCandidates(spec, fromFile)) {
      try {
        return { path: cand, content: readFileSync(cand, "utf-8") };
      } catch {
        /* next */
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** 相对说明符 → 源码（与 defaultLoadModule 同一扩展名/入口候选表） */
export function defaultAbsLoadModule(spec: string, fromFile: string): string | undefined {
  return readFirstRel(spec, fromFile)?.content;
}

function resolveRel(spec: string, fromFile: string): string | null {
  return readFirstRel(spec, fromFile)?.path ?? null;
}

function importSpecs(source: string): string[] {
  try {
    const file = parse(source);
    const out: string[] = [];
    for (const stmt of file.program.body) {
      if (
        stmt.type === "ImportDeclaration" ||
        stmt.type === "ExportNamedDeclaration" ||
        stmt.type === "ExportAllDeclaration"
      ) {
        const src = (stmt as { source?: { value: string } }).source;
        if (src && typeof src.value === "string") {
          out.push(src.value);
        }
      }
      // require("...") / require('...')
      collectRequireSpecs(stmt as never, out);
    }
    return out;
  } catch {
    return [];
  }
}

function collectRequireSpecs(node: unknown, out: string[]): void {
  const visit = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const o = n as {
      type?: string;
      callee?: {
        type?: string;
        name?: string;
        computed?: boolean;
        object?: { type?: string; name?: string };
        property?: { type?: string; name?: string };
      };
      arguments?: Array<unknown>;
      [k: string]: unknown;
    };
    if (o.type === "CallExpression" && o.callee) {
      // require(spec) / require.resolve(spec)：可折叠说明符才进依赖图
      const c = o.callee;
      let spec: string | undefined;
      if (c.type === "Identifier" && c.name === "require") {
        spec = foldStaticStringExpr(o.arguments?.[0]);
      } else if (
        c.type === "MemberExpression" &&
        !c.computed &&
        c.object?.type === "Identifier" &&
        c.object.name === "require" &&
        c.property?.type === "Identifier" &&
        c.property.name === "resolve"
      ) {
        spec = foldStaticStringExpr(o.arguments?.[0]);
      }
      if (spec !== undefined) out.push(spec);
    }
    for (const key of Object.keys(o)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const v = o[key];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === "object") visit(v);
    }
  };
  visit(node);
}

/** 把当前文件的全部 import（相对 + 裸包）编成 modules 表。
 * localDepsOut（可选）：收集本文件 evalDep 过的解析路径（stablePathKey 形态，
 * 相对依赖 + 裸包入口 JS）——供调用方组合子树内容指纹（DESIGN-002）。 */
function buildModulesForFile(
  source: string,
  fromFile: string,
  load: AbsLoadModule,
  evalDep: (absPath: string, spec: string, fromFile: string, depth: number) => AbsModuleExports,
  depth: number,
  maxDepth: number,
  onIssue: (kind: AbsModuleLoadIssue["kind"], label: string, reason: string) => void,
  localDepsOut?: string[],
): Record<string, AbsModuleExports> {
  const modules: Record<string, AbsModuleExports> = {};
  for (const spec of importSpecs(source)) {
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const childPath = resolveRel(spec, fromFile);
      if (!childPath) {
        onIssue("missing", spec, `Module file not found for '${spec}' (from ${moduleLabel(fromFile)}); tried: ${moduleResolveCandidates(spec, fromFile).join(", ")}`);
        continue;
      }
      modules[spec] = evalDep(childPath, spec, fromFile, depth + 1);
      localDepsOut?.push(stablePathKey(childPath));
    } else if (!spec.startsWith("node:")) {
      // A3：优先执行包入口 JS（ms/debug 等纯 JS 包返回面可折叠）；
      // 无入口或求值失败再 harvest stub。
      const resolved = resolveNpmJsEntryDetailed(spec, dirname(fromFile));
      if (resolved.exportsUnresolved) {
        onIssue(
          "exports-unresolved",
          spec,
          `package.json exports declared but '${spec}' did not resolve (from ${moduleLabel(fromFile)}); falling back to harvest`,
        );
      }
      if (resolved.path) {
        const executed = evalDep(resolved.path, spec, fromFile, depth + 1);
        localDepsOut?.push(stablePathKey(resolved.path));
        if (executed && (executed.default !== undefined || Object.keys(executed.named ?? {}).length > 0)) {
          modules[spec] = executed;
          continue;
        }
      }
      const bare = bareSpecToAbsModules(spec, fromFile);
      if (bare) modules[spec] = bare;
      // 裸包 harvest 失败 ≠ 文件缺失（可能是未覆盖的包形态），不报 missing
    }
  }
  void maxDepth;
  return modules;
}

/** 模块加载守卫：与 TypeValue loadModuleEnv 口径对齐，供 analyzer 映射诊断 */
export type AbsModuleLoadIssue = {
  kind: "cycle" | "depth" | "missing" | "missing-export" | "exports-unresolved";
  /** 诊断定位用标签（文件 basename 或 require/import 说明符） */
  label: string;
  reason: string;
};

export type AbsModuleGraphResult = {
  /** 入口 import 说明符 → 依赖导出表 */
  modules: Record<string, AbsModuleExports>;
  /** 绝对路径 → 导出表（含依赖；循环占位求值后就地回填） */
  byPath: Map<string, AbsModuleExports>;
  /** cycle / depth / missing（求值引擎权威，避免 TypeValue 叠报） */
  issues: AbsModuleLoadIssue[];
};

export type AbsGraphOptions = {
  loadModule?: AbsLoadModule;
  seedVars?: Record<string, Abs>;
  seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  maxDepth?: number;
};

/** 单条本地依赖的内容指纹：解析后稳定路径 + 求值时源码的 hashSource
 * （与 loadModuleDepsFingerprint 同一 hash 口径，DESIGN-002 不另起第二套）。
 * via = 装载询问证据（求值装载该依赖所用 spec/fromFile 对，无条件记录——
 * 该对恒已知，且 fresh 求值同一口径下 loader（若有）会被问同一对）：子树
 * 复核在当前调用带 custom loader 时按它重问 loader——loader 覆写内容
 * （LSP 未保存 buffer）对磁盘 stat 不可见，只按磁盘比对既会陈旧（buffer
 * A→B 磁盘未动 / loader 新近接管）也会永久 miss（虚拟内容 ≠ 磁盘但稳定）。
 * 条目不存 loader 引用：当前世界由当前调用的 loader 定义。缺省 = 防御性
 * 兼容（磁盘复核，不问 loader）。 */
export type AbsModuleDepFingerprint = {
  path: string;
  hash: string;
  via?: { spec: string; fromFile: string };
};

/** 会话级依赖模块缓存条目：自身 stat 指纹 + 子树内容指纹 + 导出 + 子树装载 issue。 */
export type AbsModuleCacheEntry = {
  mtimeMs: number;
  size: number;
  /**
   * 插入时实际求值源码（loadModule 返回或磁盘回读）的内容 hash。
   * custom loader 接管本路径时，条目自身的命中校验即按此 hash（loader 当前
   * 内容复核——stat 对 loader 覆写内容磁盘盲）；loader 不接手 / 默认 loader
   * 仍按 stat。此值亦供父模块组合子树指纹复用——父模块插入时对已命中的
   * 子依赖不再做第二次磁盘读。
   */
  contentHash: string;
  /**
   * 传递本地依赖闭包（自身除外）的 path → 内容 hash + 装载询问证据
   * （DESIGN-002，loader 感知复核见 depFingerprintCurrent）。命中时逐项
   * 取「当前装载内容」比对 hash：任一翻转或取失败 → miss 重求值——任何
   * 下游文件内容变更（含 stat 不可见的同 size 编辑 / loader 覆写）都会
   * 翻转中间模块条目。子树不可追踪（环进行中 / depth 截断 / 依赖缺失）
   * 的模块不进会话缓存（fail-closed）。
   */
  depFingerprints: AbsModuleDepFingerprint[];
  exports: AbsModuleExports;
  /** 该模块子树首次求值时记录的 cycle/depth/missing；命中时重放。 */
  issues: AbsModuleLoadIssue[];
};

/**
 * 跨入口复用的依赖模块缓存（LSP 脏传播重验 N 个入口、共享同一依赖树时，
 * 避免每个入口重复 parse + 抽象求值全部依赖）。键为解析后的绝对路径，
 * 命中条件 = 自身指纹 **且** 子树内容指纹逐项复核通过（DESIGN-002）：自身
 * 指纹默认按 stat（mtimeMs+size）严格相等；custom loader（opts.loadModule）
 * 接管本路径时改按「loader 当前内容 hash == contentHash」——loader 覆写
 * 内容（LSP 未保存 buffer）磁盘 stat 不可见，stat 命中会陈旧返回旧导出；
 * loader 不接手（undefined / 抛错）回落 stat。子树指纹同口径 loader 感知：
 * 依赖条目带装载询问证据（via.spec/fromFile）时按原询问对重问当前 loader
 * 比对，loader 不接手回落磁盘（depFingerprintCurrent）——loader 覆写传递
 * 依赖且磁盘未动不再陈旧，虚拟内容稳定也不再永久 miss。custom loader 命中
 * 因此每依赖多一次 loader 取内容（内存串，成本低；宁冷勿陈旧）。传递依赖
 * 内容变更由指纹自然失效，宿主无需逐出中间模块；
 * 条目自身的「同 size + 同 mtime」编辑仍是残余缺口（见设计文档 §3.1），
 * 删除经 evictAbsModuleCacheFiles / clearAbsModuleCache 逐出
 * （删除即使不逐出也自愈：stat / 指纹读抛错走 miss）。
 *
 * 命中时重放子树首次求值的 cycle/depth/missing issue，保持「每个入口文件
 * 都报告其依赖树装载问题」的诊断口径；method-missing / recursion-truncated
 * 等执行期诊断不随缓存重放——它们属于触发执行的调用方文件，且依赖文件
 * 自身被验证时会独立产出。
 *
 * 上限 ABS_MODULE_CACHE_MAX（512 个依赖模块条目）+ LRU：命中/写入移到队尾，
 * 超限删最旧。条目含 AbsModuleExports（导出表）+ 子树 issue 切片，是依赖树
 * 层主要驻留；大仓分析后 retained 内存由此钉在上界内。evict/clear 语义不变。
 */
const ABS_MODULE_CACHE_MAX = 512;
const absModuleCache = new BoundedLruMap<AbsModuleCacheEntry>(ABS_MODULE_CACHE_MAX);

/** 测试/诊断：当前条目数（≤ ABS_MODULE_CACHE_MAX） */
export function getAbsModuleCacheSize(): number {
  return absModuleCache.size;
}

export function clearAbsModuleCache(): void {
  absModuleCache.clear();
}

/** 键身份统一 stablePathKey（FIX-RESIDUAL-4）：跨盘符形态删除/命中一致 */
export function evictAbsModuleCacheFiles(paths: string[]): void {
  for (const p of paths) absModuleCache.delete(stablePathKey(p));
}

/**
 * 子树内容指纹复核（DESIGN-002，loader 感知）：对条目记录的每个传递依赖取
 * 「当前装载内容」并 hashSource 比对——当前装载内容按求值同一口径取：当前
 * 调用带 custom loader 且条目带装载询问证据（via.spec/fromFile）→ 先按原
 * 询问对重问 loader（loader 覆写内容对磁盘 stat 不可见：磁盘比对既会陈旧
 * ——buffer A→B 磁盘未动，也会永久 miss——虚拟内容 ≠ 磁盘但稳定）；loader
 * 不接手（undefined）→ 该依赖此刻本就从磁盘装载，回落磁盘读取。无 custom
 * loader（默认路径）纯磁盘读取——与历史行为逐字节一致，stat 快路径语义
 * 不动。成本与已追踪的依赖闭包成正比——每文件一次取内容+hash（loader 为
 * 内存串），无重解析 / 无重求值 / 无图遍历。读失败（依赖被删）/ loader 抛错
 * / hash 翻转 → false（miss 重求值：删除场景重求值会重新报 missing，而不是
 * 重放旧 issue；宁冷勿陈旧）。
 */
function depFingerprintCurrent(
  deps: AbsModuleDepFingerprint[],
  customLoad: AbsLoadModule | undefined,
): boolean {
  for (const d of deps) {
    let src: string | undefined;
    try {
      src =
        customLoad && d.via
          ? (customLoad(d.via.spec, d.via.fromFile) ?? readFileSync(d.path, "utf-8"))
          : readFileSync(d.path, "utf-8");
    } catch {
      return false;
    }
    if (src === undefined || hashSource(src) !== d.hash) return false;
  }
  return true;
}

function moduleLabel(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
}

/** null 值的 Abs 表示（export default null 等；与 undefAbs 同口径） */
function nullAbs(): Abs {
  return abs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
}

type ParamNodeLike = {
  type?: string;
  name?: string;
  argument?: { type?: string; name?: string };
};

function paramNameOf(p: ParamNodeLike, i: number): string {
  if (p.type === "Identifier" && p.name) return p.name;
  if (p.type === "RestElement" && p.argument?.type === "Identifier" && p.argument.name) {
    return `...${p.argument.name}`;
  }
  return `arg${i}`;
}

/**
 * 顶层函数声明/导出的形参表（evaluator JS 函数 → Abs fn 桥接用）：
 * key 为「导出名」——named 用声明名、default 用 "default"。
 */
function topLevelFnParams(file: Node): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const body = ((file as { program?: { body?: unknown[] } }).program?.body ?? []) as Array<{
    type?: string;
    id?: { name: string } | null;
    params?: ParamNodeLike[];
    declaration?: { type?: string; id?: { name: string } | null; params?: ParamNodeLike[] } | null;
  }>;
  for (const stmt of body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id && stmt.params) {
      out.set(stmt.id.name, stmt.params.map(paramNameOf));
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration as
        | { type?: string; id?: { name: string } | null; params?: ParamNodeLike[] }
        | null;
      if (d && (d.type === "FunctionDeclaration" || d.type === "ArrowFunctionExpression") && d.params) {
        out.set("default", d.params.map(paramNameOf));
      }
    }
  }
  return out;
}

/**
 * evaluator 执行产出的导出表 → AbsModuleExports。
 * run 表的键 = 导出名（P1-a：specifier/re-export/star/default 全量收进
 * __nudoExport 动态表）；JS 函数经 absFunction(apply) 桥接成 Abs fn——
 * apply 优先于 body 派发（callFunctionUnchecked 第三路径），跨边界调用
 * 由 callTranspiledExportFull 回进 evaluator 函数执行。
 */
export function evalExportsToModuleExports(
  run: Record<string, unknown>,
  file: Node,
  fingerprintPrefix: string,
): AbsModuleExports {
  const named: Record<string, Abs> = {};
  let def: Abs | undefined;
  const paramTable = topLevelFnParams(file);
  for (const [k, v] of Object.entries(run)) {
    let absVal: Abs;
    if (v === undefined || v === null) {
      // 「名存在但值 undefined/null」≠「从未导出」：保留槽位
      absVal = v === null ? nullAbs() : undefAbs();
    } else if (isAbsVal(v)) {
      absVal = v;
    } else if (typeof v === "function") {
      const params =
        paramTable.get(k) ??
        Array.from({ length: (v as { length?: number }).length ?? 0 }, (_, i) => `arg${i}`);
      // Bug 9：求值模块的宿主函数导出（函数声明产物）——generator/async 不可
      // new，普通声明可 new。可构造性 facet 进 shape（$new 校验）。
      const ctorFacet = hostFnCtorFacet(v as Function);
      absVal = absFunction(params, {
        // H1：throws 面经 apply 返回值通道保留（callTranspiledExportApply），
        // $call 统一路由——桥内不得再手拆 .result / 自行 re-throw（BUG-006 根治）。
        apply: callTranspiledExportApply(run, k),
        kind: "eval-export",
        // 无 body 的桥接 fn 预算键 = fingerprint ?? anon#N——缺省会让所有
        // 桥接导出共享 anon#1，嵌套跨模块调用（a 调 b 调 a'）撞
        // _activeCallKeys 递归守卫被误截断为 opaque。按 模块#导出 唯一化。
        fingerprint: `${fingerprintPrefix}#${k}`,
      }, ctorFacet !== undefined ? { ctor: ctorFacet } : undefined);
    } else {
      absVal = unknown;
    }
    if (k === "default") def = absVal;
    else named[k] = absVal;
  }
  const out: AbsModuleExports = { named, evaluated: true };
  if (def !== undefined) out.default = def;
  return out;
}

/**
 * named import / re-export 缺名 → missing-export issue。
 * zero-FP：仅当源模块导出表来自成功求值（`evaluated`）才报——fail-closed 空表 /
 * harvest stub / 缺模块不报，避免与 module-missing 叠报。
 */
export function collectMissingExportIssues(
  source: string,
  modules: Record<string, AbsModuleExports>,
  fromFile: string,
): AbsModuleLoadIssue[] {
  const issues: AbsModuleLoadIssue[] = [];
  let file: Node;
  try {
    file = parse(source);
  } catch {
    return issues;
  }
  const from = moduleLabel(fromFile);
  const push = (spec: string, name: string, kind: "import" | "re-export") => {
    issues.push({
      kind: "missing-export",
      label: `${spec}#${name}`,
      reason:
        kind === "import"
          ? `Module '${spec}' has no export '${name}' (from ${from})`
          : `Module '${spec}' has no export '${name}' to re-export (from ${from})`,
    });
  };
  const checkName = (spec: string, name: string, kind: "import" | "re-export") => {
    const mod = modules[spec];
    // 仅成功求值的导出表才可作缺名判定（zero-FP）
    if (!mod?.evaluated) return;
    // own-property：`in` 走原型链，toString 等继承名会漏报缺名
    const has = name === "default" ? mod.default !== undefined : Object.hasOwn(mod.named, name);
    if (!has) push(spec, name, kind);
  };

  const body = ((file as { program?: { body?: unknown[] } }).program?.body ?? []) as Array<{
    type?: string;
    source?: { value?: unknown };
    specifiers?: Array<{
      type?: string;
      local?: { name?: string; type?: string; value?: string } | null;
      imported?: { type?: string; name?: string; value?: string } | null;
      exported?: { type?: string; name?: string; value?: string } | null;
    }>;
  }>;
  for (const stmt of body) {
    if (stmt.type === "ImportDeclaration" && typeof stmt.source?.value === "string") {
      const spec = stmt.source.value;
      for (const sp of stmt.specifiers ?? []) {
        if (sp.type === "ImportDefaultSpecifier") {
          checkName(spec, "default", "import");
        } else if (sp.type === "ImportSpecifier") {
          const imported =
            sp.imported?.type === "StringLiteral" ? sp.imported.value : sp.imported?.name;
          if (imported !== undefined) checkName(spec, imported, "import");
        }
      }
    } else if (
      stmt.type === "ExportNamedDeclaration" &&
      typeof stmt.source?.value === "string"
    ) {
      const spec = stmt.source.value;
      for (const sp of stmt.specifiers ?? []) {
        if (sp.type !== "ExportSpecifier") continue;
        const local = sp.local?.type === "StringLiteral" ? sp.local.value : sp.local?.name;
        if (local !== undefined) checkName(spec, local, "re-export");
      }
    }
  }
  return issues;
}

/**
 * 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。
 * 循环依赖：先放空表再回填（与 TypeValue 路径 partial 口径一致），
 * 并记录 cycle/depth/missing/missing-export 供诊断。
 */
export function evalAbsModuleGraph(
  entrySource: string,
  entryFile: string,
  opts: AbsGraphOptions = {},
): AbsModuleGraphResult {
  const load = opts.loadModule ?? defaultAbsLoadModule;
  // 命中校验分叉开关：opts.loadModule 存在（custom loader，LSP buffer 等）时
  // 条目自身按 loader 内容复核；缺省（默认 loader）保持 stat 快路径（见
  // evalDep 命中段）——注意判据是 opts 而非 load（load 恒为函数）。
  const customLoad = opts.loadModule;
  const maxDepth = opts.maxDepth ?? 16;
  const cache = new Map<string, AbsModuleExports>();
  const loading: string[] = [];
  const issues: AbsModuleLoadIssue[] = [];
  const seenIssue = new Set<string>();
  // 未去重的全量 issue 流水：缓存条目的子树切片从这里截取，保证自包含。
  // seenIssue 只服务入口 flat 列表的展示去重；若切片也从去重后的 issues 截取，
  // 兄弟模块共享同一 issue（两个模块 import 同一缺失文件）时，后到兄弟的
  // 切片被饿死为空，缓存命中重放丢失该子树装载诊断（BUG-010）。
  const issueFlow: AbsModuleLoadIssue[] = [];
  // 本轮求值内各依赖模块的子树指纹元数据（DESIGN-002）：命中条目从缓存条目
  // 回填，新求值模块组合自直接本地依赖（已含各依赖的传递闭包）——父模块
  // 组合零额外 I/O。via = 本模块自身的装载询问对（无条件记录：fresh 求值
  // 同一口径下 loader（若有）会被问同一对，含此前未接手的接管方向）。
  // null = 子树不可追踪（环进行中 / depth 截断 / 依赖缺失），向上传播
  // fail-closed：不可追踪的模块不进会话缓存（宁冷勿陈旧）。
  const depMeta = new Map<
    string,
    | { contentHash: string; depFingerprints: AbsModuleDepFingerprint[]; via?: { spec: string; fromFile: string } }
    | null
  >();

  const pushIssue = (kind: AbsModuleLoadIssue["kind"], label: string, reason: string) => {
    const iss: AbsModuleLoadIssue = { kind, label, reason };
    issueFlow.push(iss);
    const key = `${kind}:${label}`;
    if (seenIssue.has(key)) return;
    seenIssue.add(key);
    issues.push(iss);
  };

  function evalDep(absPathRaw: string, spec: string, fromFile: string, depth: number): AbsModuleExports {
    // 键/图节点统一 stablePathKey（FIX-RESIDUAL-4）：resolve 输出是 fs 原生
    // 形态（Windows `c:\x`），逐出方可能传 `c:/x` / `/c:/x`——同键才命中。
    // fs 调用（stat/read）接受 `/` 形态，无需保留原拼写。
    const absPath = stablePathKey(absPathRaw);
    const cycleIndex = loading.indexOf(absPath);
    if (cycleIndex !== -1) {
      const chain = [...loading.slice(cycleIndex), absPath];
      pushIssue(
        "cycle",
        moduleLabel(absPath),
        `Circular module load: ${chain.join(" -> ")} (bindings inside the cycle resolve to their partially evaluated types)`,
      );
      return cache.get(absPath) ?? { named: {} };
    }

    // 会话缓存命中：自身指纹 + 子树内容指纹（DESIGN-002）逐项复核，跳过重读
    // 重解析；byPath 也回填完整导出。指纹翻转（任何传递依赖内容变更）→
    // 删条目走 miss 重求值。自身指纹按 loader 分叉：custom loader（LSP 未保存
    // buffer 等）对「磁盘存在 + loader 覆写内容」磁盘盲——stat 相等不代表
    // loader 内容未变，改按「loader 当前内容 hash == 插入时实际求值源码 hash」
    // 复核（宁冷勿陈旧）；loader 不接手该路径（undefined）→ 求值源码本来自
    // 磁盘，回落 stat。默认 loader（无 opts.loadModule）保持 stat 快路径，
    // 不退化为每依赖内容读。
    const shared = absModuleCache.get(absPath);
    // 命中校验已向 loader 取过的内容：miss 后重装载直接复用（同参同时刻），
    // 不对同一 loader 二次调用。
    let preloaded: string | undefined;
    if (shared) {
      let hit = false;
      try {
        const viaLoader = customLoad?.(spec, fromFile);
        if (viaLoader !== undefined) {
          preloaded = viaLoader;
          hit = hashSource(viaLoader) === shared.contentHash;
        } else {
          const st = statSync(absPath);
          hit = st.mtimeMs === shared.mtimeMs && st.size === shared.size;
          // custom loader 在场但当前不接管该路径：条目可能是 loader 时期的
          // 覆写内容（如 LSP buffer 未保存即关闭回退磁盘），stat 只证明磁盘
          // 未动、不证明条目内容 == 磁盘内容——补内容 hash 复核（宁冷勿陈旧；
          // 读出的磁盘内容进 preloaded，miss 重装载复用不二次读盘）。
          // 默认 loader（无 opts.loadModule）插入内容本就来自磁盘，保持纯
          // stat 快路径（DESIGN-002），不退化为每依赖内容读。
          if (hit && customLoad) {
            preloaded = readFileSync(absPath, "utf8");
            hit = hashSource(preloaded) === shared.contentHash;
          }
        }
        // 子树复核同口径 loader 感知：带装载证据的传递依赖按原询问对重问
        // 当前 loader（depFingerprintCurrent）——loader 覆写传递依赖且磁盘
        // 未动时，自身指纹双双通过也不得陈旧命中。
        if (hit) hit = depFingerprintCurrent(shared.depFingerprints, customLoad);
      } catch {
        /* 文件已删除 / loader 抛错 → 指纹失效，走 miss 重新装载 */
      }
      if (hit) {
        for (const iss of shared.issues) pushIssue(iss.kind, iss.label, iss.reason);
        cache.set(absPath, shared.exports);
        // via 无条件记录（装载询问对）：本轮 loader 未接手不代表后续调用
        // 的 loader 不接管——父条目复核按当前 loader 重问同一对。
        depMeta.set(absPath, {
          contentHash: shared.contentHash,
          depFingerprints: shared.depFingerprints,
          via: { spec, fromFile },
        });
        return shared.exports;
      }
      absModuleCache.delete(absPath);
    }

    if (cache.has(absPath)) return cache.get(absPath)!;
    if (depth > maxDepth) {
      const chain = [...loading, absPath];
      pushIssue(
        "depth",
        moduleLabel(absPath),
        `Module load chain too deep (depth ${chain.length} > ${maxDepth} max): ${chain.join(" -> ")} (loading truncated, deeper modules typed as unknown)`,
      );
      const empty: AbsModuleExports = { named: {} };
      cache.set(absPath, empty);
      return empty;
    }
    // 循环占位：后续 cache 重绑不得换对象——环内消费者持有本引用，必须就地回填。
    const placeholder: AbsModuleExports = { named: {} };
    cache.set(absPath, placeholder);
    loading.push(absPath);

    // 装载询问证据（via）：本模块求值装载所用的 spec/fromFile 对——无论内容
    // 出自 loader 还是磁盘都记录：fresh 求值同一口径下 loader（若有）会被问
    // 同一对（含此前未接手的接管方向）；条目不存 loader 引用，当前世界由
    // 当前调用的 loader 定义。customLoad 存在且 load 返回内容 → 内容出自
    // loader（load === customLoad）；返回 undefined → 磁盘 readFileSync 回落。
    let source: string | undefined = preloaded;
    const viaLoadPair: { spec: string; fromFile: string } = { spec, fromFile };
    if (source === undefined) {
      const loaded = load(spec, fromFile);
      if (loaded !== undefined) source = loaded;
    }
    if (source === undefined) {
      // A3：裸包入口用已解析的绝对路径读源（load 只认 import 说明符）；
      // preloaded = 命中校验已取过的 loader 内容，复用不再二次调用
      try {
        source = readFileSync(absPath, "utf-8");
      } catch {
        source = undefined;
      }
    }
    if (source === undefined) {
      pushIssue(
        "missing",
        spec,
        `Module file not found for '${spec}' (from ${moduleLabel(fromFile)}); tried: ${absPath}`,
      );
      loading.pop();
      return placeholder;
    }

    // 子树 issue 切片起点：本模块自身（含其依赖）产生的装载问题。
    // 锚定 issueFlow（未去重）——切片必须与兄弟模块是否先报过同一 issue 无关。
    const issueStart = issueFlow.length;
    const localDeps: string[] = [];
    const modules = buildModulesForFile(
      source,
      absPath,
      load,
      evalDep,
      depth,
      maxDepth,
      (kind, label, reason) => {
        pushIssue(kind, label, reason);
      },
      localDeps,
    );
    let exports: AbsModuleExports;
    const evalRun = tryRunTranspiled(source, { mode: "analyze", modules });
    if (evalRun) {
      // P1：evaluator 优先——转译执行收集导出（specifier/re-export/star/default
      // 全量进 __nudoExport 动态表）；unsupported/internal 回落见
      // tryRunTranspiled（回落事件入收集器）。
      exports = evalExportsToModuleExports(evalRun, parse(source), `eval:${absPath}`);
    } else {
      // fail-closed：B 失败 = 无信息（空导出表）——旧 ast-eval 兜底
      // （evalProgramAbs + collectAbsExports）已删，无第二求值路径。
      exports = { named: {} };
    }
    // named import / re-export 缺名（仅 evaluated 表；fail-closed 空表不报）
    for (const iss of collectMissingExportIssues(source, modules, absPath)) {
      pushIssue(iss.kind, iss.label, iss.reason);
    }
    loading.pop();
    // 就地回填占位：环内 import 持有的是 placeholder 引用，换新对象会永远空导出。
    Object.assign(placeholder.named, exports.named);
    if (exports.default !== undefined) placeholder.default = exports.default;
    if (exports.evaluated) placeholder.evaluated = true;
    cache.set(absPath, placeholder);

    // 子树内容指纹组合（DESIGN-002）：直接本地依赖的 contentHash + 各依赖
    // 已记录的传递闭包，全部来自本轮已追踪的元数据——组合零额外 I/O。
    // 任一子依赖元数据缺失（环进行中 / depth 截断 / 缺文件早退）→ 子树不可
    // 追踪：记 null 向上传播，本模块不入会话缓存（fail-closed，宁冷勿陈旧）。
    const depFingerprints: AbsModuleDepFingerprint[] = [];
    const seenDep = new Set<string>();
    let untrackable = false;
    for (const depPath of localDeps) {
      const meta = depMeta.get(depPath);
      if (!meta) {
        untrackable = true;
        break;
      }
      if (!seenDep.has(depPath)) {
        seenDep.add(depPath);
        // 直接依赖的本体条目：带上子依赖本轮的装载询问证据（via）——复核时
        // 按原 spec/fromFile 重问 loader；传递闭包条目（下方 for）原样传播，
        // 其 via 由更深的装载轮次记录。
        depFingerprints.push(
          meta.via
            ? { path: depPath, hash: meta.contentHash, via: meta.via }
            : { path: depPath, hash: meta.contentHash },
        );
      }
      for (const e of meta.depFingerprints) {
        if (seenDep.has(e.path)) continue;
        seenDep.add(e.path);
        depFingerprints.push(e);
      }
    }
    const subtree = untrackable
      ? null
      : { contentHash: hashSource(source), depFingerprints, via: viaLoadPair };
    depMeta.set(absPath, subtree);

    let fingerprint: { mtimeMs: number; size: number } | undefined;
    try {
      const st = statSync(absPath);
      fingerprint = { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      /* 无指纹（如自定义 loader 的虚拟文件）→ 不入会话缓存 */
    }
    if (fingerprint && subtree) {
      absModuleCache.set(absPath, {
        ...fingerprint,
        contentHash: subtree.contentHash,
        depFingerprints: subtree.depFingerprints,
        exports: placeholder,
        issues: issueFlow.slice(issueStart),
      });
    }
    return placeholder;
  }

  const modules = buildModulesForFile(
    entrySource,
    entryFile,
    load,
    evalDep,
    0,
    maxDepth,
    (kind, label, reason) => {
      pushIssue(kind, label, reason);
    },
  );
  // 入口文件自身的 named import / re-export 缺名
  for (const iss of collectMissingExportIssues(entrySource, modules, entryFile)) {
    pushIssue(iss.kind, iss.label, iss.reason);
  }

  return { modules, byPath: cache, issues };
}

/** import 本地名 → 依赖模块导出（与 run.ts rewriteUserImports/__nudoBindImport 同语义） */
function importLocalBindings(
  source: string,
  modules: Record<string, AbsModuleExports>,
): Map<string, Abs> {
  const out = new Map<string, Abs>();
  let file: Node;
  try {
    file = parse(source);
  } catch {
    return out;
  }
  const body = ((file as { program?: { body?: unknown[] } }).program?.body ?? []) as Array<{
    type?: string;
    source?: { value?: unknown };
    specifiers?: Array<{
      type?: string;
      local?: { name?: string } | null;
      imported?: { type?: string; name?: string; value?: string } | null;
    }>;
  }>;
  for (const stmt of body) {
    if (stmt.type !== "ImportDeclaration" || typeof stmt.source?.value !== "string") continue;
    const mod = modules[stmt.source.value];
    if (!mod) continue;
    for (const sp of stmt.specifiers ?? []) {
      const local = sp.local?.name;
      if (!local) continue;
      if (sp.type === "ImportNamespaceSpecifier") {
        // 命名空间（named + default 槽）→ open obj Abs（与 namespaceAbsOf 同口径）
        out.set(local, namespaceAbsOf(mod));
      } else if (sp.type === "ImportDefaultSpecifier") {
        // 缺 default 也留槽（unknown），与「从未 import」可区分
        out.set(local, mod.default ?? unknown);
      } else if (sp.type === "ImportSpecifier") {
        const imported =
          sp.imported?.type === "StringLiteral" ? sp.imported.value : sp.imported?.name;
        if (imported === undefined) continue;
        // 自有属性读：依赖未导出 toString 等名时裸读会把 Object.prototype 方法漏进 Abs 域
        const absVal =
          imported === "default"
            ? mod.default
            : Object.hasOwn(mod.named, imported)
              ? mod.named[imported]
              : undefined;
        out.set(local, absVal ?? unknown);
      }
    }
  }
  return out;
}

/**
 * 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。
 * 供 bindings / hover 从 Abs 投影，不必走 TypeValue evaluator。
 *
 * evaluator fail-closed：绑定 = B run 绑定表（$recordBinding：顶层 const/let，
 * arrow/function 表达式经 $fnVal 已是 Abs fn）+ 导出表桥接（export
 * function/const）+ import 本地名（模块图解析）；B 失败 → 空 Map
 * （显式无信息，不回落解释求值）。
 */
export function collectAbsBindingsFromGraph(
  source: string,
  filePath: string,
  opts: AbsGraphOptions = {},
): Map<string, Abs> {
  const out = new Map<string, Abs>();
  try {
    const { modules } = evalAbsModuleGraph(source, filePath, opts);
    const mocks = seedFnsToMocks(opts.seedVars ?? {}, opts.seedFns ?? {});
    const run = tryRunTranspiled(source, {
      mode: "analyze",
      modules,
      envGlobals: Object.keys(mocks).length ? mocks : undefined,
    });
    if (!run) return out;
    // 顶层 const/let（$recordBinding 通道，Abs 值）
    const binds = bindingsOf(run);
    if (binds) {
      for (const [name, v] of binds) {
        if (isAbsVal(v)) out.set(name, v);
      }
    }
    // 导出名（export function/const + specifier/star/default）→ fn Abs 桥接
    const exports = evalExportsToModuleExports(run, parse(source), `eval:bindings:${filePath}`);
    for (const [name, v] of Object.entries(exports.named)) {
      if (!out.has(name)) out.set(name, v);
    }
    // import 本地名 → 依赖模块导出
    for (const [local, absVal] of importLocalBindings(source, modules)) {
      if (!out.has(local)) out.set(local, absVal);
    }
  } catch {
    /* ignore */
  }
  return out;
}
