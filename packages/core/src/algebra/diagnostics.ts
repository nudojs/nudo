/**
 * 约束诊断：检查调用点实参是否满足函数的前置约束 / 参数 shape。
 * 输出可行动的建议，而不是 TS 式「类型不匹配」。
 *
 * Bug 364：本模块此前**没有生产者**——`checkArg` / `checkCall` 是死码 ⇒
 * 文档承诺的调用点验证面在产品里整体静默。`checkCallSite` 是接进产品
 * 路径（`scan-literal-calls.ts` 的调用点扫描）的入口。
 */

import type { Abs } from "./abs.ts";
import { litValue } from "./abs.ts";
import type { Pred, Phi } from "./pred.ts";
import { implies, predToString, pTrue, gt, ge, lt, le } from "./pred.ts";
import type { Term } from "./term.ts";
import { termToString, v as termVar, lit } from "./term.ts";
import { generalizeFromAst, type PolyFn } from "./generalize.ts";
import type { CheckIssue } from "./check-report.ts";

import { formatShape } from "./format.ts";
import { DIAG } from "./diag-codes.ts";

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  suggestion?: string;
  fn?: string;
  argIndex?: number;
};

/**
 * 检查实参是否满足「期望约束」。
 * expect: 相对参数 term 的 pred，例如 term > 0
 * arg: 实际实参 Abs
 *
 * Bug 364：`expect` 的主题项是**参数位**的 term（通用化面里的 `A1`），
 * 而 `arg.pred` 相对**实参** term（`x`）⇒ 两者永不同一 ⇒ 任何非字面量
 * 实参都被判 `nudo:constraint-unproven`（假红）。⇒ 判定前把主题项
 * 对齐到实参自身的 term（`alignToArg`）。
 */
export function checkArg(
  arg: Abs,
  expect: Pred | undefined,
  phi: Phi = pTrue,
): Diagnostic | undefined {
  if (!expect || expect.op === "true") return undefined;
  const want = alignToArg(expect, arg);
  if (arg.shape.k === "unknown" && !arg.term) {
    return {
      severity: "warning",
      code: DIAG.argOpaque,
      message: `argument type is unknown; cannot verify constraint ${predToString(want)}`,
      suggestion: "add a call site or @nudo:case, or provide preconditions via --assume",
    };
  }
  // 若 Φ 与实参自身 pred 已蕴含 expect → OK
  const combined: Phi =
    arg.pred && arg.pred.op !== "true"
      ? phi.op === "true"
        ? arg.pred
        : { op: "and", args: [phi, arg.pred] }
      : phi;
  if (implies(combined, want)) return undefined;

  // 字面量直接判定（tagged：.ok 才是字面量，含 lit(undefined)）
  const lvR = litValue(arg);
  if (
    lvR.ok &&
    (want.op === "gt" || want.op === "ge" || want.op === "lt" || want.op === "le")
  ) {
    const ok = decideLitCmp(lvR.value, want);
    if (ok === true) return undefined;
    if (ok === false) {
      return {
        severity: "error",
        code: DIAG.constraintViolated,
        message: `argument ${JSON.stringify(lvR.value)} does not satisfy ${predToString(want)}`,
        suggestion: `use a value satisfying the constraint, or relax the function precondition`,
      };
    }
  }

  return {
    severity: "warning",
    code: DIAG.constraintUnproven,
    message: `cannot prove the argument satisfies ${predToString(want)}`,
    suggestion: `not enough information; use --assume or add a case`,
  };
}

/**
 * 把「相对参数位 term」的期望 pred 的**主题项**对齐到实参自身的 term。
 *
 * 实参在调用点上占据参数位 ⇒ 参数位的 term 就是实参的 term ⇒ 判定前
 * 把主题项（比较式的左侧 var）换成实参 term 的 var，蕴含判定才有意义。
 * 实参无 var term（字面量 / unknown）时保持原样。
 */
