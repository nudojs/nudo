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
import { abs, numLit, bigintLit } from "./abs.ts";
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
import { DIAG } from "./diag-codes.ts";

/**
 * JS 数值字面量文法（core 侧镜像 parser 的 `parseNumberLiteralExpr` /
 * `legacyLeadingZeroValue` —— 族 28 接线：core **不能**反向依赖 parser）。
 *
 * 覆盖：十进制（含指数 / 前导点 / 尾点）、`0x` / `0b` / `0o` 前缀、
 * 数字分隔符 `_`、一元 `+` / `-`、legacy 八进制（`017` ⇒ 15，sloppy 语义）、
 * `Infinity` / `NaN`、bigint 后缀 `n`。
 *
 * **不**覆盖（JS 语法错 ⇒ 不认识）：`0_1`（多位数前导 0 后跟分隔符）、
 * `1__0`（连续分隔符）、`0x`（无数字）、`1e`（指数无数字）。
 */
function parseNumericLiteral(text: string): number | bigint | undefined {
  const s = text.trim();
  if (s === "") return undefined;
  let sign = 1;
  let body = s;
  if (body.startsWith("-")) {
    sign = -1;
    body = body.slice(1).trimStart();
  } else if (body.startsWith("+")) {
    body = body.slice(1).trimStart();
  }
  if (body === "") return undefined;
  // bigint 后缀（`n`）
  if (body.endsWith("n")) {
    const d = body.slice(0, -1);
    if (d.includes("_")) return undefined; // bigint 不允许分隔符
    if (/^0[xX][0-9a-fA-F]+$/.test(d)) return BigInt(d) * BigInt(sign);
    if (/^0[bB][01]+$/.test(d)) return BigInt(d) * BigInt(sign);
    if (/^0[oO][0-7]+$/.test(d)) return BigInt(d) * BigInt(sign);
    if (/^[0-9]+$/.test(d)) return BigInt(d) * BigInt(sign);
    return undefined;
  }
  if (body.includes("__")) return undefined; // 连续分隔符非法
  const clean = body.replace(/_/g, "");
  if (clean === "") return undefined;
  if (/^0[xX][0-9a-fA-F]+$/.test(clean)) return sign * Number(BigInt(clean));
  if (/^0[bB][01]+$/.test(clean)) return sign * Number(BigInt(clean));
  if (/^0[oO][0-7]+$/.test(clean)) return sign * Number(BigInt(clean));
  if (clean === "Infinity") return sign * Infinity;
  if (clean === "NaN") return NaN;
  // legacy 八进制：`0` + 八进制数字（sloppy 语义）⇒ `017` = 15
  // ⚠ 含 `8`/`9` ⇒ 按十进制（`08` = 8）；`0_1` 这类多位数前导 0 + 分隔符是 JS 语法错
  if (/^0[0-7]+$/.test(clean) && !body.includes("_")) return sign * parseInt(clean.slice(1), 8);
  // 十进制（含指数 / 前导点 / 尾点）
  if (/^(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/.test(clean)) return sign * Number(clean);
  return undefined;
}

/**
 * JS 字符串字面量（core 侧镜像 parser 的 `scanStringLiteral` —— 族 28 接线）。
 *
 * ① **词法边界**：整段必须**恰好**是一个字符串字面量 —— 闭合引号之后还有文本
 *    （`"a" + "b"`）或内部出现未转义的同类引号 ⇒ **不认识**（不是自信的错值）。
 * ② **转义解释**：`\n` `\t` `\r` `\b` `\f` `\v` `\0` `\xNN` `\uNNNN`
 *    `\u{...}` `\\` `\"` `\'` `\/` 与行连接（`\` + 换行）都按 JS 语义解释。
 *
 * 截断字面量（`"foo\"` —— 转义符在末尾）⇒ **不认识**（与 parser 同口径，fail-closed）。
 */
function parseStringLiteralValue(text: string): string | undefined {
  const t = text.trim();
  if (t.length < 2) return undefined;
  const q = t[0];
  if (q !== '"' && q !== "'") return undefined;
  if (t[t.length - 1] !== q) return undefined;
  const inner = t.slice(1, -1);
  // ① 词法边界：内部不得出现未转义的同类引号
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === q) return undefined;
  }
  // ② 转义解释
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const n = inner[i + 1];
    if (n === undefined) return undefined; // 截断字面量
    i++;
    switch (n) {
      case "n": out += "\n"; break;
      case "t": out += "\t"; break;
      case "r": out += "\r"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "0": out += "\0"; break;
      case "x": {
        const hex = inner.slice(i + 1, i + 3);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) return undefined;
        out += String.fromCharCode(parseInt(hex, 16));
        i += 2;
        break;
      }
      case "u": {
        if (inner[i + 1] === "{") {
          const end = inner.indexOf("}", i + 1);
          if (end < 0) return undefined;
          const hex = inner.slice(i + 2, end);
          if (!/^[0-9a-fA-F]{1,6}$/.test(hex)) return undefined;
          out += String.fromCodePoint(parseInt(hex, 16));
          i = end;
        } else {
          const hex = inner.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return undefined;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        }
        break;
      }
      case "\n": break; // 行连接
      case "\r":
        if (inner[i + 1] === "\n") i++;
        break;
      default: out += n; break;
    }
  }
  return out;
}

