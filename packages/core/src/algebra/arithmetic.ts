/**
 * 算术核：单调性 + 常量折叠 + 约束传播。
 * 这是「类型即计算」的主武器——x>0 时 x+1 必须得到 >1。
 */

import type { Term } from "./term.ts";
import { app, lit, simplifyTerm, termToString } from "./term.ts";
import type { Pred } from "./pred.ts";
import {
  and,
  gt,
  ge,
  lt,
  le,
  implies,
  predToString,
  pTrue,
  ptypeof,
  type Phi,
} from "./pred.ts";
import type { Abs } from "./abs.ts";
import {
  abs,
  confJoin,
  isNumPrim,
  isStrPrim,
  litValue,
  num,
  numLit,
  str,
  bool,
  boolLit,
  never,
} from "./abs.ts";
import { concatString, isTemplateLike } from "./template.ts";
import { makeSum } from "./objects.ts";

/**
 * 抽象加法：eval(a + b) —— 跟真实 JS，不无根据地假定 number。
 * 1. 双方字面量 → 直接求值
 * 2. 双方 number prim → term + 单调性 pred，shape=number
 * 3. 含 string/template → 拼接
 * 4. any / type-var 参与 → 按 JS + 的可能结果取并集：number | string
 *    （bool/null 走 ToNumber→number；object 默认 ToPrimitive→string；
 *      bigint/symbol 边角不在默认并集里，由调用点实例化再收窄）
 *    无契约的 score(x){return x+1}：score("x") 合法，不得钉成 number。
 */
