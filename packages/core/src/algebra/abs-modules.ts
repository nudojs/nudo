/**
 * Abs 模块面（无 fs）：import 绑定 + export 收集。
 * 解析路径/读文件在 host；core 只吃「specifier → 导出表」。
 */

import type { File, ImportDeclaration } from "@babel/types";
import type { Abs } from "./abs.ts";
import { unknown, abs } from "./abs.ts";
import type { AstEnv } from "./ast-env.ts";
import { absFunction } from "./abs-fn.ts";

export type AbsModuleExports = {
  named: Record<string, Abs>;
  default?: Abs;
};

/**
 * 命名空间 Abs（`import * as ns` / `export * as ns` / CJS require 绑定）：
 * open + path——导出收集可能不全（CJS 收集失败等），缺失成员是分析
 * 视图不完整，不得按「运行时缺失」判定（不可调用判定会假抛 TypeError）。
 * 单一构造点：bindImports / run.ts namespaceAbsOf / abs-modules-graph 同口径。
 */
export function namespaceAbsOf(mod: AbsModuleExports): Abs {
  const slots: Record<string, { value: Abs }> = {};
  for (const [k, v] of Object.entries(mod.named)) slots[k] = { value: v };
  if (mod.default) slots["default"] = { value: mod.default };
  return abs({ k: "obj", slots, open: true }, undefined, undefined, "path");
}

/** 把 import 说明符绑定进 env（宿主已求值依赖） */
export function bindImports(
  node: ImportDeclaration,
  env: AstEnv,
  modules: Record<string, AbsModuleExports>,
): void {
  const mod = modules[node.source.value];
  if (!mod) {
    for (const s of node.specifiers) {
      env.vars.set(s.local.name, unknown);
    }
    return;
  }
  for (const s of node.specifiers) {
    if (s.type === "ImportDefaultSpecifier") {
      env.vars.set(s.local.name, mod.default ?? unknown);
    } else if (s.type === "ImportSpecifier") {
      const imported = s.imported.type === "Identifier" ? s.imported.name : String(s.imported);
      env.vars.set(s.local.name, mod.named[imported] ?? unknown);
    } else if (s.type === "ImportNamespaceSpecifier") {
      env.vars.set(s.local.name, namespaceAbsOf(mod));
    }
  }
}

function fnToAbs(env: AstEnv, name: string): Abs | undefined {
  const impl = env.fns.get(name);
  if (!impl) return undefined;
  return absFunction(impl.params, {
    body: impl.body,
    async: impl.async,
    env,
  });
}

function lookupExport(env: AstEnv, name: string): Abs | undefined {
  if (env.vars.has(name)) return env.vars.get(name);
  return fnToAbs(env, name);
}

/**
 * 从已求值 env + AST 收集 ESM 导出。
 * 支持：export function/const、export { a, b as c }、export default（具名）、
 * 以及带 source 的 re-export（`export { a } from "mod"` / `export * from "mod"` /
 * `export * as ns from "mod"`——需 host 传入已求值 modules）。
 */
export function collectAbsExports(
  file: File,
  env: AstEnv,
  modules?: Record<string, AbsModuleExports>,
): AbsModuleExports {
  const named: Record<string, Abs> = {};
  let defaultExport: Abs | undefined;

  for (const stmt of file.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      // re-export：`export { a, b as c } from "mod"` / `export * as ns from "mod"`
      if (stmt.source && modules) {
        const mod = modules[stmt.source.value];
        if (mod) {
          for (const spec of stmt.specifiers) {
            if (spec.type === "ExportNamespaceSpecifier") {
              const exported =
                spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
              named[exported] = namespaceAbsOf(mod);
              continue;
            }
            if (spec.type !== "ExportSpecifier") continue;
            const local = spec.local.type === "Identifier" ? spec.local.name : spec.local.value;
            const exported =
              spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
            const v = local === "default" ? mod.default : mod.named[local];
            if (v === undefined) continue;
            if (exported === "default") defaultExport = v;
            else named[exported] = v;
          }
        }
        continue;
      }
      const decl = stmt.declaration;
      if (decl) {
        if (decl.type === "FunctionDeclaration" && decl.id) {
          const v = lookupExport(env, decl.id.name);
          if (v) named[decl.id.name] = v;
        } else if (decl.type === "ClassDeclaration" && decl.id) {
          const v = lookupExport(env, decl.id.name);
          if (v) named[decl.id.name] = v;
        } else if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id.type === "Identifier") {
              const v = lookupExport(env, d.id.name);
              if (v) named[d.id.name] = v;
            }
          }
        }
      }
      for (const spec of stmt.specifiers) {
        if (spec.type === "ExportNamespaceSpecifier") {
          // 无 source 的 namespace specifier 非法 ESM；防御性登记导出名
          const exported =
            spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          named[exported] ??= unknown;
          continue;
        }
        if (spec.type !== "ExportSpecifier") continue;
        const local = spec.local.type === "Identifier" ? spec.local.name : spec.local.value;
        const exported =
          spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
        const v = lookupExport(env, local);
        if (v) named[exported] = v;
      }
    } else if (stmt.type === "ExportAllDeclaration" && stmt.source && modules) {
      // export * from "mod"：并入 named（不含 default，与 ESM 一致）
      // （Babel 8：`export * as ns` 走 ExportNamedDeclaration + ExportNamespaceSpecifier）
      const mod = modules[stmt.source.value];
      if (mod?.named) {
        for (const [k, v] of Object.entries(mod.named)) named[k] = v;
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration") {
        defaultExport = lookupExport(env, d.id ? d.id.name : "default");
      } else if (d.type === "ClassDeclaration" && d.id) {
        defaultExport = lookupExport(env, d.id.name);
      } else if (d.type === "Identifier") {
        defaultExport = lookupExport(env, d.name);
      }
    }
  }

  const result: AbsModuleExports = { named };
  if (defaultExport) result.default = defaultExport;
  return result;
}
