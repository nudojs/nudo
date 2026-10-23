/**
 * `@nudo:mock-module "spec" from "./mock.js"` — file-level module replacement.
 * Full replace swaps the specifier's exports table; partial `{ a, b }` only
 * overlays those named exports and lets the rest fall through.
 *
 * Fail-closed: missing mock file / eval failure / empty binding / **named export
 * the mock does not provide** → error, not a silent drop and not invented types.
 */

import { extractFileDirectives, parse, type FileDirective } from "@nudojs/parser";
import type { AbsModuleExports } from "@nudojs/core";
import { obj as absObj, type Abs } from "@nudojs/core";
import type { LoadModule } from "./load-module.ts";
import { evalExportsToModuleExports } from "./abs-modules-graph.ts";
import { evalMockFileWithDeps } from "./mock-file.ts";
import type { FromMockError } from "./mock-abs.ts";

export type MockModuleApplyResult = {
  modules: Record<string, AbsModuleExports>;
  errors: FromMockError[];
  /** true when at least one mock-module directive was applied */
  applied: boolean;
};

function loadMockModuleExports(
  fromPath: string,
  fromFile: string,
  loadModule: LoadModule | undefined,
): { exports?: AbsModuleExports; error?: string } {
  // mock 文件相对 import：evalMockFileWithDeps 以绝对路径为模块图入口
  const evaled = evalMockFileWithDeps(fromPath, fromFile, loadModule);
  if (!evaled.ok) {
    return {
      error:
        evaled.kind === "not-found"
          ? `Mock module not found (from "${fromPath}")`
          : evaled.error,
    };
  }
  const exports = evalExportsToModuleExports(evaled.run, parse(evaled.source), `mock-module:${fromPath}`);
  // CJS/文档示例友好：仅有 named 时合成 default 命名空间，支持
  // `import axios from "axios"` 后 `axios.get(...)`。
  if (exports.default === undefined && Object.keys(exports.named).length > 0) {
    const slots: Record<string, { value: Abs }> = {};
    for (const [k, v] of Object.entries(exports.named)) slots[k] = { value: v };
    exports.default = absObj(slots);
  }
  return { exports };
}

/**
 * 局部（点名）形态的 overlay 取值。
 *
 * `missing` = **被点名但 mock 没有导出**的名字（Bug 963）：点名表是用户声明的
 * 契约（「这个导出要被替换」）⇒ 缺一个就是契约没兑现 ⇒ 由调用方走**错误出口**，
 * **不得**让原模块的同名导出原封不动活下来（那会让分析跑在「一半 mock、
 * 一半原模块」的混合程序上）。
 */
function pickNamed(
  mock: AbsModuleExports,
  names: string[],
): {
  named: Record<string, import("@nudojs/core").Abs>;
  default?: import("@nudojs/core").Abs;
  missing: string[];
} {
  const named: Record<string, import("@nudojs/core").Abs> = {};
  let def: import("@nudojs/core").Abs | undefined;
  const missing: string[] = [];
  for (const n of names) {
    if (n === "default") {
      if (mock.default) def = mock.default;
      else missing.push(n);
      continue;
    }
    // 自有属性读：mock 未导出 toString 等名时裸读会把 Object.prototype 方法叠成 mock 导出
    const v = Object.hasOwn(mock.named, n) ? mock.named[n] : undefined;
    if (v !== undefined) named[n] = v;
    else missing.push(n);
  }
  return def !== undefined ? { named, default: def, missing } : { named, missing };
}

/**
 * Overlay `@nudo:mock-module` directives onto a modules map.
 * `base` is not mutated; a new map is returned.
 */
export function applyMockModuleDirectives(
  base: Record<string, AbsModuleExports>,
  fileDirectives: FileDirective[],
  opts: { fromFile: string; loadModule?: LoadModule },
): MockModuleApplyResult {
  const mods = fileDirectives.filter((d): d is Extract<FileDirective, { kind: "mock-module" }> =>
    d.kind === "mock-module",
  );
  if (mods.length === 0) {
    return { modules: base, errors: [], applied: false };
  }
  const out: Record<string, AbsModuleExports> = { ...base };
  const errors: FromMockError[] = [];
  let applied = false;
  for (const d of mods) {
    const loaded = loadMockModuleExports(d.fromPath, opts.fromFile, opts.loadModule);
    if (!loaded.exports) {
      errors.push({
        name: d.source,
        fromPath: d.fromPath,
        message: loaded.error ?? `Mock module "${d.fromPath}" could not be loaded`,
      });
      continue;
    }
    const mock = loaded.exports;
    if (!d.names || d.names.length === 0) {
      // full replacement
      out[d.source] = mock;
      applied = true;
      continue;
    }
    // partial: listed names from mock, rest fall through to original
    const orig = out[d.source] ?? { named: {} };
    const overlay = pickNamed(mock, d.names);
    // Bug 963：点名缺失 ⇒ **fail-closed**（与同函数的「mock 文件缺失」同口径）：
    //   走错误出口（nudo:module-missing ⇒ error），该条指令**不生效**
    //   （applied 不置 true、原模块保持原样）——绝不「一半 mock、一半原模块」。
    if (overlay.missing.length > 0) {
      for (const n of overlay.missing) {
        errors.push({
          name: d.source,
          fromPath: d.fromPath,
          message: `Mock module "${d.fromPath}" does not export "${n}"`,
        });
      }
      continue;
    }
    const named = { ...orig.named, ...overlay.named };
    const merged: AbsModuleExports = {
      named,
      // 任一侧成功求值则合并表可作 missing-export 判定
      ...(orig.evaluated || mock.evaluated ? { evaluated: true } : {}),
    };
    const wantDefault = d.names.includes("default");
    if (wantDefault && overlay.default !== undefined) {
      merged.default = overlay.default;
    } else if (orig.default !== undefined) {
      merged.default = orig.default;
    }
    out[d.source] = merged;
    applied = true;
  }
  return { modules: out, errors, applied };
}

/** Source string → apply mock-module (CLI / one-shot hosts). */
export function applyMockModuleDirectivesFromSource(
  source: string,
  base: Record<string, AbsModuleExports>,
  opts: { fromFile: string; loadModule?: LoadModule },
): MockModuleApplyResult {
  let fileDirectives: FileDirective[] = [];
  try {
    fileDirectives = extractFileDirectives(parse(source));
  } catch {
    fileDirectives = [];
  }
  return applyMockModuleDirectives(base, fileDirectives, opts);
}