function alignToArg(expect: Pred, arg: Abs): Pred {
  const t = arg.term;
  if (!t || t.op !== "var") return expect;
  const id = t.id;
  const walk = (p: Pred): Pred => {
    switch (p.op) {
      case "gt":
        return p.a.op === "var" ? { op: "gt", a: { op: "var", id }, b: p.b } : p;
      case "ge":
        return p.a.op === "var" ? { op: "ge", a: { op: "var", id }, b: p.b } : p;
      case "lt":
        return p.a.op === "var" ? { op: "lt", a: { op: "var", id }, b: p.b } : p;
      case "le":
        return p.a.op === "var" ? { op: "le", a: { op: "var", id }, b: p.b } : p;
      case "eq":
        if (p.a.op === "var") return { op: "eq", a: { op: "var", id }, b: p.b };
        if (p.b.op === "var") return { op: "eq", a: p.a, b: { op: "var", id } };
        return p;
      case "and":
        return { op: "and", args: p.args.map(walk) };
      case "or":
        return { op: "or", args: p.args.map(walk) };
      case "not":
        return { op: "not", arg: walk(p.arg) };
      default:
        return p;
    }
  };
  return walk(expect);
}

/**
 * 字面量 × 常数界的三值判定。
 *
 * BUG-211：比较式**左项必须是纯 self 项**（`var`）才能当数值比较。此前不看左项
 * ⇒ `ge(length(x), 1)` 被当成「数字 ≥ 1」（`3 >= 1` ⇒ 满足）⇒ **假绿**，而返回
 * 通道（`literalMeetsConstraint`）按**长度语义**读同一个谓词 ⇒ 判违反（假红）
 * ⇒ 同一约束两个执法通道结论相反。
 *
 * 现在按左项分派：
 * - 纯 `var` ⇒ 数值比较（原语义）；
 * - `length(t)` 应用项 ⇒ **长度语义**（字符串字面量取 `.length`；其它形态
 *   ——数字 / 布尔 / 数组（`litValue` 只产标量字面量）——**不可判定** ⇒
 *   `undefined`，由调用方按「不可证明」处理，不猜）；
 * - 其余形态（字段访问 `get(u, k)` 等）⇒ 不可判定。
 */
function decideLitCmp(
  lv: import("./term.ts").LiteralValue,
  p: Extract<Pred, { op: "gt" | "ge" | "lt" | "le" }>,
): boolean | undefined {
  if (p.b.op !== "lit" || typeof p.b.value !== "number") return undefined;
  const n = p.b.value;
  const cmp = (got: number): boolean => {
    switch (p.op) {
      case "gt":
        return got > n;
      case "ge":
        return got >= n;
      case "lt":
        return got < n;
      case "le":
        return got <= n;
      default:
        return false;
    }
  };
  // 长度语义通道（与返回位的 literalMeetsConstraint 同口径）
  if (p.a.op === "app" && p.a.fn === "length") {
    if (typeof lv !== "string") return undefined;
    return cmp(lv.length);
  }
  // 只有纯 self 项才是数值比较的合法左项
  if (p.a.op !== "var") return undefined;
  if (typeof lv !== "number") return undefined;
  return cmp(lv);
}

/**
 * 被调方的**实参位面**（nativeParamArity 口径）：
 * - `required` = **必填**实参位个数（默认形参 / rest 形参**不吃**实参位）；
 * - `total` = **非 rest** 形参的总位数——默认形参**占位**（`f(a, b = 1)` 的
 *   第 2 个实参被 `b` 吃掉 ⇒ 不是「多传」；Bug 1131）；
 * - `hasRest` = 有 rest 形参（多余实参被它吸收 ⇒ 不算实参个数不符）。
 *
 * BUG-197：`contractOptional` = **契约级**可选位（`constraint.isOptional`，按
 * 形参位次）。产物面（dts / schema）把契约级可选性当权威（Bug 536 的「三来源」
 * 序：契约 > 实现签名）⇒ 执法面必须同源，否则同一份契约「产物说可省、check
 * 说必填」⇒ TS 合法调用被判 `nudo:arg-count` 假红。契约位优先于实现签名
 * （与产物面同序）；两侧都不报可选才计入 `required`。
 */
function arityFace(
  g: PolyFn,
  contractOptional?: ReadonlySet<number>,
): { required: number; total: number; hasRest: boolean } {
  const formals = g.formals;
  const restByName = g.params.filter((p) => p.startsWith("...")).length;
  const hasRest = (formals?.some((f) => f.kind === "rest") ?? false) || restByName > 0;
  if (!formals || formals.length === 0) {
    // 无 formals 面：按展示名推断（rest 位不吃实参位）
    const total = Math.max(0, g.params.length - restByName);
    // 契约级可选位：没有 formals 时按展示名位次扣减（同一位次口径）
    const contractRequired = Array.from({ length: total }, (_, i) => i)
      .filter((i) => contractOptional?.has(i) !== true).length;
    return { required: contractRequired, total, hasRest };
  }
  let required = 0;
  let total = 0;
  for (let i = 0; i < formals.length; i++) {
    const f = formals[i]!;
    if (f.kind === "rest") break;
    total++;
    if (f.optional === true) continue;
    if (contractOptional?.has(i) === true) continue;
    required++;
  }
  // 保守：不超过展示名个数（`this` 接收者等不占位）
  const cap = g.params.length;
  return { required: Math.min(required, cap), total: Math.min(total, cap), hasRest };
}

