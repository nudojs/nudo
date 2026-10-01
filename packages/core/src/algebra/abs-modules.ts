/**
 * Abs 模块面（无 fs）：import 绑定 + export 收集。
 * 解析路径/读文件在 host；core 只吃「specifier → 导出表」。
 */

import type { File, ImportDeclaration } from "@babel/types";
import type { Abs } from "./abs.ts";
import { unknown, abs } from "./abs.ts";
import type { AstEnv } from "./ast-env.ts";
import { absFunction } from "./abs-fn.ts";
import { undefAbs } from "./hof.ts";

export type AbsModuleExports = {
  named: Record<string, Abs>;
  default?: Abs;
  /**
   * 导出表来自成功求值（evalExportsToModuleExports）。
   * fail-closed 空表 / harvest stub / env 手写表不设——missing-export 只对
   * 成功求值的表报（zero-FP，避免与 module-missing 叠报）。
   */
  evaluated?: boolean;
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
      // 自有属性读：依赖未导出 toString 等名时裸读会把 Object.prototype 方法漏进 Abs 域
      const named = Object.hasOwn(mod.named, imported) ? mod.named[imported] : undefined;
      env.vars.set(s.local.name, named ?? unknown);
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
  // ESM：显式导出（decl / specifier / 显式 re-export）恒压过 export *。
  // star 只填「从未显式导出」的名；star×star 仍按源序后者覆盖（已知偏差）。
  const explicitNames = new Set<string>();

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
              explicitNames.add(exported);
              continue;
            }
            if (spec.type !== "ExportSpecifier") continue;
            const local = spec.local.type === "Identifier" ? spec.local.name : spec.local.value;
            const exported =
              spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
            // 自有属性读（同 bindImports：原型名不得当 re-export 源）
            const v =
              local === "default"
                ? mod.default
                : Object.hasOwn(mod.named, local)
                  ? mod.named[local]
                  : undefined;
            // 缺名：留 unknown 槽而非 continue 丢槽（消费方 import 还能拿到 unknown）
            const slot = v ?? unknown;
            if (exported === "default") defaultExport = slot;
            else {
              named[exported] = slot;
              explicitNames.add(exported);
            }
          }
        }
        continue;
      }
      const decl = stmt.declaration;
      if (decl) {
        if (decl.type === "FunctionDeclaration" && decl.id) {
          // 声明即导出名：lookup 缺值也留槽（与「从未导出」可区分）
          named[decl.id.name] = lookupExport(env, decl.id.name) ?? unknown;
          explicitNames.add(decl.id.name);
        } else if (decl.type === "ClassDeclaration" && decl.id) {
          named[decl.id.name] = lookupExport(env, decl.id.name) ?? unknown;
          explicitNames.add(decl.id.name);
        } else if (decl.type === "VariableDeclaration") {
          for (const d of decl.declarations) {
            if (d.id.type === "Identifier") {
              named[d.id.name] = lookupExport(env, d.id.name) ?? unknown;
              explicitNames.add(d.id.name);
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
          explicitNames.add(exported);
          continue;
        }
        if (spec.type !== "ExportSpecifier") continue;
        const local = spec.local.type === "Identifier" ? spec.local.name : spec.local.value;
        const exported =
          spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
        const v = lookupExport(env, local) ?? unknown;
        if (exported === "default") defaultExport = v;
        else {
          named[exported] = v;
          explicitNames.add(exported);
        }
      }
    } else if (stmt.type === "ExportAllDeclaration" && stmt.source && modules) {
      // export * from "mod"：并入 named（不含 default，与 ESM 一致）；
      // 不得覆盖显式导出（explicit wins）。star×star 仍按源序后者覆盖。
      // （Babel 8：`export * as ns` 走 ExportNamedDeclaration + ExportNamespaceSpecifier）
      const mod = modules[stmt.source.value];
      if (mod?.named) {
        for (const [k, v] of Object.entries(mod.named)) {
          if (!explicitNames.has(k)) named[k] = v;
        }
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration") {
        defaultExport = lookupExport(env, d.id ? d.id.name : "default") ?? unknown;
      } else if (d.type === "ClassDeclaration" && d.id) {
        defaultExport = lookupExport(env, d.id.name) ?? unknown;
      } else if (d.type === "Identifier") {
        // `export default undefined` / `export default x`：槽位保留
        defaultExport = d.name === "undefined" ? undefAbs() : (lookupExport(env, d.name) ?? unknown);
      } else {
        // 字面量/表达式默认导出：名存在（值可折叠与否交给求值路径）
        defaultExport = lookupExport(env, "default") ?? unknown;
      }
    }
  }

  const result: AbsModuleExports = { named };
  if (defaultExport !== undefined) result.default = defaultExport;
  return result;
}