export function add(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  // 字面量快速路径
  const va = litValue(a);
  const vb = litValue(b);
  if (va !== undefined && vb !== undefined) {
    if (typeof va === "number" && typeof vb === "number") {
      return numLit(va + vb);
    }
    if (typeof va === "string" || typeof vb === "string") {
      return strLitResult(String(va) + String(vb));
    }
  }

  // 字符串拼接（含 template parts）—— JS + 优先走 string
  if (isStrPrim(a) || isStrPrim(b) || isTemplateLike(a) || isTemplateLike(b)) {
    return concatString(a, b);
  }

  // 双方 number prim：数值加法 + 约束传播
  if (isNumPrim(a) && isNumPrim(b)) {
    if (!a.term || !b.term) {
      return abs(num().shape, undefined, undefined, confJoin(a.conf, "widened"));
    }
    const term = simplifyTerm(app("+", [a.term, b.term]));
    const pred = addPred(a, b, term, phi);
    const conf =
      term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path");
    return abs({ k: "prim", type: "number" }, term, pred, conf);
  }

  // any / type-var：JS + 的并集，不是 unknown，也不是 number
  if (isAnyLike(a) || isAnyLike(b)) {
    const term =
      a.term && b.term ? simplifyTerm(app("+", [a.term, b.term])) : undefined;
    return abs(
      { k: "sum", members: [num(), str()] },
      term,
      undefined,
      "partial",
    );
  }

  // sum 分发：对每个成员做 +，再 join（(x+1)+1 在 any 上仍是 number|string）
  if (a.shape.k === "sum" || b.shape.k === "sum") {
    const parts: Abs[] = [];
    const as = a.shape.k === "sum" ? a.shape.members : [a];
    const bs = b.shape.k === "sum" ? b.shape.members : [b];
    for (const x of as) {
      for (const y of bs) {
        const r = add(x, y, phi);
        if (r.shape.k === "never") continue;
        if (r.shape.k === "sum") parts.push(...r.shape.members);
        else parts.push(r);
      }
    }
    const uniq = dedupAbsMembers(parts);
    const term =
      a.term && b.term ? simplifyTerm(app("+", [a.term, b.term])) : undefined;
    if (uniq.length === 0) {
      return abs({ k: "unknown" }, term, undefined, "partial");
    }
    if (uniq.length === 1) {
      return abs(uniq[0]!.shape, term, uniq[0]!.pred, confJoin(a.conf, b.conf));
    }
    return abs({ k: "sum", members: uniq }, term, undefined, "partial");
  }

  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

function dedupAbsMembers(ms: Abs[]): Abs[] {
  const seen = new Set<string>();
  const out: Abs[] = [];
  for (const m of ms) {
    const key =
      m.shape.k === "prim"
        ? `prim:${m.shape.type}`
        : m.shape.k === "sum"
          ? `sum:${m.shape.members.length}`
          : m.shape.k;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function strLitResult(s: string): Abs {
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

/** any / unknown（含无 term 的裸 unknown）：JS ToNumber 语义用于 - * / % */
function isAnyLike(a: Abs): boolean {
  if (a.shape.k === "any") return true;
  if (a.shape.k === "unknown") return true;
  return false;
}

/**
 * 具体原始字面量（number/string/boolean/null/undefined）——
 * `- * / %` 上可按 JS ToNumber 折叠：`"a"*2`→NaN，`true*2`→2，`"3"*2`→6。
 */
function coercibleLit(
  v: ReturnType<typeof litValue>,
): v is number | string | boolean | null | undefined {
  return (
    v !== undefined &&
    (typeof v === "number" ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      v === null)
  );
}

/**
 * 减乘除模在 any 上走 JS ToNumber：结果恒为 number（可能 NaN）。
 * 与 + 不同——+ 可能拼接；减乘除模不会。
 */
function toNumberResult(
  a: Abs,
  b: Abs,
  op: "-" | "*" | "/" | "%",
): Abs {
  const term =
    a.term && b.term ? simplifyTerm(app(op, [a.term, b.term])) : undefined;
  return abs(
    { k: "prim", type: "number" },
    term,
    undefined,
    term ? confJoin(confJoin(a.conf, b.conf), "partial") : "partial",
  );
}

/**
 * 可参与数值运算（- * / %）：number prim。
 * any 不算数——那会把 score("x") 误判成 number 路径。
 */
function isNumericLike(a: Abs): boolean {
  return isNumPrim(a);
}

/**
 * 加法约束单调性：
 *   a > p ∧ b > q  ⇒  a+b > p+q
 *   a > p ∧ b = lit(q)  ⇒  a+b > p+q
 *   a = var(x) ∧ x>0 ∧ b=lit(1)  ⇒  term=x+1, pred: term>1
 */
function addPred(a: Abs, b: Abs, sumTerm: Term, phi: Phi): Pred | undefined {
  // 双方都已有「相对自身 term」的数值下界/上界，且能从 Φ 或自身 pred 得到
  const aBounds = numericBounds(a, phi);
  const bBounds = numericBounds(b, phi);
  if (!aBounds && !bBounds) return undefined;

  const facts: Pred[] = [];

  // (a.lo + b.lo) < sum  或  ≤
  if (aBounds?.lo !== undefined && bBounds?.lo !== undefined) {
    const loSum = aBounds.lo.value + bBounds.lo.value;
    const strict = aBounds.lo.strict || bBounds.lo.strict;
    facts.push(strict ? gt(sumTerm, lit(loSum)) : ge(sumTerm, lit(loSum)));
  }
  if (aBounds?.hi !== undefined && bBounds?.hi !== undefined) {
    const hiSum = aBounds.hi.value + bBounds.hi.value;
    const strict = aBounds.hi.strict || bBounds.hi.strict;
    facts.push(strict ? lt(sumTerm, lit(hiSum)) : le(sumTerm, lit(hiSum)));
  }

  // 保留原 Φ 中可平移的事实：若 a 是 var(x) 且 Φ ⊢ x>0，则 sum=x+b 时
  // numericBounds 已处理。此处直接返回 and(facts)。
  if (facts.length === 0) return undefined;
  return and(...facts);
}

type NumBounds = {
  lo?: { value: number; strict: boolean };
  hi?: { value: number; strict: boolean };
};

/**
 * 提取 Abs 上相对 term 的数值界。
 * 优先用自身 pred；否则查 Φ（针对 var id）。
 */
export function numericBounds(a: Abs, phi: Phi = pTrue): NumBounds | undefined {
  if (!isNumPrim(a)) return undefined;
  const result: NumBounds = {};

  // 自身 pred 中关于 term 的界
  if (a.pred && a.term) {
    collectBoundsFromPred(a.pred, a.term, result);
  }
  // Φ 中关于 var 的界
  if (a.term?.op === "var") {
    collectBoundsFromPhi(phi, a.term.id, result);
  }
  // 字面量：上下界都是自身
  if (a.term?.op === "lit" && typeof a.term.value === "number") {
    result.lo = { value: a.term.value, strict: false };
    result.hi = { value: a.term.value, strict: false };
  }

  if (result.lo === undefined && result.hi === undefined) return undefined;
  return result;
}

function collectBoundsFromPred(pred: Pred, term: Term, acc: NumBounds): void {
  const match = (t: Term): boolean => termToString(t) === termToString(term);
  const apply = (p: Pred): void => {
    if (p.op === "and") {
      p.args.forEach(apply);
      return;
    }
    if (p.op === "gt" && match(p.a) && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.lo === undefined || n > acc.lo.value || (n === acc.lo.value && p.op === "gt")) {
        acc.lo = { value: n, strict: true };
      }
      return;
    }
    if (p.op === "ge" && match(p.a) && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.lo === undefined || n > acc.lo.value) {
        acc.lo = { value: n, strict: false };
      }
      return;
    }
    if (p.op === "lt" && match(p.a) && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.hi === undefined || n < acc.hi.value) {
        acc.hi = { value: n, strict: true };
      }
      return;
    }
    if (p.op === "le" && match(p.a) && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.hi === undefined || n < acc.hi.value) {
        acc.hi = { value: n, strict: false };
      }
    }
  };
  apply(pred);
}