/**
 * 对一次函数调用做诊断：实参 shape + 约束。
 */
export function checkCall(
  source: string,
  fnName: string,
  args: Abs[],
  phi: Phi = pTrue,
): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const g = generalizeFromAst(fnName, source);
  if (!g) {
    diags.push({
      severity: "error",
      code: DIAG.fnNotFound,
      message: `function ${fnName} not found`,
    });
    return diags;
  }

  // 参数个数（**必填位**口径：默认形参 / rest 形参不吃实参位）
  const { required, total, hasRest } = arityFace(g);
  if (args.length < required) {
    diags.push({
      severity: "error",
      code: DIAG.argCount,
      message: `${fnName} expects ${required} argument(s), got ${args.length}`,
      fn: fnName,
    });
    return diags;
  }
  if (args.length > total && !hasRest) {
    // JS 允许多余实参（被调方忽略）⇒ 只提示，不判 error（native 语义）
    //
    // Bug 1131：上界是**非 rest 形参的总位数**（不是必填位数）——默认形参
    // **占位**（`f(a, b = 1)` 的第 2 个实参被 `b` 吃掉 ⇒ 不是「多传」）。
    diags.push({
      severity: "warning",
      code: DIAG.argCount,
      message: `${fnName} takes ${total} argument(s) but ${args.length} were passed`,
      fn: fnName,
    });
  }

  // 从符号执行结果提取「对参数的隐含要求」：
  // 若 symbolic.pred 形如 (A1 > 0)，则要求对应实参满足
  const required_ = extractParamRequirements(g);
  args.forEach((arg, i) => {
    const req = required_.get(i);
    const d = checkArg(arg, req, phi);
    if (d) diags.push({ ...d, fn: fnName, argIndex: i });
  });

  // fail-closed：partial 置信度直接用 symbolic（generalize 已求值；不再
  // 重复 analyzeFn 探针）
  if (g.symbolic.conf === "partial" || g.symbolic.conf === "opaque") {
    diags.push({
      severity: "info",
      code: DIAG.partialResult,
      message: `${fnName}(...) result confidence ${g.symbolic.conf}`,
      suggestion: "add a call site or constraint to improve precision",
      fn: fnName,
    });
  }

  return diags;
}

/**
 * Bug 364：调用点验证的**产品入口**（把 `checkArg` / `checkCall` 的判定
 * 面接进产品路径）。
 *
 * 产品路径的调用点扫描（`scan-literal-calls.ts`）此前只做**契约面**执法
 * （`checkReqs` / `checkShapeReqs`）⇒ 本模块的五个诊断码**从不产生**。
 * 本函数在契约面之外补上**通用化参数面**的调用点验证：
 * - 实参个数（`nudo:arg-count`）：少传必填位 = 确定性错误；多传实参在
 *   JS 里合法（被调方忽略）⇒ 只给 warning；
 * - 实参对通用化面义务的满足（`nudo:arg-opaque` /
 *   `nudo:constraint-violated` / `nudo:constraint-unproven`）。
 *
 * 口径：
 * - **不**报 `nudo:fn-not-found`——调用点能否解析由调用点扫描判（宿主
 *   全局 / 跨文件导入另有 `nudo:missing-export` 等码），此处报会误伤。
 * - 契约面已覆盖的参数位（`skipParams`）不再走通用化面判定 ⇒ 不双报。
 * - **不**报 `nudo:partial-result`（族 07 收口片 Z）——被调方通用化结果的
 *   置信度是**被调方**的内部精度问题，把它挂在**每个调用点**上会让
 *   `nudo check` 的 info 面被同一件事刷屏（真实包 `ms` 的每个导出各挂一条）。
 *   该码仍是**既有公共 API** `checkCall` 的语义（见上），语义不变、只是
 *   **不在产品路径的调用点面上产**（与 Bug 364 之前的产品面一致）。
 */
