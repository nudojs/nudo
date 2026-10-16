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
 * IEEE 安全的不等式端点。
 * - 非有限（NaN/±Inf）：不能当端点（NaN 恒假、Inf 与溢出值比较失真）
 * - 0 作 strict 端点仅当运算不会把正值下溢成 0（见各调用点的 strictZeroOk）
 */
export function ieeeBound(n: number, strict: boolean, strictZeroOk: boolean): number | undefined {
  if (!Number.isFinite(n)) return undefined;
  const z = normalizeNegZero(n);
  if (z === 0 && strict && !strictZeroOk) return undefined;
  return z;
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

