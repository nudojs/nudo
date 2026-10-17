/**
 * 算术域共享 helper（叶子模块）：被多个运算族（addsub/muldiv）消费的
 * 折叠辅助——sum 笛卡尔分发、IEEE 端点收紧、ToNumber 结果面、
 * assume 前提链拆解。
 *
 * 依赖方向不变量：本模块是 arithmetic/ 子目录的叶子——不得 import
 * 子目录内任何兄弟模块（shared/coerce/bounds ← addsub/muldiv/cmp ←
 * facade 单向无环）；若发现需要反向依赖，说明切分线选错，重切而不是加边。
 */

import type { LiteralValue } from "../term.ts";
import { app, lit, simplifyTerm } from "../term.ts";
import type { Pred, Phi } from "../pred.ts";
import { nextUp, nextDown } from "../pred.ts";
import type { Abs } from "../abs.ts";
import { abs, confJoin, isNumPrim, isBigPrim } from "../abs.ts";
import { absShapeKey } from "../objects.ts";
import { recordMayThrow } from "../may-throw.ts";

/**
 * 二元算子对 sum 操作数的分发（add/sub/mul/div/mod 同口径）：
 * 笛卡尔成员组合后去重；结果为空折 unknown，单成员收成成员自身。
 * 成员非 sum（flattenSum 不变量）→ 递归至多一层。
 * 此前仅 add 分发：sub/mul/div/mod 遇 sum 操作数整体落
 * unknown —— `100 - (cond ? 20 : 55)` 推断成 unknown，
 * 下游 clamp/区间契约误报。
 */
export function distributeSumBinOp(
  op: "+" | "-" | "*" | "/" | "%",
  a: Abs,
  b: Abs,
  phi: Phi,
  eval2: (x: Abs, y: Abs, phi: Phi) => Abs,
): Abs | undefined {
  if (a.shape.k !== "sum" && b.shape.k !== "sum") return undefined;
  const parts: Abs[] = [];
  const as = a.shape.k === "sum" ? a.shape.members : [a];
  const bs = b.shape.k === "sum" ? b.shape.members : [b];
  for (const x of as) {
    for (const y of bs) {
      const r = eval2(x, y, phi);
      if (r.shape.k === "never") continue;
      if (r.shape.k === "sum") parts.push(...r.shape.members);
      else parts.push(r);
    }
  }
  const uniq = dedupAbsMembers(parts);
  const term =
    a.term && b.term ? simplifyTerm(app(op, [a.term, b.term])) : undefined;
  if (uniq.length === 0) {
    return abs({ k: "unknown" }, term, undefined, "partial");
  }
  if (uniq.length === 1) {
    return abs(uniq[0]!.shape, term, uniq[0]!.pred, confJoin(a.conf, b.conf));
  }
  return abs({ k: "sum", members: uniq }, term, undefined, "partial");
}

