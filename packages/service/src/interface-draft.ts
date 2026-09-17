/**
 * `nudo interface --draft`：从已有 JS **逻辑** 生成 interface 草稿。
 *
 * 产品位（代码优先 / 迁移）：先写实现，再反推可审阅的 `fn({…}, …)` 草稿；
 * 人审后迁入 `*.nudo.js` 才成为契约。
 *
 * 证据分层（与 C0 一致：草稿 ≠ ambient 义务）：
 * - callsite / directive case → joinThenProject 值域（迁移最可信）
 * - generalize symbolic → 返回位兜底
 * - 无证据 → 参数槽省略 + 注释 TODO（不发明义务）
 * - 已有 handwritten 契约 → **跳过**（手写优先，不覆盖）
 *
 * 写盘：默认只打印；`--write` 写入 `<file>.nudo.draft.js`——**不会**被
 * sidecar 自动绑定（loadModule 只认 `*.nudo.js`）。审阅后复制进正式侧车。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  effectiveInterface,
  formatConstraint,
  formatShape,
  generalizeFromAst,
  joinThenProject,
  localNamedExports,
  sidecarPathOf,
  type Abs,
  type NudoConstraint,
} from "@nudojs/core";
import { analyzeFileAsync, type FunctionAnalysis } from "./analyzer.ts";
import type { CallRecord } from "./evaluator/call-record.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";

export type DraftEvidence = "callsite" | "directive" | "symbolic" | "none";

export type InterfaceDraftEntry = {
  fn: string;
  /** 全部形参（含无证据槽，便于人读） */
  params: Array<{
    name: string;
    constraint?: NudoConstraint;
    display: string;
    /** false = 无证据，DSL 对象里省略该槽 */
    projected: boolean;
  }>;
  returns?: { constraint?: NudoConstraint; display: string; projected: boolean };
  paramEvidence: DraftEvidence;
  returnEvidence: DraftEvidence;
  skipped?: "handwritten" | "not-an-export";
  /** 草稿 DSL：`fn({ … }, …)`；handwritten / 非导出时 undefined */
  dsl?: string;
};

export type InterfaceDraftOpts = {
  fnNames?: string[];
  records?: CallRecord[];
  loadModule?: LoadModule;
  autoBind?: boolean;
};

export type InterfaceDraftResult = {
  file: string;
  entries: InterfaceDraftEntry[];
  draftSource: string;
  sidecarPath: string;
};

function caseEvidence(fn: FunctionAnalysis): {
  paramCases: FunctionAnalysis["cases"];
  returnCases: FunctionAnalysis["cases"];
  paramEvidence: DraftEvidence;
  rawReturnEvidence: DraftEvidence;
} {
  const callsite = fn.cases.filter((c) => c.source === "callsite");
  const directive = fn.cases.filter((c) => c.source === "directive");
  return {
    paramCases: callsite.length > 0 ? callsite : directive,
    returnCases:
      callsite.length > 0 ? callsite : directive.length > 0 ? directive : fn.cases,
    paramEvidence: callsite.length > 0 ? "callsite" : directive.length > 0 ? "directive" : "none",
    rawReturnEvidence:
      callsite.length > 0 ? "callsite" : directive.length > 0 ? "directive" : "none",
  };
}

function stripBlockComments(s: string): string {
  return s.replace(/\s*\/\*[\s\S]*?\*\/\s*/g, " ").replace(/\s+/g, " ").trim();
}

function projectDraftParams(
  fn: FunctionAnalysis,
  paramCases: FunctionAnalysis["cases"],
): InterfaceDraftEntry["params"] {
  return fn.paramNames.map((name, i) => {
    const argAbs: Abs[] = [];
    for (const c of paramCases) {
      const a = c.argAbs[i];
      if (a !== undefined) argAbs.push(a);
    }
    if (argAbs.length === 0) {
      return { name, display: "/* no evidence — tighten */", projected: false };
    }
    const constraint = joinThenProject(argAbs);
    if (constraint === undefined) {
      return {
        name,
        display: `/* not projectable: ${argAbs.map((a) => formatShape(a)).join(" | ")} */`,
        projected: false,
      };
    }
    return {
      name,
      constraint,
      display: formatConstraint(constraint),
      projected: true,
    };
  });
}

