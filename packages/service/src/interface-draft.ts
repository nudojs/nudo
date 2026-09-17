/**
 * `nudo interface --draft`：从已有 JS **逻辑** 生成 interface 草稿。
 *
 * 产品位（代码优先 / 迁移）：先写实现，再反推可审阅的 `fn({…}, …)` 草稿；
 * 人审后迁入 `*.nudo.js` 才成为契约。
 *
 * 证据分层（与 C0 一致：草稿 ≠ ambient 义务）：
 * - callsite / directive case → joinThenProject 值域（迁移最可信）
 * - body 触达（**仅草稿展示**）→ 参数上被读到的字段名建议；不进 check
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
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import { analyzeFileAsync, type FunctionAnalysis } from "./analyzer.ts";
import type { CallRecord } from "./evaluator/call-record.ts";
import { defaultLoadModule, type LoadModule } from "./load-module.ts";
import { findProjectConfig, interfaceConfig } from "./evaluator/config.ts";

/**
 * DraftEvidence `body` = 仅来自函数体对形参的成员读取（草稿建议，非义务）。
 * check / effectiveInterface **永不**消费该档。
 */
export type DraftEvidence = "callsite" | "directive" | "symbolic" | "body" | "none";

export type InterfaceDraftEntry = {
  fn: string;
  /** 全部形参（含无证据槽，便于人读） */
  params: Array<{
    name: string;
    constraint?: NudoConstraint;
    display: string;
    /** false = 无证据，DSL 对象里省略该槽 */
    projected: boolean;
    /** 函数体读到的字段名（草稿建议；与 projected 无关） */
    bodyAccesses?: string[];
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
  /** 默认 true：收集 body 成员读取作草稿建议（永不进 check） */
  bodyAccesses?: boolean;
};

export type InterfaceDraftResult = {
  file: string;
  entries: InterfaceDraftEntry[];
  draftSource: string;
  sidecarPath: string;
};

/**
 * Draft-only：收集每个顶层函数形参上的成员读取键（`user.name` → name）。
 * **不是** C0 禁止的 body→义务通道——只进草稿注释/建议，check 不读此表。
 */
export function collectParamBodyAccesses(
  source: string,
): Map<string, Map<string, Set<string>>> {
  const out = new Map<string, Map<string, Set<string>>>();
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source);
  } catch {
    return out;
  }

  const keyOf = (node: Node): string | undefined => {
    if (node.type === "Identifier") return node.name;
    if (node.type === "StringLiteral") return node.value;
    return undefined;
  };

  const visitFn = (fnName: string, fnNode: Node, paramNames: Set<string>): void => {
    if (paramNames.size === 0) return;
    const byParam = new Map<string, Set<string>>();
    const walk = (node: unknown, shadowed: Set<string>): void => {
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      // 简单遮蔽：函数内同名声明不记（const user / function user）
      if (
        (n.type === "VariableDeclarator" || n.type === "FunctionDeclaration") &&
        (n.id as Node | undefined)?.type === "Identifier"
      ) {
        const id = (n.id as { name: string }).name;
        if (paramNames.has(id)) {
          shadowed = new Set(shadowed).add(id);
        }
      }
      if (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") {
        const obj = n.object as Node | undefined;
        const prop = n.property as Node | undefined;
        const computed = n.computed === true;
        if (
          obj?.type === "Identifier" &&
          paramNames.has((obj as { name: string }).name) &&
          !shadowed.has((obj as { name: string }).name) &&
          prop &&
          !computed
        ) {
          const key = keyOf(prop);
          const pname = (obj as { name: string }).name;
          if (key !== undefined) {
            if (!byParam.has(pname)) byParam.set(pname, new Set());
            byParam.get(pname)!.add(key);
          }
        }
      }
      for (const k of Object.keys(n)) {
        if (k === "loc" || k === "start" || k === "end") continue;
        const child = n[k];
        if (Array.isArray(child)) {
          for (const item of child) walk(item, shadowed);
        } else if (child && typeof child === "object") {
          walk(child, shadowed);
        }
      }
    };
    walk(fnNode, new Set());
    if (byParam.size > 0) out.set(fnName, byParam);
  };

  const paramSet = (fnNode: Node): Set<string> => {
    const names = new Set<string>();
    const params = (fnNode as { params?: Node[] }).params ?? [];
    for (const p of params) {
      if (!p) continue;
      if (p.type === "Identifier") names.add(p.name);
      else if (p.type === "AssignmentPattern" && (p.left as Node)?.type === "Identifier") {
        names.add((p.left as { name: string }).name);
      } else if (p.type === "RestElement" && (p.argument as Node)?.type === "Identifier") {
        names.add((p.argument as { name: string }).name);
      } else if (p.type === "ObjectPattern") {
        for (const prop of (p as { properties?: Node[] }).properties ?? []) {
          if (prop.type === "ObjectProperty") {
            const v = prop.value as Node;
            if (v.type === "Identifier") names.add(v.name);
            else if (v.type === "AssignmentPattern" && (v.left as Node)?.type === "Identifier") {
              names.add((v.left as { name: string }).name);
            }
          }
        }
      }
    }
    return names;
  };

  const considerDecl = (decl: Node | null | undefined, exported: boolean): void => {
    if (!decl) return;
    if (decl.type === "FunctionDeclaration" && (decl as { id?: Node }).id) {
      const id = decl.id as { name: string };
      visitFn(id.name, decl, paramSet(decl));
      return;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of (decl as { declarations?: Node[] }).declarations ?? []) {
        const id = d.id as Node | undefined;
        const init = d.init as Node | undefined;
        if (
          exported &&
          id?.type === "Identifier" &&
          init &&
          (init.type === "ArrowFunctionExpression" || init.type === "FunctionExpression")
        ) {
          visitFn((id as { name: string }).name, init, paramSet(init));
        }
      }
    }
  };

  const program = (ast as { program?: { body?: Node[] } }).program;
  for (const stmt of program?.body ?? []) {
    if (stmt.type === "ExportNamedDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "ExportDefaultDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "FunctionDeclaration") {
      // 私有函数不进 interface 档，草稿也跳过
    }
  }
  return out;
}

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

