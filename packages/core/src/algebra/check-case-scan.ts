/**
 * `@nudo:case` 见证不一致（nudo:case-inconsistency）。
 *
 * 从 check.ts 拆出的内聚段：case 是契约的见证——字面量实参 ⊄ refine 即报。
 * 实参解析与切分**与共享单源同口径**（parser 的 `splitTopLevelArgs` +
 * JSDoc 续行前缀剥离）：标量（数字/字符串/布尔/null/undefined）与结构
 * （对象 / 数组字面量）都参与对账；**认不出的实参产可见诊断**
 * （nudo:directive-syntax），不再静默跳过。
 * 有效契约走 effectiveInterface：只执法 handwritten（generated 段 = 事实
 * 快照不执法）；conflict 参数已由 fn 级 nudo:interface-conflict 覆盖，跳过。
 */

import { parseSource as parse } from "./parse-source.ts";
import { stripStringsKeepComments } from "./code-text.ts";
import { listFnDirectiveScopes, scanCaseTags } from "./directive-scan.ts";
import type { Abs } from "./abs.ts";
import { abs, numLit, bigintLit } from "./abs.ts";
import type { Pred, PrimName } from "./pred.ts";
import { predToString } from "./pred.ts";
import { formatAbs } from "./format.ts";
import type { CheckIssue } from "./check-report.ts";
import type { NudoConstraint } from "./constraint.ts";
import {
  instantiateConstraint,
  isIntFlag,
  derefConstraint,
  CONSTRAINT_EXPR_RE,
  LAZY_TEMPLATE_DEPTH,
} from "./constraint.ts";
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

/**
 * case 实参原文 → 标量 Abs（core 侧镜像 parser 的 `parseCaseArgExpr` 标量分支）。
 *
 * Bug 839 / 853：数值文法不能只认十进制正则 —— 指数 / 进制 / 分隔符 /
 * 前导点 / 一元 / legacy 八进制 都是**合法** JS 写法，先前一律落 undefined
 * ⇒ 见证面直接**跳过**这些形态（假绿：契约永远不被检验）。
 * ⚠ 口径与 parser 的 `parseNumberLiteralExpr` / `legacyLeadingZeroValue` 一致
 *   （族 28 接线：core 不能反向依赖 parser ⇒ 此处镜像同一套文法）。
 * Bug 840 / 849 / 850：字符串必须是**单个字面量**（词法边界）且**解释转义**
 * —— 先前的贪婪切片 `/^(['"])([\s\S]*)\1$/` 把 `"a" + "b"` 折成
 * `a" + "b`（自信的错值），且 `"a\tb"` 保留字面反斜杠。
 *
 * **不认识 ⇒ undefined**（调用方据此产**可见诊断**，不再静默跳过）。
 */
function parseScalarArgAbs(s: string): Abs | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  if (t === "true") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: true }, conf: "exact" };
  if (t === "false") return { shape: { k: "prim", type: "boolean" }, term: { op: "lit", value: false }, conf: "exact" };
  if (t === "null") return { shape: { k: "unknown" }, term: { op: "lit", value: null }, conf: "exact" };
  if (t === "undefined") return { shape: { k: "unknown" }, term: { op: "lit", value: undefined }, conf: "exact" };
  const num = parseNumericLiteral(t);
  if (num !== undefined) {
    return typeof num === "bigint" ? bigintLit(num) : numLit(num);
  }
  const str = parseStringLiteralValue(t);
  if (str !== undefined) {
    return {
      shape: { k: "prim", type: "string" },
      term: { op: "lit", value: str },
      conf: "exact",
    };
  }
  return undefined;
}