function projectDraftReturn(
  fn: FunctionAnalysis,
  returnCases: FunctionAnalysis["cases"],
  source: string,
  rawEvidence: DraftEvidence,
): NonNullable<InterfaceDraftEntry["returns"]> & { evidence: DraftEvidence } {
  const retAbs: Abs[] = [];
  for (const c of returnCases) {
    if (c.throwsAbs.shape.k !== "never") continue;
    retAbs.push(c.abs);
  }
  if (retAbs.length > 0) {
    const constraint = joinThenProject(retAbs);
    if (constraint !== undefined) {
      return {
        constraint,
        display: formatConstraint(constraint),
        projected: true,
        evidence: rawEvidence === "none" ? "directive" : rawEvidence,
      };
    }
    const shapeText = fn.combinedAbs
      ? formatShape(fn.combinedAbs)
      : formatShape(retAbs[0]!);
    return {
      display: `/* not projectable: ${shapeText} */`,
      projected: false,
      evidence: rawEvidence,
    };
  }

  try {
    const g = generalizeFromAst(fn.name, source);
    if (g?.symbolic) {
      const constraint = joinThenProject([g.symbolic]);
      if (constraint !== undefined) {
        return {
          constraint,
          display: formatConstraint(constraint),
          projected: true,
          evidence: "symbolic",
        };
      }
      return {
        display: `/* symbolic: ${formatShape(g.symbolic)}${g.display ? ` — ${g.display}` : ""} */`,
        projected: false,
        evidence: "symbolic",
      };
    }
  } catch {
    /* fall through */
  }
  return { display: "/* no evidence */", projected: false, evidence: "none" };
}

/** 仅把可投影槽写进 DSL；无证据槽省略（与 emit 同口径，不发明约束） */
function draftDsl(entry: Pick<InterfaceDraftEntry, "params" | "returns">): string {
  const parts = entry.params
    .filter((p) => p.projected && p.constraint !== undefined)
    .map((p) => `${p.name}: ${formatConstraint(p.constraint!)}`);
  const obj = parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
  const ret =
    entry.returns?.projected && entry.returns.constraint !== undefined
      ? formatConstraint(entry.returns.constraint)
      : undefined;
  return ret === undefined ? `fn(${obj})` : `fn(${obj}, ${ret})`;
}

/**
 * 为单文件顶层导出生成 interface 草稿（不写盘）。
 * handwritten 跳过；已有 @generated 仍出草稿（便于对照），但正文可含刷新提示。
 */
export async function draftInterface(
  filePath: string,
  opts: InterfaceDraftOpts = {},
): Promise<InterfaceDraftResult> {
  const source = readFileSync(filePath, "utf-8");
  const projectAutoBind = interfaceConfig(
    findProjectConfig(dirname(filePath))?.config,
  ).autoBind;
  const autoBind = projectAutoBind && (opts.autoBind ?? true);
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const sidecarPath = sidecarPathOf(filePath);

  const analysis = await analyzeFileAsync(filePath, source, undefined, opts.records);
  const exported = localNamedExports(source);
  const selected =
    opts.fnNames && opts.fnNames.length > 0 ? new Set(opts.fnNames) : exported;

  const entries: InterfaceDraftEntry[] = [];
  for (const fn of analysis.functions) {
    if (!selected.has(fn.name) && !opts.fnNames?.includes(fn.name)) continue;

    if (!exported.has(fn.name)) {
      if (opts.fnNames?.includes(fn.name)) {
        entries.push({
          fn: fn.name,
          params: fn.paramNames.map((n) => ({
            name: n,
            display: "/* not an export */",
            projected: false,
          })),
          paramEvidence: "none",
          returnEvidence: "none",
          skipped: "not-an-export",
        });
      }
      continue;
    }

    const eff = effectiveInterface(source, fn.name, {
      loadModule,
      fromFile: filePath,
      ...(autoBind === false ? { autoBind: false } : {}),
    });
    if (eff?.source === "handwritten") {
      entries.push({
        fn: fn.name,
        params: eff.params.map((p) => ({
          name: p.param,
          constraint: p.constraint,
          display: formatConstraint(p.constraint),
          projected: true,
        })),
        ...(eff.returns
          ? {
              returns: {
                constraint: eff.returns.constraint,
                display: formatConstraint(eff.returns.constraint),
                projected: true,
              },
            }
          : {}),
        paramEvidence: "none",
        returnEvidence: "none",
        skipped: "handwritten",
      });
      continue;
    }

    const { paramCases, returnCases, paramEvidence, rawReturnEvidence } = caseEvidence(fn);
    const params = projectDraftParams(fn, paramCases);
    const ret = projectDraftReturn(fn, returnCases, source, rawReturnEvidence);
    const { evidence: returnEvidence, ...returns } = ret;
    entries.push({
      fn: fn.name,
      params,
      returns,
      paramEvidence,
      returnEvidence,
      dsl: draftDsl({ params, returns }),
    });
  }

  const draftSource = formatDraftModule(filePath, entries, sidecarPath);
  return { file: filePath, entries, draftSource, sidecarPath };
}

