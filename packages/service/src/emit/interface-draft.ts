/**
 * `nudo contract --draft`：从已有 JS **逻辑** 生成 contract 草稿。
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

import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import {
  effectiveInterface,
  formatConstraint,
  formatShape,
  generalizeFromAst,
  isIntFlag,
  joinThenProject,
  localNamedExports,
  sidecarPathOf,
  type Abs,
  type NudoConstraint,
} from "@nudojs/core";
import { parse } from "@nudojs/parser";
import type { Node } from "@babel/types";
import { analyzeFileAsync, type FunctionAnalysis } from "../analyzer.ts";
import type { CallRecord } from "../evaluator/call-record.ts";
import { defaultLoadModule, type LoadModule } from "../load-module.ts";

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
  /**
   * Accepted for API compatibility; **ignored**. The handwritten-contract probe
   * always uses `effectiveInterface(..., { autoBind: true })` so draft skips
   * disk sidecars even when ambient autoBind is off (product: draft asks
   * "does a contract already exist?", not "is ambient binding on?").
   */
  autoBind?: boolean;
  /** 默认 true：收集 body 成员读取作草稿建议（永不进 check） */
  bodyAccesses?: boolean;
  /** 打开 buffer 源（E5：与 hover/interface 同口径） */
  source?: string;
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

  const visitClassMethods = (className: string, classNode: Node): void => {
    const body = (classNode as { body?: { body?: Node[] } }).body?.body ?? [];
    for (const m of body) {
      const mem = m as {
        type?: string;
        kind?: string;
        static?: boolean;
        key?: { type?: string; name?: string };
        value?: Node;
        body?: Node;
      };
      const isMethod =
        mem.type === "MethodDefinition" ||
        mem.type === "ClassMethod" ||
        mem.type === "TSDeclareMethod";
      if (!isMethod || mem.static) continue;
      if (mem.kind && mem.kind !== "method") continue;
      const keyName = mem.key?.type === "Identifier" ? mem.key.name : undefined;
      if (!keyName) continue;
      const methodNode =
        mem.type === "MethodDefinition" ? (mem.value as Node | undefined) : (mem as unknown as Node);
      if (!methodNode) continue;
      visitFn(`${className}.${keyName}`, methodNode, paramSet(methodNode));
    }
  };

  const considerDecl = (decl: Node | null | undefined, exported: boolean): void => {
    if (!decl) return;
    if (decl.type === "FunctionDeclaration" && (decl as { id?: Node }).id) {
      const id = decl.id as { name: string };
      visitFn(id.name, decl, paramSet(decl));
      return;
    }
    if (decl.type === "ClassDeclaration" && (decl as { id?: { name?: string } }).id?.name) {
      visitClassMethods((decl.id as { name: string }).name, decl);
      return;
    }
    if (decl.type === "VariableDeclaration") {
      for (const d of (decl as { declarations?: Array<{ id?: Node; init?: Node }> }).declarations ?? []) {
        const id = d.id;
        const init = d.init;
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
  const bodyStmts = program?.body ?? [];
  for (const stmt of bodyStmts) {
    if (stmt.type === "ExportNamedDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
      // export { Foo } → 本地 class 方法 body
      for (const spec of (stmt as { specifiers?: Node[] }).specifiers ?? []) {
        const local = (spec as { local?: { type?: string; name?: string } }).local;
        if (local?.type !== "Identifier") continue;
        for (const s2 of bodyStmts) {
          if (
            s2.type === "ClassDeclaration" &&
            (s2 as { id?: { name?: string } }).id?.name === local.name
          ) {
            visitClassMethods(local.name!, s2);
          }
        }
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      considerDecl((stmt as { declaration?: Node }).declaration, true);
    } else if (stmt.type === "ClassDeclaration") {
      const id = (stmt as { id?: { name?: string } }).id;
      if (id?.name) visitClassMethods(id.name, stmt);
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

/**
 * Draft DSL 可复制约束的安全化：callsite 观测是使用下界，不是义务上界。
 * 去掉纯 eq-lit 字面量约束（lit(21) / union of lits）→ 只保留类型/形状；
 * bounds/shape 保留（有指导意义）。返回 widened 约束；无实质类型信息则 undefined。
 */
function widenDraftConstraint(c: NudoConstraint): NudoConstraint | undefined {
  const stripEqLits = <T extends { op: string; b?: { op?: string } }>(preds: readonly T[]): T[] =>
    preds.filter((p) => !(p.op === "eq" && p.b?.op === "lit"));
  if (c.members && c.members.length > 0) {
    // union：成员全是 lit → 无法表达联合义务，退化为成员 prim 并集或跳过
    const widenedMembers = c.members
      .map(widenDraftConstraint)
      .filter((m): m is NudoConstraint => m !== undefined);
    if (widenedMembers.length === 0) {
      // 全是纯 lit：用 prim 推断（number/string/boolean），不写 eq
      const prim = litPrimOf(c.members[0]);
      if (!prim) return undefined;
      return { __nudoConstraint: true, prim, preds: [] } as NudoConstraint;
    }
    const prims = new Set(widenedMembers.map((m) => m.prim).filter(Boolean));
    if (prims.size === 1 && widenedMembers.every((m) => !m.fields && !m.element && !m.members)) {
      return { __nudoConstraint: true, prim: [...prims][0], preds: [] } as NudoConstraint;
    }
    return {
      __nudoConstraint: true,
      ...(c.prim ? { prim: c.prim } : {}),
      preds: stripEqLits(c.preds ?? []),
      members: widenedMembers,
    } as NudoConstraint;
  }
  if (c.fields) {
    const fields: Record<string, { constraint: NudoConstraint; optional?: boolean }> = {};
    for (const [k, f] of Object.entries(c.fields)) {
      const w = widenDraftConstraint(f.constraint);
      if (!w) continue;
      fields[k] = { constraint: w, ...(f.optional ? { optional: true } : {}) };
    }
    return {
      __nudoConstraint: true,
      fields,
      preds: stripEqLits(c.preds ?? []),
    } as NudoConstraint;
  }
  if (c.element) {
    const el = widenDraftConstraint(c.element);
    return {
      __nudoConstraint: true,
      preds: stripEqLits(c.preds ?? []),
      ...(el ? { element: el } : {}),
    } as NudoConstraint;
  }
  if (c.fn) return undefined; // 草稿 DSL 不写一等函数义务
  const preds = stripEqLits(c.preds ?? []);
  const hasBounds = preds.length > 0;
  if (!c.prim && !hasBounds && !isIntFlag(c)) return undefined;
  return {
    __nudoConstraint: true,
    ...(c.prim ? { prim: c.prim } : {}),
    preds,
    // builder 上 .int 是链式方法，truthy 恒真；必须经 isIntFlag
    ...(isIntFlag(c) ? { int: true } : {}),
  } as NudoConstraint;
}

function litPrimOf(c: NudoConstraint | undefined): "number" | "string" | "boolean" | undefined {
  if (!c) return undefined;
  if (c.prim === "number" || c.prim === "string" || c.prim === "boolean") return c.prim;
  type PredWithB = { op: string; b?: { op?: string; value?: unknown } };
  const eq = (c.preds as readonly PredWithB[] | undefined)?.find(
    (p) => p.op === "eq" && p.b?.op === "lit",
  );
  const v = eq && eq.b?.op === "lit" ? eq.b.value : undefined;
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  return c.members?.[0] ? litPrimOf(c.members[0]) : undefined;
}

function projectDraftParams(
  fn: FunctionAnalysis,
  paramCases: FunctionAnalysis["cases"],
  bodyByParam?: Map<string, Set<string>>,
  formals?: FunctionAnalysis["formals"],
): InterfaceDraftEntry["params"] {
  const bodyFor = (name: string, index: number): Set<string> | undefined => {
    if (!bodyByParam) return undefined;
    const hit = bodyByParam.get(name);
    if (hit) return hit;
    // destructure 形参 display 名是 `_p{i}`，body map 键是顶层绑定名
    const formal = formals?.[index];
    if (formal && formal.kind === "pattern") {
      for (const b of formal.bound) {
        const boundHit = bodyByParam.get(b);
        if (boundHit) return boundHit;
      }
    }
    return bodyByParam.get(`_p${index}`);
  };
  return fn.paramNames.map((name, i) => {
    const bodyAccesses = bodyFor(name, i)
      ? [...bodyFor(name, i)!].sort()
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
    const raw = joinThenProject(argAbs);
    if (raw === undefined) {
      return {
        name,
        display: `/* not projectable: ${argAbs.map((a) => formatShape(a)).join(" | ")} */`,
        projected: false,
        ...(bodyAccesses ? { bodyAccesses } : {}),
      };
    }
    // DSL 义务位：widen 字面量观测，避免单点 callsite 成为硬契约
    const constraint = widenDraftConstraint(raw);
    if (constraint === undefined) {
      const observed = formatConstraint(raw);
      return {
        name,
        display: `/* observed: ${observed} — widen/confirm before accepting */`,
        projected: false,
        ...(bodyAccesses ? { bodyAccesses } : {}),
      };
    }
    let display = formatConstraint(constraint);
    const observed = formatConstraint(raw);
    if (observed !== display) {
      display += `  /* observed: ${observed} */`;
    }
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
  loadModule?: LoadModule,
  fromFile?: string,
): NonNullable<InterfaceDraftEntry["returns"]> & { evidence: DraftEvidence } {
  const retAbs: Abs[] = [];
  for (const c of returnCases) {
    if (c.throwsAbs.shape.k !== "never") continue;
    retAbs.push(c.abs);
  }
  if (retAbs.length > 0) {
    const raw = joinThenProject(retAbs);
    if (raw !== undefined) {
      // body/none 证据：返回义务不得进 DSL（求值投影是使用事实，不是契约）
      if (rawEvidence === "none" || rawEvidence === "body") {
        return {
          display: `/* observed: ${formatConstraint(raw)} — confirm before accepting */`,
          projected: false,
          evidence: rawEvidence === "none" ? "body" : rawEvidence,
        };
      }
      const constraint = widenDraftConstraint(raw);
      if (constraint === undefined) {
        return {
          display: `/* observed: ${formatConstraint(raw)} — widen/confirm */`,
          projected: false,
          evidence: rawEvidence,
        };
      }
      return {
        constraint,
        display: formatConstraint(constraint),
        projected: true,
        evidence: rawEvidence,
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
    const g = generalizeFromAst(fn.name, source, {
      refine: {
        ...(loadModule ? { loadModule } : {}),
        ...(fromFile ? { fromFile } : {}),
      },
    });
    if (g?.symbolic) {
      // symbolic 返回：默认只注释，不写 DSL 义务
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

/** draft 用 builder JS：shape 字段可选写成 `k: T.optional()`，不用非法的 `k?: T`。
 * 导出供单测：formatConstraint 显示层可吐 `email?:`，落盘 DSL 不得非法。 */
export function toDraftBuilderDsl(display: string): string {
  const s = display.replace(/\s*\/\*[\s\S]*?\*\/\s*/g, "").trim();
  // 仅改写带 ? 的字段：email?: string() → email: string().optional()
  return s.replace(
    /([A-Za-z_$][\w$]*)\?\s*:\s*([^,}\n]+)/g,
    (_m, name: string, val: string) => {
      const v = val.trim();
      if (v.includes(".optional()")) return `${name}: ${v}`;
      return `${name}: ${v}.optional()`;
    },
  );
}

/** 草稿 export 名：`Class.method` → 合法标识符 `Class_method`（C4.2 侧车键） */
function draftExportName(fnName: string): string {
  return fnName.includes(".") ? fnName.replace(/\./g, "_") : fnName;
}

/** 仅把可投影槽写进 DSL；body 建议 / 无证据槽不发明约束 */
function draftDsl(entry: Pick<InterfaceDraftEntry, "params" | "returns">): string {
  const parts = entry.params
    .filter((p) => p.projected && p.constraint !== undefined)
    .map((p) => {
      const pure = toDraftBuilderDsl(formatConstraint(p.constraint!));
      return `${p.name}: ${pure}`;
    });
  const obj = parts.length === 0 ? "{}" : `{ ${parts.join(", ")} }`;
  const ret =
    entry.returns?.projected && entry.returns.constraint !== undefined
      ? toDraftBuilderDsl(formatConstraint(entry.returns.constraint))
      : undefined;
  return ret === undefined || ret === "" ? `fn(${obj})` : `fn(${obj}, ${ret})`;
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
  const source = opts.source ?? readFileSync(filePath, "utf-8");
  // 手写契约探测始终 autoBind:true（见下方 effectiveInterface 调用注释）；
  // 项目 autoBind 只影响 ambient 执法，不影响 draft 是否 skip 已有侧车。
  const loadModule = opts.loadModule ?? defaultLoadModule;
  const sidecarPath = sidecarPathOf(filePath);
  const wantBody = opts.bodyAccesses !== false;

  // E5：draft 分析与 hover/interface 同口径（buffer-aware loadModule）
  const analysis = await analyzeFileAsync(filePath, source, undefined, opts.records, loadModule);
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

    // draft 探测「契约是否已存在」：不依赖 ambient autoBind 执法开关。
    // autoBind=false 项目下磁盘侧车仍应 skip，避免草稿覆盖手写契约。
    const eff = effectiveInterface(source, fn.name, {
      loadModule,
      fromFile: filePath,
      autoBind: true,
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
    const params = projectDraftParams(fn, paramCases, bodyByParam, fn.formals);
    const ret = projectDraftReturn(fn, returnCases, source, rawReturnEvidence, loadModule, filePath);
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

/** 草稿模块文本（人读 + 可复制到 *.nudo.js / *.nudo.ts） */
export function formatDraftModule(
  filePath: string,
  entries: InterfaceDraftEntry[],
  sidecarPath?: string,
): string {
  const target = sidecarPath ?? sidecarPathOf(filePath);
  const draftName = sidecarDraftPath(filePath).split(/[/\\]/).pop() ?? "*.nudo.draft.js";
  const draftable = entries.filter((e) => e.dsl !== undefined && e.skipped === undefined);
  // 只 import 草稿里实际用到的 builder（避免恒注入未使用符号）
  const BUILDERS = ["fn", "number", "string", "boolean", "any", "shape", "array", "lit", "union"] as const;
  const used = new Set<string>(["fn"]);
  for (const e of draftable) {
    const blob = `${e.dsl ?? ""}\n${suggestedBodyDsl(e.fn, e.params) ?? ""}`;
    for (const b of BUILDERS) {
      if (new RegExp(`\\b${b}\\b`).test(blob)) used.add(b);
    }
  }
  const importList = BUILDERS.filter((b) => used.has(b)).join(", ");
  const lines: string[] = [
    "// @nudo:draft",
    `// Generated by \`nudo contract --draft\` from ${filePath}`,
    `// This ${draftName} file is NOT loaded as a sidecar contract.`,
    `// Review each export, then copy it into ${target} to accept.`,
    "//",
    "// Evidence: callsite/directive = observed args; body = fields the",
    "// implementation reads (suggestion only — never a check obligation);",
    "// symbolic = generalize; omitted params = no evidence.",
    "// Handwritten contracts are never overwritten.",
    "",
    `import { ${importList} } from "@nudojs/core";`,
    "",
  ];

  if (draftable.length === 0) {
    lines.push("// (no draftable exports — handwritten / non-export / empty)");
    lines.push("");
  }

  for (const e of draftable) {
    lines.push(`// ${e.fn} — param: ${e.paramEvidence}, return: ${e.returnEvidence}`);
    for (const p of e.params) {
      // 未投影槽位、body-read 提示、以及已投影参数上的 `/* observed …` 对照
      // 都以注释形式进草稿（DSL 行只保留可接受的约束）。
      if (!p.projected) {
        lines.push(`//   ${p.name}: ${p.display}`);
      } else if (p.display.includes("/* observed") || p.display.includes("/* body also reads")) {
        lines.push(`//   ${p.name}: ${p.display}`);
      }
    }
    const suggested = suggestedBodyDsl(e.fn, e.params);
    if (suggested) lines.push(suggested);
    if (e.returns && !e.returns.projected) {
      lines.push(`//   returns: ${e.returns.display}`);
    } else if (e.returns?.display.includes("/* observed")) {
      lines.push(`//   returns: ${e.returns.display}`);
    } else if (e.returnEvidence === "symbolic") {
      lines.push(`//   returns: ${e.returns?.display ?? ""} (symbolic)`);
    }
    lines.push(`export const ${draftExportName(e.fn)} = ${e.dsl};`);
    if (e.fn.includes(".")) {
      lines.push(`//   sidecar key may also be written as \`${e.fn}\` / nested { ${e.fn.split(".")[1]}: … }`);
    }
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

/** `lib.js|ts` → `lib.nudo.draft.js|ts`（不进 ambient sidecar 表） */
export function sidecarDraftPath(filePath: string): string {
  return sidecarPathOf(filePath).replace(/\.nudo\.([cm]?[jt]s)$/, ".nudo.draft.$1");
}

export type WriteDraftResult = {
  draftPath: string;
  written: boolean;
  changed: boolean;
  draftable: boolean;
  draftSource: string;
};

/** realpath both sides so /tmp vs /private/var (macOS) cannot fail projectDir containment */
function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    try {
      return join(realpathSync(dirname(p)), basename(p));
    } catch {
      return p;
    }
  }
}

/** Parse-layer draftable: at least one entry has generated DSL and was not skipped */
export function isDraftableEntry(entries: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" | "skipped">>): boolean {
  return entries.some((e) => e.dsl !== undefined && e.skipped === undefined);
}

/**
 * 写入 `*.nudo.draft.js`（覆盖草稿文件本身；不碰正式 `*.nudo.js`）。
 * 基础路径防护：拒绝 node_modules；拒绝 draft 路径与正式侧车重合；
 * 拒绝 draft 路径落在源文件目录之外的穿越。
 *
 * `opts.entries` / `opts.draftable`：解析层判定（优先）。缺省时用 Unicode
 * 感知 export 正则兜底——`\w` 会静默丢掉 `计算` 这类标识符。
 */
export function writeInterfaceDraft(
  filePath: string,
  draftSource: string,
  opts: {
    dryRun?: boolean;
    projectDir?: string;
    entries?: ReadonlyArray<Pick<InterfaceDraftEntry, "dsl" | "skipped">>;
    draftable?: boolean;
  } = {},
): WriteDraftResult {
  const draftPath = sidecarDraftPath(filePath);
  const formalPath = sidecarPathOf(filePath);
  if (draftPath === formalPath) {
    throw new Error(
      `draft write refused: draft path equals formal sidecar (${formalPath}); never overwrite handwritten contracts`,
    );
  }
  if (/[/\\]node_modules[/\\]/.test(draftPath) || /[/\\]node_modules[/\\]/.test(filePath)) {
    throw new Error(`draft write refused: path is inside node_modules (${draftPath})`);
  }
  if (opts.projectDir) {
    const rootReal = safeRealpath(opts.projectDir);
    const draftReal = safeRealpath(draftPath);
    const rel = relative(rootReal, draftReal);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`draft write refused: outside project root ${opts.projectDir}`);
    }
  }
  // 无可写 export 的空草稿不落盘（避免覆盖已有 draft 壳 / 误写正式侧车）
  const draftable =
    opts.draftable !== undefined
      ? opts.draftable
      : opts.entries !== undefined
        ? isDraftableEntry(opts.entries)
        : /export\s+const\s+[\p{ID_Start}$_][\p{ID_Continue}$]*\s*=/u.test(draftSource);
  const prev = existsSync(draftPath) ? readFileSync(draftPath, "utf-8") : undefined;
  const changed = prev !== draftSource;
  const written = !opts.dryRun && changed && draftable;
  if (written) {
    writeFileSync(draftPath, draftSource, "utf-8");
  }
  return {
    draftPath,
    written,
    changed,
    draftable,
    draftSource,
  };
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
    if (write.changed && write.draftable) {
      lines.push(
        write.written ? `Draft written → ${draftRel}` : `[dry-run] would write → ${draftRel}`,
      );
    } else if (write.changed && !write.draftable) {
      // attempted entries (skipped/handwritten) must not be reported as "empty"
      if (result.entries.length > 0) {
        const skipped = result.entries.filter((e) => e.skipped !== undefined).length;
        lines.push(
          skipped > 0
            ? `Draft not written (${skipped} skipped, no writeable exports); nothing written → ${draftRel}`
            : `Draft not written (no writeable exports); nothing written → ${draftRel}`,
        );
      } else {
        lines.push(`Draft empty (no draftable exports); nothing written → ${draftRel}`);
      }
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
