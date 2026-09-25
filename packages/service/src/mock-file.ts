/**
 * Shared mock-file evaluation: resolve the mock path, run it through the
 * abs module graph (so relative imports inside the mock resolve), and return
 * the B-path export table.
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
  | { ok: false; error: string };

/**
 * Evaluate a mock file with its own relative-import graph.
 * `fromPath` is resolved against `fromFile`; the module graph entry is the
 * **absolute** mock path so `../lib/x.js` inside the mock resolves correctly.
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
    return { ok: false, error: `Mock file not found (from "${fromPath}")` };
  }
  // Module-graph entry must be absolute so relative imports inside the mock
  // (`../lib/config.js`) resolve against the mock file, not the analyzed file.
  const entryFile = resolveLoadSpecPath(fromPath, fromFile) ?? fromPath;

  let modules: Record<string, AbsModuleExports> = {};
  try {
    modules = evalAbsModuleGraph(source, entryFile, { loadModule }).modules;
  } catch {
    modules = {};
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
    return { ok: false, error: `Mock file "${fromPath}" failed to evaluate` };
  }
  return {
    ok: true,
    run,
    absPath: entryFile,
    source,
    modules,
  };
}
