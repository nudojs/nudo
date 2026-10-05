/**
 * `@nudo:case` 见证不一致（nudo:case-inconsistency）。
 *
 * 从 check.ts 拆出的内聚段：case 是契约的见证——字面量实参 ⊄ refine 即报。
 * 只检查字面量实参（数字/字符串/布尔/null）；非字面量跳过，不猜。
 * 有效契约走 effectiveInterface：只执法 handwritten（generated 段 = 事实
 * 快照不执法）；conflict 参数已由 fn 级 nudo:interface-conflict 覆盖，跳过。
 */

import { parseSource as parse } from "./parse-source.ts";
import { stripStringsKeepComments } from "./code-text.ts";
import { listFnDirectiveScopes, scanCaseTags } from "./directive-scan.ts";
import type { Abs } from "./abs.ts";
import { abs, numLit } from "./abs.ts";
import type { Pred } from "./pred.ts";
import { predToString } from "./pred.ts";
import { formatAbs } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import type { NudoConstraint } from "./constraint.ts";
import { instantiateConstraint, isIntFlag } from "./constraint.ts";
import { literalMeetsConstraint } from "./domain-membership.ts";
import { generalizeFromAst } from "./generalize.ts";
import { effectiveInterface, formatConstraint } from "./interface.ts";
import { locateContractParam } from "./param-surface.ts";
import { getSlot } from "./objects.ts";
import type { AbsModuleExports } from "./abs-modules.ts";
import type { RunTranspiledOptions } from "./exec/run.ts";

/** C4.1：case 见证的解构字段投影（与 scan.projectArgField 同口径） */
function projectCaseArgField(arg: Abs, field: string): Abs | undefined {
  if (!arg) return undefined;
  if (arg.shape.k === "brand") {
    return projectCaseArgField(arg.shape.shape as Abs, field);
  }
  if (arg.shape.k !== "obj") return undefined;
  return getSlot(arg.shape.slots, field)?.value;
}

/**
 * case 是契约的见证：`@nudo:case` 实参 ⊄ refine → nudo:case-inconsistency。
 * 只检查字面量实参（数字/字符串/布尔/null）；非字面量跳过，不猜。
 * 有效契约走 effectiveInterface：只执法 handwritten（generated 段 = 事实
 * 快照不执法）；conflict 参数已由 fn 级 nudo:interface-conflict 覆盖，跳过。
 */
// ---------------------------------------------------------------------------
// @nudo:case 见证不一致（scanCaseInconsistency）
// ---------------------------------------------------------------------------

