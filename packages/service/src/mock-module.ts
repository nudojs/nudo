/**
 * `@nudo:mock-module "spec" from "./mock.js"` — file-level module replacement.
 * Full replace swaps the specifier's exports table; partial `{ a, b }` only
 * overlays those named exports and lets the rest fall through.
 *
 * Fail-closed: missing mock file / eval failure / empty binding → error, not
 * a silent drop and not invented types.
 */

import { extractFileDirectives, parse, type FileDirective } from "@nudojs/parser";
import type { AbsModuleExports } from "@nudojs/core";
import { obj as absObj, type Abs } from "@nudojs/core";
import type { LoadModule } from "./load-module.ts";
import { bPathExportsToModuleExports } from "./abs-modules-graph.ts";
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
      error: evaled.error.includes("not found")
        ? `Mock module not found (from "${fromPath}")`
        : evaled.error,
    };
  }
  const exports = bPathExportsToModuleExports(evaled.run, parse(evaled.source), `mock-module:${fromPath}`);
  // CJS/文档示例友好：仅有 named 时合成 default 命名空间，支持
  // `import axios from "axios"` 后 `axios.get(...)`。
  if (exports.default === undefined && Object.keys(exports.named).length > 0) {
    const slots: Record<string, { value: Abs }> = {};
    for (const [k, v] of Object.entries(exports.named)) slots[k] = { value: v };
    exports.default = absObj(slots);
  }
  return { exports };
}

function pickNamed(
  mock: AbsModuleExports,
  names: string[],
): { named: Record<string, import("@nudojs/core").Abs>; default?: import("@nudojs/core").Abs } {
  const named: Record<string, import("@nudojs/core").Abs> = {};
  let def: import("@nudojs/core").Abs | undefined;
  for (const n of names) {
    if (n === "default") {
      if (mock.default) def = mock.default;
      continue;
    }
    const v = mock.named[n];
    if (v !== undefined) named[n] = v;
  }
  return def !== undefined ? { named, default: def } : { named };
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
    const named = { ...orig.named, ...overlay.named };
    const merged: AbsModuleExports = { named };
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