/**
 * 顶层逗号切分（字符串感知；**`\` 不是转义**）——**共享单源口径**。
 *
 * 共享单源 = parser 的 `splitTopLevelArgs`
 * （`packages/parser/src/directives/expr-scan.ts`）≡ core 的
 * `extractBalancedParens`（`directive-scan.ts`）：引号内 `\` **不是**转义
 * ⇒ `"a\", -1` 在 `"a\"` 处闭合 ⇒ 实参个数 = 2。
 *
 * ⚠ Bug 1009：check 面此前把 `\` 当转义（`inner[i - 1] !== "\\"`）⇒ 只切出
 *   1 个实参 ⇒ 第二个实参上的违例见证**整条被静默跳过**（L2 见证门禁假绿）。
 *   ⇒ 这里必须与共享单源**逐字同口径**，否则两个面看到不同的实参列表。
 */
function splitCaseArgsText(text: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      current += ch;
      // 原样 slice：`\` 不是转义（与 parser 的 splitTopLevelArgs 一致）
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());
  return result;
}

/**
 * JSDoc 续行前缀（` * `）剥离——与 parser 的 fn-directives **同一正则**。
 *
 * ⚠ Bug 375：`scanCaseTags` 产出的 `argsText` 是**注释块内的原始文本**
 *   ⇒ 多行实参的续行仍带 ` * ` 前缀 ⇒ 不剥 ⇒ 实参认不出 ⇒ **整条见证被
 *   静默跳过**（写成单行则正常报红）。共享单源（parser）在切分前先剥前缀。
 */
function stripCaseContinuation(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");
}

/** 顶层冒号下标（字符串感知；`\` 不是转义）；无 → -1。 */
function findTopLevelColon(text: string): number {
  let found = -1;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < text.length && found < 0; i++) {
    const ch = text[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      continue;
    }
    if (ch === ":" && depth === 0) found = i;
  }
  return found;
}

/**
 * 结构字面量（对象 / 数组）→ Abs（obj / tuple）；不认识 → undefined。
 *
 * ⚠ Bug 371(b)：非字面量实参（对象 / 数组）此前一律归一成 unknown 后
 *   **静默 continue** ⇒ 字段级契约的违例见证永不上报（假绿）。现在结构
 *   字面量解析成真 Abs，字段位才能与 shape 契约**逐字段对账**。
 *
 * 不认识的形态（简写属性 / 方法 / 计算键 / 非常量成员）⇒ undefined ⇒
 * 调用方产**可见诊断**（R3），不再静默跳过。
 */
