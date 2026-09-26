import { parse } from '@nudojs/parser';
import {
  runTranspiled,
  callTranspiledExportFull,
  setBCallCollector,
  abs as makeAbs,
  type Abs,
  type AbsModuleExports,
} from '@nudojs/core';
import type { CallsiteResult } from './types';

/** Lines in the usage-site file where `name` is invoked — a record on one of
 * these lines is a usage-site call; anything else is a library-internal
 * (e.g. recursive) call recorded while the dependency was evaluated. */
export function findUsageCallLines(ast: unknown, name: string): Set<number> {
  const lines = new Set<number>();
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as Record<string, unknown>;
    if (
      n['type'] === 'CallExpression' &&
      (n['callee'] as Record<string, unknown> | undefined)?.['type'] === 'Identifier' &&
      ((n['callee'] as Record<string, unknown>)['name'] as string) === name
    ) {
      const loc = n['loc'] as Record<string, Record<string, number>> | undefined;
      if (loc?.start?.line !== undefined) lines.add(loc.start.line);
    }
    for (const key of Object.keys(n)) {
      if (key === 'loc' || key === 'range' || key === 'comments') continue;
      visit(n[key]);
    }
  };
  visit(ast);
  return lines;
}

export function discoverCallsites(
  libCode: string,
  testCode: string,
  exportName: string,
  paramCount: number,
): CallsiteResult {
  const unknownAbs = (): Abs => makeAbs({ k: "unknown" }, undefined, undefined, "partial");
  const result: CallsiteResult = {
    records: [],
    beforeArgs: Array.from({ length: paramCount }, () => unknownAbs()),
    before: null,
    afterArgs: null,
    after: null,
    afterSource: '',
    error: null,
  };

  let libProgram: any;
  try {
    libProgram = parse(libCode).program;
  } catch (e) {
    result.error = `library parse error: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }

  let testProgram: any;
  try {
    testProgram = parse(testCode).program;
  } catch (e) {
    result.error = `usage-site parse error: ${e instanceof Error ? e.message : String(e)}`;
    return result;
  }

  // Evaluate the library once via the B run, inject its exports under './util',
  // then run the usage site (exec + lenient globals) with B call collection.
  const records: { fnName: string; args: Abs[]; result: Abs; callLoc?: { line: number; column: number }; threw?: boolean }[] = [];
  let libRun: Record<string, unknown> | undefined;
  try {
    libRun = runTranspiled(libCode, { mode: "analyze" });
    const libExports: AbsModuleExports = { named: {} };
    for (const [name, v] of Object.entries(libRun)) {
      if (v === undefined || v === null) continue;
      if (v && typeof v === "object" && "shape" in (v as object)) {
        libExports.named[name] = v as Abs;
      } else {
        // 裸 JS 函数导出：占位 fn 形状（导入绑定侧按 JS 函数直调）
        libExports.named[name] = makeAbs({ k: "fn", params: [] }, undefined, undefined, "exact");
      }
    }
    const modules: Record<string, AbsModuleExports> = {
      './util': libExports,
      './util.js': libExports,
    };
    const prev = setBCallCollector((r) => records.push(r));
    try {
      runTranspiled(testCode, { mode: "exec", modules, lenientGlobals: true });
    } finally {
      setBCallCollector(prev);
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  const relevant = records.filter((r) => r.fnName === exportName);

  const usageLines = findUsageCallLines(testProgram, exportName);
  result.records = relevant.map((r) => ({
    fnName: r.fnName,
    line: r.callLoc?.line,
    internal: !(r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line)),
    args: r.args,
    result: r.threw ? makeAbs({ k: "never" }, undefined, undefined, "exact") : r.result,
  }));

  // Signature synthesis: entry-only (all params unknown) vs the injection of
  // the first usage-site record's argument types.
  try {
    if (libRun) {
      result.before = callTranspiledExportFull(libRun, exportName, result.beforeArgs).result;
      const topRecord = relevant.find(
        (r) => r.callLoc?.line !== undefined && usageLines.has(r.callLoc.line),
      );
      if (topRecord) {
        result.afterArgs = topRecord.args;
        result.after = callTranspiledExportFull(libRun, exportName, topRecord.args).result;
        result.afterSource = `call@test.js:${topRecord.callLoc?.line}`;
      }
    }
  } catch (e) {
    result.error = result.error ?? (e instanceof Error ? e.message : String(e));
  }

  if (!result.before && !result.error) {
    result.error = `export "${exportName}" not found in library code`;
  }

  return result;
}
