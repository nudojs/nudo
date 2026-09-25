/**
 * Host：import 图（相对 + 裸包 harvest）→ Abs 导出表 → 注入入口。
 * 读 fs / 解析路径 / harvest 在这里；core 只收 modules 表。
 */

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@nudojs/parser";
import {
  abs as makeAbs,
  absFunction,
  bindingsOf,
  tryRunTranspiled,
  callTranspiledExportFull,
  foldStaticStringExpr,
  unknown,
  type Abs,
  type AbsModuleExports,
} from "@nudojs/core";
import type { Node } from "@babel/types";
import { bareSpecToAbsModules } from "@nudojs/harvester";
import { resolveNpmJsEntry } from "./evaluator/resolve-npm.ts";
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

/** 相对说明符 → 源码 */
export function defaultAbsLoadModule(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return undefined;
  try {
    const p = resolve(dirname(resolve(fromFile)), spec);
    for (const cand of [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")]) {
      try {
        return readFileSync(cand, "utf-8");
      } catch {
        /* next */
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function relCandidates(spec: string, fromFile: string): string[] {
  const p = resolve(dirname(resolve(fromFile)), spec);
  return [p, `${p}.js`, `${p}.mjs`, `${p}.ts`, resolve(p, "index.js")];
}

function resolveRel(spec: string, fromFile: string): string | null {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  for (const cand of relCandidates(spec, fromFile)) {
    try {
      readFileSync(cand, "utf-8");
      return cand;
    } catch {
      /* next */
    }
  }
  return null;
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

/** 把当前文件的全部 import（相对 + 裸包）编成 modules 表 */
function buildModulesForFile(
  source: string,
  fromFile: string,
  load: AbsLoadModule,
  evalDep: (absPath: string, spec: string, fromFile: string, depth: number) => AbsModuleExports,
  depth: number,
  maxDepth: number,
  onMissing: (spec: string, fromFile: string, tried: string[]) => void,
): Record<string, AbsModuleExports> {
  const modules: Record<string, AbsModuleExports> = {};
  for (const spec of importSpecs(source)) {
    if (spec.startsWith(".") || spec.startsWith("/")) {
      const childPath = resolveRel(spec, fromFile);
      if (!childPath) {
        onMissing(spec, fromFile, relCandidates(spec, fromFile));
        continue;
      }
      modules[spec] = evalDep(childPath, spec, fromFile, depth + 1);
    } else if (!spec.startsWith("node:")) {
      // A3：优先执行包入口 JS（ms/debug 等纯 JS 包返回面可折叠）；
      // 无入口或求值失败再 harvest stub。
      const entry = resolveNpmJsEntry(spec, dirname(fromFile));
      if (entry) {
        const executed = evalDep(entry, spec, fromFile, depth + 1);
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
  kind: "cycle" | "depth" | "missing";
  /** 诊断定位用标签（文件 basename 或 require/import 说明符） */
  label: string;
  reason: string;
};

export type AbsModuleGraphResult = {
  /** 入口 import 说明符 → 依赖导出表 */
  modules: Record<string, AbsModuleExports>;
  /** 绝对路径 → 导出表（含依赖；循环时占位为空） */
  byPath: Map<string, AbsModuleExports>;
  /** cycle / depth / missing（B 路径权威，避免 TypeValue 叠报） */
  issues: AbsModuleLoadIssue[];
};

export type AbsGraphOptions = {
  loadModule?: AbsLoadModule;
  seedVars?: Record<string, Abs>;
  seedFns?: Record<string, { params: string[]; body: Node; async?: boolean }>;
  maxDepth?: number;
};

/** 会话级依赖模块缓存条目：stat 指纹 + 导出 + 子树装载 issue。 */
export type AbsModuleCacheEntry = {
  mtimeMs: number;
  size: number;
  exports: AbsModuleExports;
  /** 该模块子树首次求值时记录的 cycle/depth/missing；命中时重放。 */
  issues: AbsModuleLoadIssue[];
};

/**
 * 跨入口复用的依赖模块缓存（LSP 脏传播重验 N 个入口、共享同一依赖树时，
 * 避免每个入口重复 parse + 抽象求值全部依赖）。键为解析后的绝对路径，
 * 命中条件 mtimeMs+size 严格相等（与 ModuleGraphCache 边缓存同口径）；
 * 内容变更由指纹自然失效，删除经 evictAbsModuleCacheFiles / clearAbsModuleCache 逐出
 * （删除即使不逐出也自愈：stat 抛错走 miss）。
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

export function evictAbsModuleCacheFiles(paths: string[]): void {
  for (const p of paths) absModuleCache.delete(p);
}

function moduleLabel(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function isAbsVal(v: unknown): v is Abs {
  return !!v && typeof v === "object" && "shape" in (v as object) && "conf" in (v as object);
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
 * 顶层函数声明/导出的形参表（B-path JS 函数 → Abs fn 桥接用）：
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
 * B-path 执行产出的导出表 → AbsModuleExports。
 * run 表的键 = 导出名（P1-a：specifier/re-export/star/default 全量收进
 * __nudoExport 动态表）；JS 函数经 absFunction(apply) 桥接成 Abs fn——
 * apply 优先于 body 派发（callFunctionUnchecked 第三路径），跨边界调用
 * 由 callTranspiledExportFull 回进 B-path 函数执行。
 */
export function bPathExportsToModuleExports(
  run: Record<string, unknown>,
  file: Node,
  fingerprintPrefix: string,
): AbsModuleExports {
  const named: Record<string, Abs> = {};
  let def: Abs | undefined;
  const paramTable = topLevelFnParams(file);
  for (const [k, v] of Object.entries(run)) {
    if (v === undefined || v === null) continue;
    let absVal: Abs;
    if (isAbsVal(v)) {
      absVal = v;
    } else if (typeof v === "function") {
      const params =
        paramTable.get(k) ??
        Array.from({ length: (v as { length?: number }).length ?? 0 }, (_, i) => `arg${i}`);
      absVal = absFunction(params, {
        apply: (args: Abs[]) => callTranspiledExportFull(run, k, args).result,
        kind: "bpath-export",
        // 无 body 的桥接 fn 预算键 = fingerprint ?? anon#N——缺省会让所有
        // 桥接导出共享 anon#1，嵌套跨模块调用（a 调 b 调 a'）撞
        // _activeCallKeys 递归守卫被误截断为 opaque。按 模块#导出 唯一化。
        fingerprint: `${fingerprintPrefix}#${k}`,
      });
    } else {
      absVal = unknown;
    }
    if (k === "default") def = absVal;
    else named[k] = absVal;
  }
  const out: AbsModuleExports = { named };
  if (def) out.default = def;
  return out;
}

/**
 * 递归求值相对依赖 + 裸包 harvest，产出入口可用的 modules 表。
 * 循环依赖：先放空表再回填（与 TypeValue 路径 partial 口径一致），
 * 并记录 cycle/depth/missing 供诊断。
 */
export function evalAbsModuleGraph(
  entrySource: string,
  entryFile: string,
  opts: AbsGraphOptions = {},
): AbsModuleGraphResult {
  const load = opts.loadModule ?? defaultAbsLoadModule;
  const maxDepth = opts.maxDepth ?? 16;
  const cache = new Map<string, AbsModuleExports>();
  const loading: string[] = [];
  const issues: AbsModuleLoadIssue[] = [];
  const seenIssue = new Set<string>();

  const pushIssue = (kind: AbsModuleLoadIssue["kind"], label: string, reason: string) => {
    const key = `${kind}:${label}`;
    if (seenIssue.has(key)) return;
    seenIssue.add(key);
    issues.push({ kind, label, reason });
  };

  function evalDep(absPath: string, spec: string, fromFile: string, depth: number): AbsModuleExports {
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

    // 会话缓存命中（指纹严格相等）：跳过重读重解析；byPath 也回填完整导出。
    const shared = absModuleCache.get(absPath);
    if (shared) {
      try {
        const st = statSync(absPath);
        if (st.mtimeMs === shared.mtimeMs && st.size === shared.size) {
          for (const iss of shared.issues) pushIssue(iss.kind, iss.label, iss.reason);
          cache.set(absPath, shared.exports);
          return shared.exports;
        }
      } catch {
        /* 文件已删除 → 指纹失效，走 miss 重新装载 */
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
    cache.set(absPath, { named: {} });
    loading.push(absPath);

    const source = load(spec, fromFile) ?? (() => {
      // A3：裸包入口用已解析的绝对路径读源（load 只认 import 说明符）
      try {
        return readFileSync(absPath, "utf-8");
      } catch {
        return undefined;
      }
    })();
    if (source === undefined) {
      pushIssue(
        "missing",
        spec,
        `Module file not found for '${spec}' (from ${moduleLabel(fromFile)}); tried: ${absPath}`,
      );
      const empty: AbsModuleExports = { named: {} };
      cache.set(absPath, empty);
      loading.pop();
      return empty;
    }

    // 子树 issue 切片起点：本模块自身（含其依赖）产生的装载问题。
    const issueStart = issues.length;
    const modules = buildModulesForFile(
      source,
      absPath,
      load,
      evalDep,
      depth,
      maxDepth,
      (spec, fromFile, tried) => {
        pushIssue(
          "missing",
          spec,
          `Module file not found for '${spec}' (from ${moduleLabel(fromFile)}); tried: ${tried.join(", ")}`,
        );
      },
    );
    let exports: AbsModuleExports;
    const bRun = tryRunTranspiled(source, { mode: "analyze", modules });
    if (bRun) {
      // P1：B-path 优先——转译执行收集导出（specifier/re-export/star/default
      // 全量进 __nudoExport 动态表）；unsupported/internal 回落见
      // tryRunTranspiled（回落事件入收集器）。
      exports = bPathExportsToModuleExports(bRun, parse(source), `bpath:${absPath}`);
    } else {
      // fail-closed：B 失败 = 无信息（空导出表）——旧 ast-eval 兜底
      // （evalProgramAbs + collectAbsExports）已删，无第二求值路径。
      exports = { named: {} };
    }
    loading.pop();
    cache.set(absPath, exports);

    let fingerprint: { mtimeMs: number; size: number } | undefined;
    try {
      const st = statSync(absPath);
      fingerprint = { mtimeMs: st.mtimeMs, size: st.size };
    } catch {
      /* 无指纹（如自定义 loader 的虚拟文件）→ 不入会话缓存 */
    }
    if (fingerprint) {
      absModuleCache.set(absPath, {
        ...fingerprint,
        exports,
        issues: issues.slice(issueStart),
      });
    }
    return exports;
  }

  const modules = buildModulesForFile(
    entrySource,
    entryFile,
    load,
    evalDep,
    0,
    maxDepth,
    (spec, fromFile, tried) => {
      pushIssue(
        "missing",
        spec,
        `Module file not found for '${spec}' (from ${moduleLabel(fromFile)}); tried: ${tried.join(", ")}`,
      );
    },
  );

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
        // 命名空间（named + default 槽）→ open obj Abs（与 bindNamespace 同口径）
        const slots: Record<string, { value: Abs }> = {};
        for (const [k, v] of Object.entries(mod.named)) slots[k] = { value: v };
        if (mod.default) slots["default"] = { value: mod.default };
        out.set(local, makeAbs({ k: "obj", slots, open: true }, undefined, undefined, "path"));
      } else if (sp.type === "ImportDefaultSpecifier") {
        if (mod.default) out.set(local, mod.default);
      } else if (sp.type === "ImportSpecifier") {
        const imported =
          sp.imported?.type === "StringLiteral" ? sp.imported.value : sp.imported?.name;
        if (imported === undefined) continue;
        const absVal = imported === "default" ? mod.default : mod.named[imported];
        if (absVal) out.set(local, absVal);
      }
    }
  }
  return out;
}

/**
 * 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。
 * 供 bindings / hover 从 Abs 投影，不必走 TypeValue evaluator。
 *
 * B-path fail-closed：绑定 = B run 绑定表（$recordBinding：顶层 const/let，
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
    const exports = bPathExportsToModuleExports(run, parse(source), `bpath:bindings:${filePath}`);
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