function dedupAbsMembers(ms: Abs[]): Abs[] {
  const seen = new Set<string>();
  const out: Abs[] = [];
  for (const m of ms) {
    const key = absShapeKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function strLitResult(s: string): Abs {
  return {
    shape: { k: "prim", type: "string" },
    term: lit(s),
    conf: "exact",
  };
}

/** -0 与 0 在约束里等价 */
function normalizeNegZero(n: number): number {
  return n === 0 ? 0 : n;
}

/**
 * IEEE 安全的端点（非严格）：非有限（NaN/±Inf）不能当端点（NaN 无序、
 * ±Inf 与溢出值比较失真——`x>1e308 + y>1e308 ⊬ x+y > Infinity`）。
 * 非严格断言 ge/le 由 fl 单调性永真，无需见证校准。
 */
export function ieeeBound(n: number): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  return normalizeNegZero(n);
}

/**
 * strict 端点的 IEEE 舍入校准（Bug A）。
 *
 * 拟断言 result > E（claim="lo"）/ result < E（claim="hi"）：E 是用界
 * 端点值算出的 fl(a op b)，w 是把 strict 操作数端点换成 next-step 见证
 * 值（下界贡献取 nextUp、上界贡献取 nextDown，见 synthEndpoint）后重算
 * 的 fl(a' op b')。fl 单调 ⇒ 恒有 w ≥ E（lo）/ w ≤ E（hi）：
 *   - w > E（lo）/ w < E（hi）：真实 inf/sup 在端点外侧，断言 sound，
 *     保留 E（含 w=±Inf 的见证溢出）；
 *   - w === E：端点运算舍入越过/恰撞真实 inf/sup（反例：fl(1 + 1e-16)
 *     = 1，而 x=1、y=2^-53 时 IEEE 和 === 1），存在合法输入使结果 === E，
 *     端点外推一步（离散性下 gt(nextDown(E)) ⟺ ge(E)，strict 语义不变）；
 *   - w 落在错误侧 / NaN：方向 bug 或脏数据，保守丢弃（undefined）。
 */
export function ieeeStrictEndpoint(E: number, w: number, claim: "lo" | "hi"): number | undefined {
  if (!Number.isFinite(E)) return undefined;
  if (claim === "lo") {
    if (w > E) return normalizeNegZero(E);
    if (w === E) return normalizeNegZero(nextDown(E));
    return undefined;
  }
  if (w < E) return normalizeNegZero(E);
  if (w === E) return normalizeNegZero(nextUp(E));
  return undefined;
}

/** 数值界端点（NumBounds 的单侧）：value 为界值，strict 为严格性 */
export type Endpoint = { value: number; strict: boolean };

/**
 * 端点合成 + strict 见证校准的统一入口（Bug A，addsub/muldiv 全消费点）。
 *
 * f 是端点运算的 JS fl 语义（+、−、×k、÷k——除法用真实 `/`，不换算
 * `×(1/k)`，两者舍入不同）；a（及可选 b）是参与该端点合成的操作数界；
 * dirA/dirB 是该操作数在这侧端点里的见证步进方向："up" = strict 时取
 * nextUp（x > a ⟺ x ≥ nextUp(a)，操作数向下推端点时用），"down" 对偶。
 * claim 是断言方向（"lo" 下界 result > E / "hi" 上界 result < E）。
 *
 * 全部非严格时直接 ieeeBound(E)（fl 单调 ⇒ ge/le 永真，无舍入问题）；
 * 任一 strict 时经 ieeeStrictEndpoint 见证校准（subsumes 旧的
 * strictZeroOk 下溢启发式：下溢由见证值 w === E 自然捕获，如
 * `fl(MIN_VALUE / 2) = 0` 使 gt(x/2, 0) 退为 gt(x/2, -MIN_VALUE)）。
 * b 省略时 f 只吃第一参数（×k/÷k 常数侧无数值界）。
 */
export function synthEndpoint(
  f: (x: number, y: number) => number,
  a: Endpoint,
  dirA: "up" | "down",
  claim: "lo" | "hi",
  b?: Endpoint,
  dirB: "up" | "down" = "up",
): number | undefined {
  const strict = a.strict || (b?.strict ?? false);
  const E = b === undefined ? f(a.value, 0) : f(a.value, b.value);
  if (!strict) return ieeeBound(E);
  const aW = a.strict ? (dirA === "up" ? nextUp(a.value) : nextDown(a.value)) : a.value;
  const bW = b === undefined ? 0 : b.strict ? (dirB === "up" ? nextUp(b.value) : nextDown(b.value)) : b.value;
  return ieeeStrictEndpoint(E, f(aW, bW), claim);
}

/** any / unknown（含无 term 的裸 unknown）：JS ToNumber 语义用于 - * / % */
export function isAnyLike(a: Abs): boolean {
  if (a.shape.k === "any") return true;
  if (a.shape.k === "unknown") return true;
  return false;
}

/**
 * 具体原始字面量（number/string/boolean/null/undefined）——
 * `- * / %` 上可按 JS ToNumber 折叠：`"a"*2`→NaN，`true*2`→2，`"3"*2`→6。
 */
export function coercibleLit(
  v: LiteralValue,
): v is number | string | boolean | null | undefined {
  // 值域判定（调用方已 .ok）：lit(undefined) 是合法字面量，
  // ToNumber(undefined)=NaN → 参与算术恒 NaN（number 值域，Bug 10——
  // `undefined + 1` 原生恒 NaN，不得落 number|string 并集）；
  // bigint 走 foldBigintBinOp。
  return (
    typeof v === "number" ||
    typeof v === "string" ||
    typeof v === "boolean" ||
    v === null ||
    v === undefined
  );
}

/**
 * 减乘除模在 any 上走 JS ToNumber：结果恒为 number（可能 NaN）。
 * 与 + 不同——+ 可能拼接；减乘除模不会。
 * 一侧是 bigint 面时成功路径恒为 bigint（对面须同为 bigint），不得折 number。
 */
export function toNumberResult(
  a: Abs,
  b: Abs,
  op: "-" | "*" | "/" | "%",
): Abs {
  // Bug 8：any 参与 - * / %：ToNumber 可能撞 Symbol / 与 bigint 混型
  // （`x - 1`，x=1n / Symbol() 原生 TypeError）→ may TypeError，值域不变。
  // unknown 令牌不记（wave 1 口径）。
  if (a.shape.k === "any" || b.shape.k === "any") {
    recordMayThrow({
      kind: "TypeError",
      cause: "ToNumber coercion of abstract operand",
    });
  }
  // 不用 simplifyTerm：x*1=x / x-0=x 只对 number 成立；any 参与时 ToNumber
  // 后值已变（"5"*1→5），不得把结果项认成原 any 变量（strictEqAbs 同 var 会折 true）。
  const term = a.term && b.term ? app(op, [a.term, b.term]) : undefined;
  const bigFace = isBigPrim(a) || isBigPrim(b);
  return abs(
    bigFace ? { k: "prim", type: "bigint" } : { k: "prim", type: "number" },
    term,
    undefined,
    term ? confJoin(confJoin(a.conf, b.conf), "partial") : "partial",
  );
}

/**
 * 可参与数值运算（- * / %）：number prim。
 * any 不算数——那会把 score("x") 误判成 number 路径。
 */
export function isNumericLike(a: Abs): boolean {
  return isNumPrim(a);
}

/** assume 前提链（and 归一化）拆解为原子列表；pTrue → 空 */
export function assumePremiseList(assume: Phi | undefined): Pred[] {
  if (!assume || assume.op === "true") return [];
  const out: Pred[] = [];
  const walk = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(walk);
      return;
    }
    if (p.op !== "true") out.push(p);
  };
  walk(assume);
  return out;
}