function collectBoundsFromPhi(phi: Phi, id: string, acc: NumBounds): void {
  const conjs = phi.op === "and" ? phi.args : [phi];
  for (const p of conjs) {
    if (p.op === "gt" && p.a.op === "var" && p.a.id === id && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.lo === undefined || n > acc.lo.value) {
        acc.lo = { value: n, strict: true };
      }
    }
    if (p.op === "ge" && p.a.op === "var" && p.a.id === id && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.lo === undefined || n > acc.lo.value) {
        acc.lo = { value: n, strict: false };
      }
    }
    if (p.op === "lt" && p.a.op === "var" && p.a.id === id && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.hi === undefined || n < acc.hi.value) {
        acc.hi = { value: n, strict: true };
      }
    }
    if (p.op === "le" && p.a.op === "var" && p.a.id === id && p.b.op === "lit" && typeof p.b.value === "number") {
      const n = p.b.value;
      if (acc.hi === undefined || n < acc.hi.value) {
        acc.hi = { value: n, strict: false };
      }
    }
  }
}

/** 减法：a - b = a + (-b)，数值上做单调性 */
export function sub(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  const va = litValue(a);
  const vb = litValue(b);
  if (typeof va === "number" && typeof vb === "number") {
    return numLit(va - vb);
  }
  if (coercibleLit(va) && coercibleLit(vb)) {
    return numLit(Number(va) - Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("-", [a.term, b.term]));
    // a.lo - b.hi  <  a-b  <  a.hi - b.lo
    const ab = numericBounds(a, phi);
    const bb = numericBounds(b, phi);
    const facts: Pred[] = [];
    if (ab?.lo !== undefined && bb?.hi !== undefined) {
      const lo = ab.lo.value - bb.hi.value;
      const strict = ab.lo.strict || bb.hi.strict;
      facts.push(strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
    }
    if (ab?.hi !== undefined && bb?.lo !== undefined) {
      const hi = ab.hi.value - bb.lo.value;
      const strict = ab.hi.strict || bb.lo.strict;
      facts.push(strict ? lt(term, lit(hi)) : le(term, lit(hi)));
    }
    const conf =
      term.op === "lit"
        ? "exact"
        : confJoin(confJoin(a.conf, b.conf), facts.length ? "path" : "path");
    return abs({ k: "prim", type: "number" }, term, facts.length ? and(...facts) : undefined, conf);
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  // any：JS ToNumber → number（可能 NaN）
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "-");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** 乘法：字面量直接求值；×正数同向缩放；×负数翻转不等式；×0 归零 */
export function mul(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  const va = litValue(a);
  const vb = litValue(b);
  if (typeof va === "number" && typeof vb === "number") {
    return numLit(va * vb);
  }
  if (coercibleLit(va) && coercibleLit(vb)) {
    return numLit(Number(va) * Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("*", [a.term, b.term]));
    // × 0
    if (
      (b.term.op === "lit" && b.term.value === 0) ||
      (a.term.op === "lit" && a.term.value === 0)
    ) {
      return numLit(0);
    }
    // × 常数 k
    let k: number | undefined;
    let base: Abs | undefined;
    if (b.term.op === "lit" && typeof b.term.value === "number") {
      k = b.term.value;
      base = a;
    } else if (a.term.op === "lit" && typeof a.term.value === "number") {
      k = a.term.value;
      base = b;
    }
    if (k !== undefined && base !== undefined && k !== 0) {
      const ab = numericBounds(base, phi);
      const facts: Pred[] = [];
      if (ab?.lo !== undefined) {
        if (k > 0) {
          const lo = ab.lo.value * k;
          facts.push(ab.lo.strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
        } else {
          // 负数：lo * k 变成上界
          const hi = ab.lo.value * k;
          facts.push(ab.lo.strict ? lt(term, lit(normalizeNegZero(hi))) : le(term, lit(normalizeNegZero(hi))));
        }
      }
      if (ab?.hi !== undefined) {
        if (k > 0) {
          const hi = ab.hi.value * k;
          facts.push(ab.hi.strict ? lt(term, lit(hi)) : le(term, lit(hi)));
        } else {
          const lo = ab.hi.value * k;
          facts.push(ab.hi.strict ? gt(term, lit(normalizeNegZero(lo))) : ge(term, lit(normalizeNegZero(lo))));
        }
      }
      return abs(
        { k: "prim", type: "number" },
        term,
        facts.length ? and(...facts) : undefined,
        term.op === "lit" ? "exact" : confJoin(a.conf, "path"),
      );
    }
    return abs(
      { k: "prim", type: "number" },
      term,
      undefined,
      term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path"),
    );
  }
  // number prim（无 term）× number prim → number（与 TypeValue 对齐）
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs({ k: "prim", type: "number" }, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "*");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 除法：字面量折叠；除以正/负常数时按单调性推界。
 * 除以 0：JS 语义为 ±Infinity / NaN，shape 仍 number（不报违例）。
 */
export function div(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  const va = litValue(a);
  const vb = litValue(b);
  if (typeof va === "number" && typeof vb === "number") {
    if (vb === 0) {
      // JS：0/0=NaN，n/0=±Infinity —— 保留字面量语义
      return numLit(va / vb);
    }
    return numLit(va / vb);
  }
  if (coercibleLit(va) && coercibleLit(vb)) {
    return numLit(Number(va) / Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("/", [a.term, b.term]));
    if (b.term.op === "lit" && typeof b.term.value === "number" && b.term.value !== 0) {
      const k = b.term.value;
      const ab = numericBounds(a, phi);
      const facts: Pred[] = [];
      if (ab?.lo !== undefined) {
        const lo = ab.lo.value / k;
        if (k > 0) facts.push(ab.lo.strict ? gt(term, lit(lo)) : ge(term, lit(lo)));
        else facts.push(ab.lo.strict ? lt(term, lit(lo)) : le(term, lit(lo)));
      }
      if (ab?.hi !== undefined) {
        const hi = ab.hi.value / k;
        if (k > 0) facts.push(ab.hi.strict ? lt(term, lit(hi)) : le(term, lit(hi)));
        else facts.push(ab.hi.strict ? gt(term, lit(hi)) : ge(term, lit(hi)));
      }
      return abs(
        num().shape,
        term,
        facts.length ? and(...facts) : undefined,
        term.op === "lit" ? "exact" : confJoin(confJoin(a.conf, b.conf), "path"),
      );
    }
    return abs(num().shape, term, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs(num().shape, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "/");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/**
 * 取模：字面量折叠；`x % k`（k>0 字面量）结果界在 (−|k|, |k|)。
 * 整数模可收紧到 [0, k)，此处先做保守实数界。
 */
export function mod(a: Abs, b: Abs, phi: Phi = pTrue): Abs {
  const va = litValue(a);
  const vb = litValue(b);
  if (typeof va === "number" && typeof vb === "number") {
    if (vb === 0) {
      return abs(num().shape, undefined, undefined, "path");
    }
    return numLit(va % vb);
  }
  if (coercibleLit(va) && coercibleLit(vb)) {
    return numLit(Number(va) % Number(vb));
  }
  if (isNumericLike(a) && isNumericLike(b) && a.term && b.term) {
    const term = simplifyTerm(app("%", [a.term, b.term]));
    if (b.term.op === "lit" && typeof b.term.value === "number" && b.term.value !== 0) {
      const k = Math.abs(b.term.value);
      // 余数始终落在 (−k, k)
      return abs(
        num().shape,
        term,
        and(gt(term, lit(-k)), lt(term, lit(k))),
        confJoin(confJoin(a.conf, b.conf), "path"),
      );
    }
    return abs(num().shape, term, undefined, confJoin(confJoin(a.conf, b.conf), "path"));
  }
  if (isNumericLike(a) && isNumericLike(b)) {
    return abs(num().shape, undefined, undefined, "partial");
  }
  if (isAnyLike(a) || isAnyLike(b)) {
    return toNumberResult(a, b, "%");
  }
  return abs({ k: "unknown" }, undefined, undefined, "partial");
}

/** 比较：返回 boolean Abs；若双字面量则 exact */
export function cmp(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: Abs,
  b: Abs,
  phi: Phi = pTrue,
): Abs {
  const va = litValue(a);
  const vb = litValue(b);
  if (va !== undefined && vb !== undefined) {
    const result = compareLits(op, va, vb);
    if (result !== undefined) return boolLit(result);
  }

  // 符号比较：构造 pred 挂在 boolean 上，供 if 分支消费
  if (a.term && b.term) {
    const pred: Pred =
      op === "lt"
        ? lt(a.term, b.term)
        : op === "le"
          ? le(a.term, b.term)
          : op === "gt"
            ? gt(a.term, b.term)
            : op === "ge"
              ? ge(a.term, b.term)
              : op === "eq"
                ? { op: "eq", a: a.term, b: b.term }
                : { op: "ne", a: a.term, b: b.term };

    // 若 Φ 已蕴含该比较 → true；若蕴含否定 → false
    if (implies(phi, pred)) return boolLit(true);
    const neg: Pred =
      op === "lt"
        ? ge(a.term, b.term)
        : op === "le"
          ? gt(a.term, b.term)
          : op === "gt"
            ? le(a.term, b.term)
            : op === "ge"
              ? lt(a.term, b.term)
              : op === "eq"
                ? { op: "ne", a: a.term, b: b.term }
                : { op: "eq", a: a.term, b: b.term };
    if (implies(phi, neg)) return boolLit(false);

    // 数值界判定：range pred / Φ 中的 min·max 足以决定字面比较
    const decided = decideByBounds(op, a, b, phi);
    if (decided !== undefined) return boolLit(decided);

    return {
      shape: { k: "prim", type: "boolean" },
      term: undefined,
      pred,
      conf: confJoin(confJoin(a.conf, b.conf), "path"),
    };
  }

  return abs({ k: "prim", type: "boolean" }, undefined, undefined, "partial");
}

function compareLits(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: string | number | boolean | null | undefined,
  b: string | number | boolean | null | undefined,
): boolean | undefined {
  if (op === "eq") return a === b;
  if (op === "ne") return a !== b;
  if (typeof a === "number" && typeof b === "number") {
    switch (op) {
      case "lt":
        return a < b;
      case "le":
        return a <= b;
      case "gt":
        return a > b;
      case "ge":
        return a >= b;
    }
  }
  // 字符串字面量比较（JS 词法序）
  if (typeof a === "string" && typeof b === "string") {
    switch (op) {
      case "lt":
        return a < b;
      case "le":
        return a <= b;
      case "gt":
        return a > b;
      case "ge":
        return a >= b;
    }
  }
  // 混合/非字符串原始字面量：JS 关系比较先 ToNumber（NaN 参与时结果恒 false）
  // e.g. `"a" > 3` → false, `"10" < 9` → false, `true > 0` → true
  if (op === "lt" || op === "le" || op === "gt" || op === "ge") {
    // as number: TS 不让对 null/undefined 做关系比较；运行时仍走 JS 语义
    const x = a as number;
    const y = b as number;
    switch (op) {
      case "lt":
        return x < y;
      case "le":
        return x <= y;
      case "gt":
        return x > y;
      case "ge":
        return x >= y;
    }
  }
  return undefined;
}

/**
 * 用数值界判定比较（range Pred / Φ）。
 * 仅当界足以推出结果时返回 true/false，否则 undefined。
 */
function decideByBounds(
  op: "lt" | "le" | "gt" | "ge" | "eq" | "ne",
  a: Abs,
  b: Abs,
  phi: Phi,
): boolean | undefined {
  if (op === "eq" || op === "ne") return undefined;
  const aB = numericBounds(a, phi);
  const bB = numericBounds(b, phi);
  if (!aB && !bB) return undefined;

  // 一侧/两侧字面量界已含在 numericBounds；用 lo/hi 推
  const aLo = aB?.lo;
  const aHi = aB?.hi;
  const bLo = bB?.lo;
  const bHi = bB?.hi;

  // a < b：a.hi < b.lo ⇒ true；a.lo ≥ b.hi ⇒ false
  if (op === "lt") {
    if (aHi && bLo && aHi.value < bLo.value) return true;
    if (aLo && bHi && aLo.value >= bHi.value) return false;
    return undefined;
  }
  if (op === "le") {
    if (aHi && bLo && aHi.value < bLo.value) return true;
    if (aLo && bHi && aLo.value > bHi.value) return false;
    return undefined;
  }
  if (op === "gt") {
    if (aLo && bHi && aLo.value > bHi.value) return true;
    if (aHi && bLo && aHi.value <= bLo.value) return false;
    return undefined;
  }
  if (op === "ge") {
    if (aLo && bHi && aLo.value >= bHi.value) return true;
    if (aHi && bLo && aHi.value < bLo.value) return false;
    return undefined;
  }
  return undefined;
}

/** 从比较结果 Abs 提取「若为真」的额外约束（供 if 使用） */
export function trueConstraint(c: Abs): Pred | undefined {
  if (c.term?.op === "lit" && c.term.value === true) return pTrue;
  if (c.term?.op === "lit" && c.term.value === false) return undefined;
  return c.pred;
}

/**
 * 关系比较为真时收窄操作数 shape。
 * `x > k` 对 any：JS 只允许 number（n>k）或数字字符串（ToNumber(s)>k）。
 * 粗化展示为 `number>… | string`；string 臂不挂 ToNumber pred（Pred 无该构造）。
 */
export function refineAbsForRelTrue(
  a: Abs,
  op: "gt" | "ge" | "lt" | "le",
  k: number,
): Abs {
  const bound = (t: Term): Pred =>
    op === "gt"
      ? gt(t, lit(k))
      : op === "ge"
        ? ge(t, lit(k))
        : op === "lt"
          ? lt(t, lit(k))
          : le(t, lit(k));

  if (isNumPrim(a) && a.term) {
    const pred =
      a.pred && a.pred.op !== "true" ? and(a.pred, bound(a.term)) : bound(a.term);
    return abs(a.shape, a.term, pred, a.conf);
  }
  // string prim：比较已真，shape 保持 string（ToNumber(s) rel k 无法进 Pred）
  if (isStrPrim(a)) return a;
  if ((a.shape.k === "any" || a.shape.k === "unknown") && a.term) {
    const numArm = abs({ k: "prim", type: "number" }, a.term, bound(a.term), "path");
    const strArm = abs({ k: "prim", type: "string" }, a.term, undefined, "path");
    return makeSum(numArm, strArm);
  }
  return a;
}

/**
 * 从 Identifier 在比较中的位置解析「对哪个变量、用哪个关系」。
 * 支持 `x > 3` 与 `3 < x`（后者关系翻转）。
 */
export function matchRelIdentLit(
  test: unknown,
): { name: string; op: "gt" | "ge" | "lt" | "le"; k: number } | undefined {
  const t = test as {
    type?: string;
    operator?: string;
    left?: { type?: string; name?: string; value?: number };
    right?: { type?: string; name?: string; value?: number };
  };
  if (t?.type !== "BinaryExpression") return undefined;
  const rel =
    t.operator === ">"
      ? "gt"
      : t.operator === ">="
        ? "ge"
        : t.operator === "<"
          ? "lt"
          : t.operator === "<="
            ? "le"
            : undefined;
  if (!rel) return undefined;
  if (t.left?.type === "Identifier" && t.left.name && t.right?.type === "NumericLiteral" && typeof t.right.value === "number") {
    return { name: t.left.name, op: rel, k: t.right.value };
  }
  if (t.right?.type === "Identifier" && t.right.name && t.left?.type === "NumericLiteral" && typeof t.left.value === "number") {
    const flipped =
      rel === "gt" ? "lt" : rel === "ge" ? "le" : rel === "lt" ? "gt" : "ge";
    return { name: t.right.name, op: flipped, k: t.left.value };
  }
  return undefined;
}

export function falseConstraint(c: Abs): Pred | undefined {
  if (c.term?.op === "lit" && c.term.value === true) return undefined;
  if (c.term?.op === "lit" && c.term.value === false) return pTrue;
  if (!c.pred) return undefined;
  // 否定 pred
  return negatePred(c.pred);
}

function negatePred(p: Pred): Pred {
  switch (p.op) {
    case "true":
      return { op: "false" };
    case "false":
      return { op: "true" };
    case "eq":
      return { op: "ne", a: p.a, b: p.b };
    case "ne":
      return { op: "eq", a: p.a, b: p.b };
    case "lt":
      return ge(p.a, p.b);
    case "le":
      return gt(p.a, p.b);
    case "gt":
      return le(p.a, p.b);
    case "ge":
      return lt(p.a, p.b);
    case "and":
      // De Morgan：¬(A∧B) = ¬A ∨ ¬B —— Phase A 不展开 or，退回 unknown-ish
      // 保守：返回一个 not 节点（implies 暂不处理）
      return { op: "not", arg: p };
    case "or":
      return { op: "not", arg: p };
    case "not":
      return p.arg;
    case "typeof":
      return { op: "not", arg: p };
  }
}
