/**
 * Abs 模块面（无 fs）：import 绑定 + export 收集。
 * 解析路径/读文件在 host；core 只吃「specifier → 导出表」。
 */

import type { File, ImportDeclaration } from "@babel/types";
import type { Abs } from "./abs.ts";
import { unknown, obj } from "./abs.ts";
import type { AstEnv } from "./ast-eval.ts";
import { absFunction } from "./abs-fn.ts";

export type AbsModuleExports = {
  named: Record<string, Abs>;
  default?: Abs;
};

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
      const slots: Record<string, { value: Abs }> = {};
      for (const [k, v] of Object.entries(mod.named)) slots[k] = { value: v };
      if (mod.default) slots["default"] = { value: mod.default };
      env.vars.set(s.local.name, obj(slots));
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
 * 支持：export function/const、export { a, b as c }、export default（具名）。
 */
export function collectAbsExports(file: File, env: AstEnv): AbsModuleExports {
  const named: Record<string, Abs> = {};
  let defaultExport: Abs | undefined;

  for (const stmt of file.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
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
        if (spec.type !== "ExportSpecifier") continue;
        const local = spec.local.name;
        const exported =
          spec.exported.type === "Identifier" ? spec.exported.name : String(spec.exported);
        const v = lookupExport(env, local);
        if (v) named[exported] = v;
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" && d.id) {
        defaultExport = lookupExport(env, d.id.name);
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