/** C4.1：case 见证的解构字段投影（与 scan.projectArgPath 同口径）；
 *  #137：路径感知——嵌套点路径（'card.grade'）逐段下钻 */
function projectCaseArgField(arg: Abs, fieldPath: string[]): Abs | undefined {
  let cur: Abs | undefined = arg;
  for (const seg of fieldPath) {
    if (!cur) return undefined;
    if (cur.shape.k === "brand") {
      cur = cur.shape.shape as Abs;
    }
    if (cur.shape.k !== "obj") return undefined;
    cur = getSlot(cur.shape.slots, seg)?.value;
  }
  return cur;
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
    // Bug 839 / 853：数值文法不能只认十进制正则 —— 指数 / 进制 / 分隔符 /
    // 前导点 / 一元 / legacy 八进制 都是**合法** JS 写法，先前一律落 undefined
    // ⇒ 见证面直接**跳过**这些形态（假绿：契约永远不被检验）。
    // ⚠ 口径与 parser 的 `parseNumberLiteralExpr` / `legacyLeadingZeroValue` 一致
    //   （族 28 接线：core 不能反向依赖 parser ⇒ 此处镜像同一套文法）。
    const num = parseNumericLiteral(t);
    if (num !== undefined) {
      return typeof num === "bigint" ? bigintLit(num) : numLit(num);
    }
    // Bug 840 / 849 / 850：字符串必须是**单个字面量**（词法边界）且**解释转义**
    // —— 先前的贪婪切片 `/^(['"])([\s\S]*)\1$/` 把 `"a" + "b"` 折成
    // `a" + "b`（自信的错值），且 `"a\tb"` 保留字面反斜杠。
    const str = parseStringLiteralValue(t);
    if (str !== undefined) {
      return {
        shape: { k: "prim", type: "string" },
        term: { op: "lit", value: str },
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
      [
        number,
        { param: string; pred: Pred; constraint: NudoConstraint },
        string[] | undefined,
      ]
    > = [];
    for (const p of eff.params) {
      if (conflictParams.has(p.param)) continue;
      // C4.1：display 名命中失败时用 locateContractParam（默认/rest/解构
      // 顶层名）；#137：嵌套点路径（'card.grade'）带多段 fieldPath
      let idx = paramNames.indexOf(p.param);
      let fieldPath: string[] | undefined;
      if (idx < 0 && formals.length > 0) {
        const hit = locateContractParam(formals, p.param);
        if (hit) {
          idx = hit.index;
          fieldPath = hit.fieldPath ?? (hit.field !== undefined ? [hit.field] : undefined);
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
        fieldPath,
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
      const fieldPath = req[2];
      if (entry.constraint.fields) continue;
      let arg = absArgs[idx];
      if (!arg) continue;
      // C4.1：destructure 契约名 → 实参字段投影后再判 pred；
      // 缺字段不能静默跳过（与 scan.checkReqs 同口径，报 case 见证违例）
      // #137：投影走路径（嵌套 'card.grade' 逐段下钻），展示用点连接串
      if (fieldPath) {
        const projected = projectCaseArgField(arg, fieldPath);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
            const paramName = entry.param || paramNames[idx] || `arg${idx}`;
            const field = fieldPath.join(".");
            out.push({
              severity: "error",
              code: DIAG.caseInconsistency,
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
            code: DIAG.caseInconsistency,
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
          code: DIAG.caseInconsistency,
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
              code: DIAG.caseInconsistency,
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