function projectDraftParams(
  fn: FunctionAnalysis,
  paramCases: FunctionAnalysis["cases"],
  bodyByParam?: Map<string, Set<string>>,
): InterfaceDraftEntry["params"] {
  return fn.paramNames.map((name, i) => {
    const bodyAccesses = bodyByParam?.has(name)
      ? [...bodyByParam.get(name)!].sort()
      : undefined;
    const argAbs: Abs[] = [];
    for (const c of paramCases) {
      const a = c.argAbs[i];
      if (a !== undefined) argAbs.push(a);
    }
    if (argAbs.length === 0) {
      if (bodyAccesses && bodyAccesses.length > 0) {
        return {
          name,
          display: `/* body-read { ${bodyAccesses.join(", ")} } — fill types when accepting */`,
          projected: false,
          bodyAccesses,
        };
      }
      return { name, display: "/* no evidence — tighten */", projected: false };
    }
    const constraint = joinThenProject(argAbs);
    if (constraint === undefined) {
      return {
        name,
        display: `/* not projectable: ${argAbs.map((a) => formatShape(a)).join(" | ")} */`,
        projected: false,
        ...(bodyAccesses ? { bodyAccesses } : {}),
      };
    }
    let display = formatConstraint(constraint);
    if (bodyAccesses && bodyAccesses.length > 0) {
      display += `  /* body also reads: ${bodyAccesses.join(", ")} */`;
    }
    return {
      name,
      constraint,
      display,
      projected: true,
      ...(bodyAccesses ? { bodyAccesses } : {}),
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

/** 仅把可投影槽写进 DSL；body 建议 / 无证据槽不发明约束 */
function draftDsl(entry: Pick<InterfaceDraftEntry, "params" | "returns">): string {
  const parts = entry.params
    .filter((p) => p.projected && p.constraint !== undefined)
    .map((p) => {
      // 去掉 body also reads 注释尾巴，保持可执行 DSL
      const pure = formatConstraint(p.constraint!).replace(/\s*\/\*[\s\S]*?\*\/\s*/g, "").trim();
      return `${p.name}: ${pure}`;
    });
  const obj = parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
  const ret =
    entry.returns?.projected && entry.returns.constraint !== undefined
      ? formatConstraint(entry.returns.constraint)
      : undefined;
  return ret === undefined ? `fn(${obj})` : `fn(${obj}, ${ret})`;
}

/** 草稿建议 DSL（注释用，不写入 export 行）：body 字段占位 */
function suggestedBodyDsl(fnName: string, params: InterfaceDraftEntry["params"]): string | undefined {
  const withBody = params.filter((p) => p.bodyAccesses && p.bodyAccesses.length > 0 && !p.projected);
  if (withBody.length === 0) return undefined;
  const parts = withBody.map((p) => {
    const fields = p.bodyAccesses!.map((k) => `${k}: /* TODO */`).join(", ");
    return `${p.name}: shape({ ${fields} })`;
  });
  return `//   suggested (body-read, not a contract): ${fnName} = fn({ ${parts.join(", ")} })`;
}

/**
 * 为单文件顶层导出生成 interface 草稿（不写盘）。
 * handwritten 跳过；已有 @generated 仍出草稿（便于对照）。
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
  const wantBody = opts.bodyAccesses !== false;

  const analysis = await analyzeFileAsync(filePath, source, undefined, opts.records);
  const exported = localNamedExports(source);
  const selected =
    opts.fnNames && opts.fnNames.length > 0 ? new Set(opts.fnNames) : exported;
  const bodyMap = wantBody ? collectParamBodyAccesses(source) : new Map();

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
    const bodyByParam = bodyMap.get(fn.name);
    const params = projectDraftParams(fn, paramCases, bodyByParam);
    const ret = projectDraftReturn(fn, returnCases, source, rawReturnEvidence);
    const { evidence: returnEvidence, ...returns } = ret;

    let evidence: DraftEvidence = paramEvidence;
    if (evidence === "none") {
      const anyBody = params.some((p) => p.bodyAccesses && p.bodyAccesses.length > 0);
      if (anyBody) evidence = "body";
    }

    entries.push({
      fn: fn.name,
      params,
      returns,
      paramEvidence: evidence,
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
    "// Evidence: callsite/directive = observed args; body = fields the",
    "// implementation reads (suggestion only — never a check obligation);",
    "// symbolic = generalize; omitted params = no evidence.",
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
      if (!p.projected || (p.display.includes("/*") && p.bodyAccesses?.length)) {
        if (!p.projected || p.display.includes("body also reads")) {
          lines.push(`//   ${p.name}: ${p.display}`);
        }
      }
    }
    const suggested = suggestedBodyDsl(e.fn, e.params);
    if (suggested) lines.push(suggested);
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
