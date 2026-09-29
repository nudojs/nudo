/**
 * Shared mock-file evaluation: resolve the mock path, run it through the
 * abs module graph (so relative imports inside the mock resolve), and return
 * the evaluator export table.
 *
 * Lives apart from mock-abs / mock-module to keep the import graph acyclic:
 *   mock-file → abs-modules-graph (no reverse)
 */

import { tryRunTranspiled, type AbsModuleExports } from "@nudojs/core";
import type { LoadModule } from "./load-module.ts";
import { defaultLoadModule } from "./load-module.ts";
import { resolveLoadSpecPath } from "./env-path-deps.ts";
import { evalAbsModuleGraph } from "./abs-modules-graph.ts";

export type MockFileEval =
  | {
      ok: true;
      run: Record<string, unknown>;
      absPath: string;
      source: string;
      modules: Record<string, AbsModuleExports>;
    }
  | {
      ok: false;
      error: string;
      /** not-found = mock 文件本身缺失；graph/eval = 依赖解析或求值失败（fail-closed） */
      kind: "not-found" | "graph-failed" | "eval-failed";
    };

/**
 * Evaluate a mock file with its own relative-import graph.
 * `fromPath` is resolved against `fromFile`; the module graph entry is the
 * **absolute** mock path so `../lib/x.js` inside the mock resolves correctly.
 *
 * Fail-closed: dependency-graph failure (throw or missing dep) is `ok:false`,
 * never a silent `modules = {}` that binds imports to unknown.
 */
export function evalMockFileWithDeps(
  fromPath: string,
  fromFile: string,
  loadModule?: LoadModule,
): MockFileEval {
  const load = loadModule ?? defaultLoadModule;
  let source: string | undefined;
  try {
    source = load(fromPath, fromFile);
  } catch {
    source = undefined;
  }
  if (source === undefined) {
    return { ok: false, kind: "not-found", error: `Mock file not found (from "${fromPath}")` };
  }
  // Module-graph entry must be absolute so relative imports inside the mock
  // (`../lib/config.js`) resolve against the mock file, not the analyzed file.
  const entryFile = resolveLoadSpecPath(fromPath, fromFile) ?? fromPath;

  let modules: Record<string, AbsModuleExports>;
  try {
    const graph = evalAbsModuleGraph(source, entryFile, { loadModule });
    // 依赖解析失败（缺文件）≠ 软降级：不得带着空/缺 import 表继续求值
    const missing = graph.issues.filter((i) => i.kind === "missing");
    if (missing.length > 0) {
      return {
        ok: false,
        kind: "graph-failed",
        error: `Mock file "${fromPath}" failed to resolve dependencies: ${missing
          .map((i) => i.reason)
          .join("; ")}`,
      };
    }
    modules = graph.modules;
  } catch (e) {
    return {
      ok: false,
      kind: "graph-failed",
      error: `Mock file "${fromPath}" failed to resolve dependencies: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
  let run: Record<string, unknown> | undefined;
  try {
    // exec: mock files must evaluate top-level bindings/exports
    run = tryRunTranspiled(source, {
      mode: "exec",
      modules: modules as never,
    });
  } catch {
    run = undefined;
  }
  if (!run) {
    return { ok: false, kind: "eval-failed", error: `Mock file "${fromPath}" failed to evaluate` };
  }
  return {
    ok: true,
    run,
    absPath: entryFile,
    source,
    modules,
  };
}
