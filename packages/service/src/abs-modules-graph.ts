/**
 * Host：import 图（相对 + 裸包 harvest）→ Abs 导出表 → 注入入口。
 * 读 fs / 解析路径 / harvest 在这里；core 只收 modules 表。
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse } from "@nudojs/parser";
import {
  evalProgramAbs,
  collectAbsExports,
  absFunction,
  type Abs,
  type AbsModuleExports,
  type AstEnv,
  type Phi,
} from "@nudojs/core";
import type { Node } from "@babel/types";
import { bareSpecToAbsModules } from "./harvest-to-abs.ts";

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
      callee?: { type?: string; name?: string };
      arguments?: Array<{ type?: string; value?: unknown }>;
      [k: string]: unknown;
    };
    if (
      o.type === "CallExpression" &&
      o.callee?.type === "Identifier" &&
      o.callee.name === "require" &&
      o.arguments?.[0]?.type === "StringLiteral"
    ) {
      const spec = o.arguments[0].value;
      if (typeof spec === "string") out.push(spec);
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
  evalDep: (path: string, src: string, depth: number) => AbsModuleExports,
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
      const childSrc = load(spec, fromFile);
      if (childSrc === undefined) {
        onMissing(spec, fromFile, [childPath]);
        continue;
      }
      modules[spec] = evalDep(childPath, childSrc, depth + 1);
    } else if (!spec.startsWith("node:")) {
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

function moduleLabel(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
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

  function evalDep(absPath: string, source: string, depth: number): AbsModuleExports {
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

    try {
      const file = parse(source);
      const { env } = evalProgramAbs(source, { file, modules });
      const exports = collectAbsExports(file, env, modules);
      cache.set(absPath, exports);
      return exports;
    } catch {
      const empty: AbsModuleExports = { named: {} };
      cache.set(absPath, empty);
      return empty;
    } finally {
      loading.pop();
    }
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

/** 便捷：入口求值 + 依赖 Abs 注入 */
export function evalProgramAbsWithModules(
  source: string,
  entryFile: string,
  opts: AbsGraphOptions & { file?: unknown } = {},
): { env: AstEnv; last: Abs; phi: Phi } {
  const { modules } = evalAbsModuleGraph(source, entryFile, opts);
  return evalProgramAbs(source, {
    file: opts.file as never,
    modules,
    seedVars: opts.seedVars,
    seedFns: opts.seedFns,
  });
}

/**
 * 收集顶层绑定名 → Abs（含相对 import / 裸包 harvest 注入）。
 * 供 bindings / hover 从 Abs 投影，不必走 TypeValue evaluator。
 */
export function collectAbsBindingsFromGraph(
  source: string,
  filePath: string,
  opts: AbsGraphOptions = {},
): Map<string, Abs> {
  const out = new Map<string, Abs>();
  try {
    const { env } = evalProgramAbsWithModules(source, filePath, opts);
    for (const [k, v] of env.vars) {
      out.set(k, v);
    }
    for (const [name, impl] of env.fns) {
      if (!out.has(name)) {
        out.set(
          name,
          absFunction(impl.params, { body: impl.body, async: impl.async, env }),
        );
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}