export function scanCaseInconsistency(
  source: string,
  knownFns: string[],
  opts: {
    loadModule?: (spec: string, fromFile: string) => string | undefined;
    fromFile?: string;
    file?: ReturnType<typeof parse>;
    /** ambient 侧车存在（checkSource 预探测）：无源码 refine 时侧车契约仍需对账 */
    sidecarPresent?: boolean;
    /** 侧车 ambient 绑定开关（checkSource 的 package.json 配置下传） */
    autoBind?: boolean;
    /** 项目根：树外侧车不 ambient 绑定 */
    projectDir?: string;
    /** 宿主已求值的依赖导出表（generalize B/解释路径共用） */
    modules?: Record<string, AbsModuleExports | Record<string, unknown>>;
    /** B run 注入包（与 CheckOptions.inject 同源） */
    inject?: RunTranspiledOptions;
  },
): CheckIssue[] {
  const out: CheckIssue[] = [];
  // 快路径：无 case 指令则免整树 walk；无契约来源时 case 不可能 ⊄ 契约
  // 指令住注释——字符串里的同形文本不算命中
  const directiveSrc = stripStringsKeepComments(source);
  if (!directiveSrc.includes("@nudo:case")) return out;
  const hasContractOrigin =
    directiveSrc.includes("@nudo:contract") || opts.sidecarPresent === true;
  if (!hasContractOrigin) return out;
  const file = opts.file ?? parse(source);

  /** 解析 case 实参列表里的简单字面量 */
  const parseLitArg = (s: string): Abs | undefined => {
    const t = s.trim();
    if (t === "") return undefined;
    if (t === "true") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: true }, conf: "exact" };
    if (t === "false") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: false }, conf: "exact" };
    if (t === "null") return { shape: { k: "unknown" }, term: { op: "lit", value: null }, conf: "exact" };
    if (t === "undefined") return { shape: { k: "unknown" }, term: { op: "lit", value: undefined }, conf: "exact" };
    if (/^-?\d+(\.\d+)?$/.test(t)) return numLit(Number(t));
    const str = t.match(/^(['"])([\s\S]*)\1$/);
    if (str) {
      return {
        shape: { k: "prim", type: "string" },
        term: { op: "lit", value: str[2]! },
        conf: "exact",
      };
    }
    return undefined;
  };

  /** 从 `@nudo:case "name" (a, b)` 抽实参原文 */
  const parseCaseArgs = (raw: string): string[] | undefined => {
    const m = raw.match(/@nudo:case\s+"[^"]+"\s*\(([\s\S]*)\)/);
    if (!m) return undefined;
    const inner = m[1]!.trim();
    if (inner === "") return [];
    // 顶层逗号切分（不处理嵌套对象/数组——那些不是字面量见证）
    const parts: string[] = [];
    let depth = 0;
    let cur = "";
    let quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i]!;
      if (quote) {
        cur += ch;
        if (ch === quote && inner[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        cur += ch;
        continue;
      }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      if (ch === ")" || ch === "]" || ch === "}") depth--;
      if (ch === "," && depth === 0) {
        parts.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
  };

  const checkCaseAgainstReqs = (
    fnName: string,
    caseName: string,
    args: string[],
    line: number | undefined,
  ): void => {
    const g = generalizeFromAst(fnName, source, {
      ...(file ? { file } : {}),
      modules: opts.modules,
      ...(opts.inject ? { inject: opts.inject } : {}),
    });
    if (!g) return;
    const paramNames = g.params;
    // 有效契约单点读取：只执法 handwritten（generated/implicit 不执法）
    const eff = effectiveInterface(source, fnName, {
      loadModule: opts.loadModule,
      fromFile: opts.fromFile ?? "",
      ...(opts.autoBind !== undefined ? { autoBind: opts.autoBind } : {}),
      ...(opts.projectDir !== undefined ? { projectDir: opts.projectDir } : {}),
    });
    if (!eff || eff.source !== "handwritten") return;
    const conflictParams = new Set(eff.conflict?.params ?? []);
    const formals = g.formals ?? [];
    const reqs: Array<
      [number, { param: string; pred: Pred; constraint: NudoConstraint }, string | undefined]
    > = [];
    for (const p of eff.params) {
      if (conflictParams.has(p.param)) continue;
      // C4.1：display 名命中失败时用 locateContractParam（默认/rest/解构顶层名）
      let idx = paramNames.indexOf(p.param);
      let field: string | undefined;
      if (idx < 0 && formals.length > 0) {
        const hit = locateContractParam(formals, p.param);
        if (hit) {
          idx = hit.index;
          field = hit.field;
        }
      }
      if (idx < 0) continue;
      reqs.push([
        idx,
        {
          param: p.param,
          pred: instantiateConstraint(p.constraint, p.param),
          constraint: p.constraint,
        },
        field,
      ]);
    }
    if (reqs.length === 0) return;

    const absArgs = args.map((a) => parseLitArg(a) ?? abs({ k: "unknown" }, undefined, undefined, "partial"));
    // 标量域：eq/union 形态（lit()/union() 契约）走域隶属判定（bounds 分支
    // 判不了 eq/or，此前静默跳过 = 写了等于没写）；纯 bounds 域沿用逐原子
    // 报告（expected 保持 predToString 原文，既有输出契约零改动）
    for (const req of reqs) {
      const idx = req[0];
      const entry = req[1];
      const field = req[2];
      if (entry.constraint.fields) continue;
      let arg = absArgs[idx];
      if (!arg) continue;
      // C4.1：destructure 契约名 → 实参字段投影后再判 pred；
      // 缺字段不能静默跳过（与 scan.checkReqs 同口径，报 case 见证违例）
      if (field) {
        const projected = projectCaseArgField(arg, field);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
            const paramName = entry.param || paramNames[idx] || `arg${idx}`;
            out.push({
              severity: "error",
              code: "nudo:case-inconsistency",
              message: `${fnName} case "${caseName}": witness ⊭ contract`,
              actual: formatAbs(arg),
              expected: `missing field ${field}`,
              suggestion: `add the missing field ${field} to the case argument (contract slot ${paramName})`,
              fn: fnName,
              line,
            });
          }
          continue;
        }
        arg = projected;
      }
      // litValue 哨兵：lit(undefined)/lit(null) 也是字面量证据，须看 term
      // 后走完整域隶属（与 domain-membership / scan 同口径）。
      const argLit = arg.term?.op === "lit" ? arg.term.value : undefined;
      const argIsLit = arg.term?.op === "lit";
      if (
        !argIsLit ||
        (typeof argLit !== "number" && typeof argLit !== "string" && typeof argLit !== "boolean" && argLit !== null && argLit !== undefined)
      ) {
        continue;
      }
      const hasEqOr =
        (entry.constraint.members?.length ?? 0) > 0 ||
        entry.constraint.preds.some((p) => p.op === "eq");
      if (hasEqOr) {
        if (!literalMeetsConstraint(argLit, entry.constraint)) {
          const paramName = entry.param || paramNames[idx] || `arg${idx}`;
          out.push({
            severity: "error",
            code: "nudo:case-inconsistency",
            message: `${fnName} case "${caseName}": witness ⊭ contract`,
            actual: formatAbs(arg),
            expected: formatConstraint(entry.constraint),
            suggestion: `change the case argument, or relax the refine on ${paramName}`,
            fn: fnName,
            line,
          });
        }
        continue;
      }
      if (typeof argLit !== "number") continue;
      // Bug 1：纯 bounds 分支此前只查 gt/ge/lt/le，从不读 .int() 标志——
      // number().int()（无 range 原子）的非整数见证零检查静默通过；hasEqOr
      // 分支经 literalMeetsConstraint（domain-membership :55-61）已执法。
      // 此处补同口径判定（isIntFlag 统一读取 builder/纯数据两种形态）。
      if (isIntFlag(entry.constraint) && !Number.isInteger(argLit)) {
        const paramName = entry.param || paramNames[idx] || `arg${idx}`;
        out.push({
          severity: "error",
          code: "nudo:case-inconsistency",
          message: `${fnName} case "${caseName}": witness ⊭ contract`,
          actual: formatAbs(arg),
          expected: formatConstraint(entry.constraint),
          suggestion: `change the case argument, or relax the refine on ${paramName}`,
          fn: fnName,
          line,
        });
      }
      const flatten = (p: Pred): Pred[] => (p.op === "and" ? p.args.flatMap(flatten) : p.op === "true" ? [] : [p]);
      for (const p of flatten(entry.pred)) {
        if (
          (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
          p.b.op === "lit" &&
          typeof p.b.value === "number"
        ) {
          const n = p.b.value;
          let ok = true;
          if (p.op === "gt") ok = argLit > n;
          if (p.op === "ge") ok = argLit >= n;
          if (p.op === "lt") ok = argLit < n;
          if (p.op === "le") ok = argLit <= n;
          if (!ok) {
            const paramName = entry.param || paramNames[idx] || `arg${idx}`;
            out.push({
              severity: "error",
              code: "nudo:case-inconsistency",
              message: `${fnName} case "${caseName}": witness ⊭ contract`,
              actual: formatAbs(arg),
              expected: predToString(p),
              suggestion: `change the case argument, or relax the refine on ${paramName}`,
              fn: fnName,
              line,
            });
          }
        }
      }
    }
  };

  // D6=G2 + D5=F1：case 标签与 parser 同源（directive-scan scope 绑定 + scanCaseTags），
  // nested function / class method 上的见证同样可见。
  for (const scope of listFnDirectiveScopes(file)) {
    if (!knownFns.includes(scope.name)) continue;
    for (let ci = 0; ci < scope.commentTexts.length; ci++) {
      const text = scope.commentTexts[ci]!;
      const startLine = scope.commentStartLines[ci] ?? 0;
      for (const tag of scanCaseTags(text)) {
        const caseArgs = parseCaseArgs(`@nudo:case "${tag.name}" (${tag.argsText})`);
        if (!caseArgs) continue;
        checkCaseAgainstReqs(scope.name, tag.name, caseArgs, startLine);
      }
    }
  }
  return out;
}