/** 草稿模块文本（人读 + 可复制到 *.nudo.js） */
export function formatDraftModule(
  filePath: string,
  entries: InterfaceDraftEntry[],
  sidecarPath?: string,
): string {
  const target = sidecarPath ?? sidecarPathOf(filePath);
  const lines: string[] = [
    "// @nudo:draft",
    `// Generated by \`nudo interface --draft\` from ${filePath}`,
    "// This *.nudo.draft.js file is NOT loaded as a sidecar contract.",
    `// Review each export, then copy it into ${target} to accept.`,
    "//",
    "// Evidence: callsite/directive = observed args; symbolic = generalize;",
    "// omitted params = no evidence (not an obligation — tighten by hand).",
    "// Handwritten contracts are never overwritten.",
    "",
    'import { fn, number, string, boolean, shape, array, lit, union } from "@nudojs/core";',
    "",
  ];

  const draftable = entries.filter((e) => e.dsl !== undefined && e.skipped === undefined);
  if (draftable.length === 0) {
    lines.push("// (no draftable exports — handwritten / non-export / empty)");
    lines.push("");
  }

  for (const e of draftable) {
    lines.push(`// ${e.fn} — param: ${e.paramEvidence}, return: ${e.returnEvidence}`);
    for (const p of e.params) {
      if (!p.projected) lines.push(`//   ${p.name}: ${p.display}`);
    }
    if (e.returns && !e.returns.projected) {
      lines.push(`//   returns: ${e.returns.display}`);
    } else if (e.returnEvidence === "symbolic") {
      lines.push(`//   returns: ${e.returns?.display ?? ""} (symbolic)`);
    }
    lines.push(`export const ${e.fn} = ${e.dsl};`);
    lines.push("");
  }

  const skipped = entries.filter((e) => e.skipped !== undefined);
  if (skipped.length > 0) {
    lines.push("// Skipped:");
    for (const s of skipped) {
      lines.push(`//   ${s.fn} (${s.skipped})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/** `lib.js` → `lib.nudo.draft.js`（不进 ambient sidecar 表） */
export function sidecarDraftPath(filePath: string): string {
  return sidecarPathOf(filePath).replace(/\.nudo\.([cm]?js)$/, ".nudo.draft.$1");
}

export type WriteDraftResult = {
  draftPath: string;
  written: boolean;
  changed: boolean;
  draftSource: string;
};

/**
 * 写入 `*.nudo.draft.js`（覆盖草稿文件本身；不碰正式 `*.nudo.js`）。
 */
export function writeInterfaceDraft(
  filePath: string,
  draftSource: string,
  opts: { dryRun?: boolean } = {},
): WriteDraftResult {
  const draftPath = sidecarDraftPath(filePath);
  const prev = existsSync(draftPath) ? readFileSync(draftPath, "utf-8") : undefined;
  const changed = prev !== draftSource;
  if (!opts.dryRun && changed) {
    writeFileSync(draftPath, draftSource, "utf-8");
  }
  return { draftPath, written: !opts.dryRun && changed, changed, draftSource };
}

export function formatDraftSummary(
  sourceRel: string,
  draftRel: string,
  result: InterfaceDraftResult,
  write?: WriteDraftResult,
): string[] {
  const lines: string[] = [sourceRel];
  for (const e of result.entries) {
    if (e.skipped === "handwritten") {
      lines.push(`  ${e.fn}  [handwritten]  skipped (draft never overwrites)`);
    } else if (e.skipped === "not-an-export") {
      lines.push(`  ${e.fn}  [not-an-export]  skipped`);
    } else if (e.dsl) {
      lines.push(`  ${e.fn}  [draft ${e.paramEvidence}/${e.returnEvidence}]  ${e.dsl}`);
    }
  }
  if (write) {
    if (write.changed) {
      lines.push(
        write.written ? `Draft written → ${draftRel}` : `[dry-run] would write → ${draftRel}`,
      );
    } else {
      lines.push(`${draftRel}: draft unchanged`);
    }
    lines.push(`  review, then copy accepted exports into ${sidecarPathOf(result.file)}`);
  } else {
    lines.push("");
    lines.push(result.draftSource.trimEnd());
  }
  return lines;
}