export function checkCallSite(
  source: string,
  fnName: string,
  args: Abs[],
  opts: {
    /** 语法实参个数（缺省 = args.length） */
    argCount?: number;
    /** 实参是否带信息（false ⇒ 只查实参个数，不查实参义务） */
    hasInfo?: boolean;
    /** 被调方通用化结果（已算好则复用，避免重复求值） */
    fn?: PolyFn | undefined;
    /** 调用点环境假设 */
    phi?: Phi;
    /** 契约面已覆盖的参数位（避免与契约面执法双报） */
    skipParams?: ReadonlySet<number>;
    /**
     * BUG-197：**契约级**可选位（`constraint.isOptional` → 形参位次）。
     * 产物面（dts / schema）以契约为可选性的权威来源 ⇒ 元数面同源，
     * 否则「产物说可省、check 说必填」⇒ TS 合法调用被判 `nudo:arg-count`。
     */
    contractOptional?: ReadonlySet<number>;
    /** 展示名（跨文件调用用） */
    displayName?: string;
    line?: number;
    column?: number;
  } = {},
): CheckIssue[] {
  const out: CheckIssue[] = [];
  const g = opts.fn ?? generalizeFromAst(fnName, source);
  if (!g) return out;
  const display = opts.displayName ?? fnName;
  const argCount = opts.argCount ?? args.length;
  const { required, total, hasRest } = arityFace(g, opts.contractOptional);

  if (argCount < required) {
    out.push({
      severity: "error",
      code: DIAG.argCount,
      message: `${display} expects ${required} argument(s), got ${argCount}`,
      fn: display,
      line: opts.line,
      column: opts.column,
    });
    return out;
  }
  if (argCount > total && !hasRest) {
    // Bug 1131：上界是**非 rest 形参的总位数**（默认形参占位 ⇒ 不是「多传」）
    out.push({
      severity: "warning",
      code: DIAG.argCount,
      message: `${display} takes ${total} argument(s) but ${argCount} were passed`,
      fn: display,
      line: opts.line,
      column: opts.column,
    });
  }

  // 实参义务：实参无信息时不猜（unknown / any 不猜）
  if (opts.hasInfo === false) return out;
  const reqs = extractParamRequirements(g);
  args.forEach((arg, i) => {
    if (opts.skipParams?.has(i)) return;
    const d = checkArg(arg, reqs.get(i), opts.phi);
    if (d) {
      out.push({
        ...d,
        fn: display,
        argIndex: i,
        line: opts.line,
        column: opts.column,
      });
    }
  });

  // `nudo:partial-result` **不在此产**（族 07 收口片 Z）：被调方的结果置信度
  // 是**被调方**的精度问题，不是**调用点**的问题 ⇒ 挂在每个调用点上只会把
  // `nudo check` 的 info 面刷满（同一件事对同一导出报 N 次）。该码仍是既有
  // 公共 API `checkCall` 的语义（见上），产品面保持 Bug 364 之前的安静。

  return out;
}

/**
 * 从 generalize 的 symbolic.pred 提取对每个参数位置的要求。
 * 例如 scale 的 pred 若是 (A1+1)>1，则不直接是 A1 的约束；
 * 若 pred 是 A1>0，则要求实参 >0。
 * Phase C 简化：只识别 pred 中直接比较 type-param 的形式。
 */
function extractParamRequirements(g: PolyFn): Map<number, Pred> {
  const map = new Map<number, Pred>();
  const pred = g.symbolic.pred;
  if (!pred || pred.op === "true") return map;

  const paramIndex = new Map<string, number>();
  g.typeParams.forEach((t, i) => paramIndex.set(t.id, i));

  const consider = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(consider);
      return;
    }
    if (
      (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") &&
      p.a.op === "var" &&
      paramIndex.has(p.a.id) &&
      p.b.op === "lit"
    ) {
      // 把 A1 换成 term 占位 —— checkArg 时用实参 term 比较
      // 这里存的是「相对 type-param」的 pred；checkArg 期望的是相对实参 term
      // 简化：存为对参数位置的数值界
      map.set(paramIndex.get(p.a.id)!, p as Pred);
    }
  };
  consider(pred);
  return map;
}

export function formatDiagnostics(diags: Diagnostic[]): string {
  if (diags.length === 0) return "No issues found.";
  return diags
    .map((d) => {
      const loc = d.fn ? `${d.fn}${d.argIndex !== undefined ? `[${d.argIndex}]` : ""}: ` : "";
      let s = `[${d.severity}] ${loc}${d.message} (${d.code})`;
      if (d.suggestion) s += `\n    → ${d.suggestion}`;
      return s;
    })
    .join("\n");
}