function parseStructureArgAbs(text: string): Abs | undefined {
  const t = text.trim();
  if (t.startsWith("{") && t.endsWith("}")) {
    const body = t.slice(1, -1).trim();
    const slots: Record<string, { value: Abs }> = {};
    if (body !== "") {
      for (const entry of splitCaseArgsText(body)) {
        if (entry === "") continue; // 尾逗号
        const colon = findTopLevelColon(entry);
        if (colon < 0) return undefined; // 简写属性 / 方法 → 不认识
        const keyText = entry.slice(0, colon).trim();
        if (keyText === "" || keyText.includes("[")) return undefined; // 计算键 → 不认识
        const key = keyText.replace(/^["']|["']$/g, "");
        if (key === "") return undefined;
        const value = parseCaseArgAbs(entry.slice(colon + 1));
        if (!value) return undefined;
        slots[key] = { value };
      }
    }
    return abs({ k: "obj", slots }, undefined, undefined, "exact");
  }
  if (t.startsWith("[") && t.endsWith("]")) {
    const body = t.slice(1, -1).trim();
    const elements: Abs[] = [];
    if (body !== "") {
      for (const el of splitCaseArgsText(body)) {
        if (el === "") continue; // 尾逗号
        const value = parseCaseArgAbs(el);
        if (!value) return undefined;
        elements.push(value);
      }
    }
    return abs({ k: "tuple", elements }, undefined, undefined, "exact");
  }
  return undefined;
}

/** case 实参原文 → Abs（标量 / 结构）；不认识 → undefined。 */
function parseCaseArgAbs(text: string): Abs | undefined {
  return parseScalarArgAbs(text) ?? parseStructureArgAbs(text);
}

/**
 * 实参是**约束构建器**表达式（`number()` / `shape({…})` / `union(…)` / …）？
 *
 * case 实参允许「具体值 **或** 约束构建器」（共享单源的 `parseCaseArgExpr`
 * 先试构建器、再试字面量）。构建器实参是**符号见证**（一个域，不是具体值）
 * ⇒ 见证面没有可比的具体值 ⇒ 跳过（与改前同口径），**不产诊断**——
 * 它是**合法形态**，不是文法缺口（缺诊断的应是「认不出的实参」）。
 *
 * 判据用 core 的 `CONSTRAINT_EXPR_RE`（构建器名单单源，与 parser 同源）；
 * 这里只做**形态识别**，**不执行**表达式（parser 侧的执行有 AST 白名单）。
 */
function isConstraintBuilderArg(text: string): boolean {
  return CONSTRAINT_EXPR_RE.test(text.trim());
}

/** lazy 约束解引用（预算内多层；与 scan/literal-shapes 的 derefDeep 同口径）。 */
function derefDeepConstraint(c: NudoConstraint): NudoConstraint {
  let cur = c;
  for (let i = 0; i < LAZY_TEMPLATE_DEPTH && cur.lazy; i++) {
    cur = derefConstraint(cur);
  }
  return cur;
}

/** 见证值无信息（unknown / any / never 且无 term）⇒ 判不了，不猜。 */
function witnessNoInfo(w: Abs): boolean {
  const k = w.shape.k;
  return k === "never" || ((k === "unknown" || k === "any") && !w.term);
}

/** 见证值是结构（对象 / 数组 / 元组）⇒ 不是标量。 */
function witnessIsStructure(w: Abs): boolean {
  const k = w.shape.k;
  return k === "obj" || k === "arr" || k === "tuple";
}

/** 见证值的 prim 类型（无 prim 信息 → undefined）。 */
function witnessPrimType(w: Abs): PrimName | undefined {
  const shape = w.shape.k === "brand" ? w.shape.shape.shape : w.shape;
  if (shape.k === "prim") return shape.type;
  return undefined;
}

/** 约束「通吃一切」（any()）：无 prim / 无 preds / 无成员 / 无结构 / 无 fn。 */
function constraintIsAnyLike(c: NudoConstraint): boolean {
  return (
    c.prim === undefined &&
    c.preds.length === 0 &&
    (c.members?.length ?? 0) === 0 &&
    !c.fields &&
    !c.element &&
    !c.fn
  );
}

/** 见证违例（一条 = 一个不满足点）。 */
type WitnessViolation = {
  /** 违例值（报告用 actual） */
  actual: Abs;
  /** 期望文案（报告用 expected） */
  expected: string;
  /** 见证内路径（顶层 = ""；字段路径相对见证本体） */
  path: string;
  /** 缺字段（文案 `missing field <path>`） */
  missing: boolean;
};

/**
 * 见证值 vs 约束 → 违例列表（空 = 满足 / 判不了）。
 *
 * 口径对齐调用点面（`scan/literal-shapes.ts` 的 `checkShapeAgainstAbs` /
 * `checkFieldConstraint`）：缺字段 → `missing field <path>`；prim 不符 →
 * `typeof <path> = "<prim>"`；其余 → `formatConstraint(约束)`。
 *
 * 只在**结构见证 / shape 契约**通道调用（标量见证仍走既有标量通道，
 * 既有输出契约零改动）。
 */
function witnessViolations(
  c: NudoConstraint,
  w: Abs,
  path: string,
  depth: number,
): WitnessViolation[] {
  if (depth > 6) return [];
  const cc = derefDeepConstraint(c);
  // union：任一成员满足即满足
  if (cc.members && cc.members.length > 0) {
    let first: WitnessViolation[] = [];
    for (const m of cc.members) {
      const vs = witnessViolations(m, w, path, depth + 1);
      if (vs.length === 0) return [];
      if (first.length === 0) first = vs;
    }
    return first;
  }
  // shape：逐字段对账（缺字段 / 字段值 ⊭ 字段约束）
  if (cc.fields) {
    const shape = w.shape.k === "brand" ? w.shape.shape.shape : w.shape;
    if (shape.k !== "obj") {
      if (witnessNoInfo(w)) return [];
      return [{ actual: w, expected: formatConstraint(cc), path, missing: false }];
    }
    const out: WitnessViolation[] = [];
    for (const [key, field] of Object.entries(cc.fields)) {
      const slot = getSlot(shape.slots, key);
      const fieldPath = path === "" ? key : `${path}.${key}`;
      if (!slot) {
        if (!field.optional && !field.constraint.isOptional) {
          out.push({
            actual: w,
            expected: `missing field ${fieldPath}`,
            path: fieldPath,
            missing: true,
          });
        }
        continue;
      }
      out.push(...witnessViolations(field.constraint, slot.value, fieldPath, depth + 1));
    }
    return out;
  }
  // array：逐元素对账
  if (cc.element) {
    const shape = w.shape.k === "brand" ? w.shape.shape.shape : w.shape;
    const elements =
      shape.k === "tuple" ? shape.elements : shape.k === "arr" ? [shape.element] : undefined;
    if (!elements) {
      if (witnessNoInfo(w)) return [];
      return [{ actual: w, expected: formatConstraint(cc), path, missing: false }];
    }
    const out: WitnessViolation[] = [];
    elements.forEach((el, i) => {
      out.push(...witnessViolations(cc.element!, el, `${path}[${i}]`, depth + 1));
    });
    return out;
  }
  // fn 约束：Phase 1 只展示不执法 ⇒ 判不了，不猜
  if (cc.fn) return [];
  // 标量域
  if (witnessIsStructure(w)) {
    // any()（无 prim / 无 preds / 无成员）通吃一切
    if (constraintIsAnyLike(cc)) return [];
    return [{ actual: w, expected: formatConstraint(cc), path, missing: false }];
  }
  const argLit = w.term?.op === "lit" ? w.term.value : undefined;
  if (w.term?.op !== "lit") return [];
  if (
    typeof argLit !== "number" &&
    typeof argLit !== "string" &&
    typeof argLit !== "boolean" &&
    argLit !== null &&
    argLit !== undefined
  ) {
    return [];
  }
  // prim 门（与调用点面同口径：nullish 不满足裸 prim 契约）
  if (cc.prim) {
    const prim = witnessPrimType(w);
    if (prim !== undefined && prim !== cc.prim) {
      return [
        { actual: w, expected: `typeof ${path} = "${cc.prim}"`, path, missing: false },
      ];
    }
  }
  // 域隶属（eq / union / bounds / int / 长度界）：判不了 ⇒ 保守不满足
  if (!literalMeetsConstraint(argLit, cc)) {
    return [{ actual: w, expected: formatConstraint(cc), path, missing: false }];
  }
  return [];
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

    // 实参 → Abs：**认不出 ⇒ undefined**（不再归一成 unknown 后静默跳过）
    const absArgs = args.map((a) => parseCaseArgAbs(a));
    // 标量域：eq/union 形态（lit()/union() 契约）走域隶属判定（bounds 分支
    // 判不了 eq/or，此前静默跳过 = 写了等于没写）；纯 bounds 域沿用逐原子
    // 报告（expected 保持 predToString 原文，既有输出契约零改动）
    for (const req of reqs) {
      const idx = req[0];
      const entry = req[1];
      const fieldPath = req[2];
      const paramName = entry.param || paramNames[idx] || `arg${idx}`;
      // ── 见证缺位 / 认不出：**不得静默跳过**（Bug 1009 根因 2/2 + R3）──
      // 契约位上没有见证 ⇒ 这条义务根本没被检验 ⇒ 产**可见诊断**
      // （nudo:directive-syntax，warning 级：不制造假红，但不再假绿）。
      if (idx >= args.length) {
        out.push({
          severity: "warning",
          code: DIAG.directiveSyntax,
          message: `${fnName} case "${caseName}": no witness argument for contract slot ${paramName} (${args.length} argument(s) given)`,
          actual: `${args.length} argument(s)`,
          expected: `${idx + 1} argument(s)`,
          suggestion: `add a witness argument for ${paramName}, or drop the contract on ${paramName}`,
          fn: fnName,
          line,
        });
        continue;
      }
      if (absArgs[idx] === undefined) {
        // 约束构建器实参 = 符号见证（域，不是具体值）⇒ 不可比 ⇒ 跳过，
        // **不产诊断**（合法形态，不是文法缺口）。
        if (isConstraintBuilderArg(args[idx]!)) continue;
        out.push({
          severity: "warning",
          code: DIAG.directiveSyntax,
          message: `${fnName} case "${caseName}": witness argument ${idx + 1} could not be parsed — contract slot ${paramName} was not checked`,
          actual: args[idx]!,
          expected: "a literal witness (number / string / boolean / null / undefined / object literal / array literal)",
          suggestion: `use a literal witness for ${paramName}, or relax the refine on ${paramName}`,
          fn: fnName,
          line,
        });
        continue;
      }
      let arg = absArgs[idx]!;
      // C4.1：destructure 契约名 → 实参字段投影后再判 pred；
      // 缺字段不能静默跳过（与 scan.checkReqs 同口径，报 case 见证违例）
      // #137：投影走路径（嵌套 'card.grade' 逐段下钻），展示用点连接串
      if (fieldPath) {
        const projected = projectCaseArgField(arg, fieldPath);
        if (!projected) {
          const k = arg.shape.k;
          if (k !== "unknown" && k !== "any") {
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
      // ── Bug 371：结构见证 / shape 契约**不再整条跳过** ──
      // ① 字段级 / shape 契约此前 `if (entry.constraint.fields) continue;`
      //    ⇒ 整条契约零义务（假绿）；
      // ② 对象 / 数组实参此前归一成 unknown 后静默 continue ⇒ 违例见证
      //    永不上报（假绿）。
      // 现在两者合流到同一条逐字段对账通道（口径对齐调用点面）。
      const cc = derefDeepConstraint(entry.constraint);
      if (cc.fields || witnessIsStructure(arg)) {
        for (const v of witnessViolations(cc, arg, "", 0)) {
          out.push({
            severity: "error",
            code: DIAG.caseInconsistency,
            message: `${fnName} case "${caseName}": witness ⊭ contract`,
            actual: formatAbs(v.actual),
            expected: v.expected,
            suggestion: v.missing
              ? `add the missing field ${v.path} to the case argument (contract slot ${paramName})`
              : `change the case argument, or relax the refine on ${paramName}`,
            fn: fnName,
            line,
          });
        }
        continue;
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
        // 实参原文 = **共享单源** `scanCaseTags` 的 `argsText`：
        // ① 先剥 JSDoc 续行前缀（` * `）——Bug 375（多行实参整条被静默跳过）；
        // ② 再按共享单源口径切分（`\` 不是转义）——Bug 1009（实参个数不同
        //    ⇒ 违例见证被静默跳过 ⇒ L2 见证门禁假绿）。
        // ⚠ 不再把 argsText 重新塞回 `@nudo:case "x" (...)` 用正则反解
        //   （贪婪 `[\s\S]*` 会吃到最后一个 `)`，且字符串里的 `)` 会切错）。
        const caseArgs = splitCaseArgsText(stripCaseContinuation(tag.argsText));
        checkCaseAgainstReqs(scope.name, tag.name, caseArgs, startLine);
      }
    }
  }
  return out;
}
