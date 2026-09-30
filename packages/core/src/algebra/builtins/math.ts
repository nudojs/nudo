/**
 * Math.* — 字面量实参走 ToNumber/ToInt32 后调用原生折叠；非字面量对
 * min/max/round/floor/ceil/trunc 透传数值区间（#68）。
 *
 * NaN 策略（DEC：显式 NaN 臂）：操作数可能为 NaN 时结果为
 * `NaN | number@bounds`。契约 `ge(0).le(100)` 对 NaN 臂诚实报违例；
 * `if (Number.isNaN(n)) return …` 假臂的 `ne(n, NaN)` 事实可排除 NaN 臂。
 */
import type { Abs } from "../abs.ts";
import { abs, numLit } from "../abs.ts";
import type { Term } from "../term.ts";
import { app as termApp, lit, simplifyTerm, termEquals } from "../term.ts";
import type { Pred } from "../pred.ts";
import { and as pAnd, type Phi } from "../pred.ts";
import { numericBounds, type NumBounds } from "../arithmetic.ts";
import { makeSum } from "../objects.ts";
import { currentExecPhi } from "../exec/runtime/state.ts";
import { numPrim } from "./shared.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs } from "../exec/may-throw.ts";

/**
 * Math 算子实参：ToNumber（clz32/imul 走 ToInt32/ToUint32 由原生完成）。
 * 抽象 / lit(undefined) 不折叠——transpile 把 call spread 占位成 $lit(undefined)，
 * 折成 NaN 会把 `Math.max(...[1,2,3])` 钉成假精确。symbol/bigint 原生 TypeError。
 * 空实参（args 为空）由原生 ToNumber(undefined) 处理（min()→+Inf、abs()→NaN）。
 */
function coerceMathArg(a: Abs | undefined): number | undefined | "throw" {
  if (!a || a.term?.op !== "lit") return undefined;
  const v = a.term.value;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (v === undefined) return undefined;
  // bigint/symbol：ToNumber 抛 TypeError
  return "throw";
}

/** Math 自有数值方法（排除继承的 constructor/toString/valueOf 等） */
function mathMethod(name: string): ((...a: number[]) => number) | undefined {
  if (!Object.hasOwn(Math, name)) return undefined;
  const impl = (Math as unknown as Record<string, unknown>)[name];
  return typeof impl === "function"
    ? (impl as (...a: number[]) => number)
    : undefined;
}

/** 操作数是否确定不是 NaN：非 NaN 字面量 / 数值界 / ne(t,NaN) / assumeFinite */
function isNonNaN(a: Abs, phi: Phi): boolean {
  if (a.term?.op === "lit") {
    return typeof a.term.value === "number" && !Number.isNaN(a.term.value);
  }
  const hasNonNaNFact = (p: Pred | undefined): boolean => {
    if (!p) return false;
    if (p.op === "and") return p.args.some(hasNonNaNFact);
    if (p.op === "assumeFinite") {
      // termless Abs 无法对齐具体 assumeFinite —— 不得采信
      return !!a.term && termEquals(p.t, a.term);
    }
    if (p.op === "ne") {
      // ne(t, NaN) ≡ t 不是 NaN
      if (
        p.b.op === "lit" &&
        typeof p.b.value === "number" &&
        Number.isNaN(p.b.value) &&
        a.term &&
        termEquals(p.a, a.term)
      ) {
        return true;
      }
    }
    if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
      // 数值界排除 NaN（NaN 比较全假）
      if (a.term && (termEquals(p.a, a.term) || termEquals(p.b, a.term))) return true;
    }
    return false;
  };
  if (hasNonNaNFact(a.pred)) return true;
  if (a.term?.op === "var") {
    const id = (a.term as { id: string }).id;
    const conjs = phi.op === "and" ? phi.args : [phi];
    for (const p of conjs) {
      if (p.op === "assumeFinite" && p.t.op === "var" && (p.t as { id: string }).id === id) {
        return true;
      }
      if (p.op === "ne") {
        const b = p.b;
        if (
          b.op === "lit" &&
          typeof b.value === "number" &&
          Number.isNaN(b.value) &&
          p.a.op === "var" &&
          (p.a as { id: string }).id === id
        ) {
          return true;
        }
      }
      if (p.op === "gt" || p.op === "ge" || p.op === "lt" || p.op === "le") {
        const sides = [p.a, p.b];
        if (
          sides.some((t) => t.op === "var" && (t as { id: string }).id === id) &&
          sides.some((t) => t.op === "lit" && typeof t.value === "number")
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

function ieeeBoundNum(n: number): number | undefined {
  return Number.isFinite(n) || n === Infinity || n === -Infinity ? n : undefined;
}

/** min 的 lo = min(a.lo,b.lo)：任一侧无界（-∞）→ 无下界 */
function loMin(a: NumBounds, b: NumBounds): NumBounds["lo"] {
  if (a.lo === undefined || b.lo === undefined) return undefined;
  if (b.lo.value < a.lo.value) return b.lo;
  if (b.lo.value === a.lo.value && b.lo.strict && !a.lo.strict) return b.lo;
  return a.lo;
}
/** max 的 lo = max(a.lo,b.lo)：一侧无界取另一侧 */
function loMax(a: NumBounds, b: NumBounds): NumBounds["lo"] {
  if (a.lo === undefined) return b.lo;
  if (b.lo === undefined) return a.lo;
  if (b.lo.value > a.lo.value) return b.lo;
  if (b.lo.value === a.lo.value && b.lo.strict && !a.lo.strict) return b.lo;
  return a.lo;
}
/** min 的 hi = min(a.hi,b.hi)：一侧无界（+∞）取另一侧 */
function hiMin(a: NumBounds, b: NumBounds): NumBounds["hi"] {
  if (a.hi === undefined) return b.hi;
  if (b.hi === undefined) return a.hi;
  if (b.hi.value < a.hi.value) return b.hi;
  if (b.hi.value === a.hi.value && b.hi.strict && !a.hi.strict) return b.hi;
  return a.hi;
}
/** max 的 hi = max(a.hi,b.hi)：任一侧无界 → 无上界 */
function hiMax(a: NumBounds, b: NumBounds): NumBounds["hi"] {
  if (a.hi === undefined || b.hi === undefined) return undefined;
  if (b.hi.value > a.hi.value) return b.hi;
  if (b.hi.value === a.hi.value && b.hi.strict && !a.hi.strict) return b.hi;
  return a.hi;
}

function boundsToPred(t: Term, b: NumBounds): Pred | undefined {
  const facts: Pred[] = [];
  if (b.lo !== undefined) {
    const v = ieeeBoundNum(b.lo.value);
    if (v !== undefined) {
      facts.push(b.lo.strict ? { op: "gt", a: t, b: lit(v) } : { op: "ge", a: t, b: lit(v) });
    }
  }
  if (b.hi !== undefined) {
    const v = ieeeBoundNum(b.hi.value);
    if (v !== undefined) {
      facts.push(b.hi.strict ? { op: "lt", a: t, b: lit(v) } : { op: "le", a: t, b: lit(v) });
    }
  }
  if (facts.length === 0) return undefined;
  return facts.length === 1 ? facts[0]! : pAnd(...facts);
}

/**
 * min/max 区间：min(a,b)∈[min(lo),min(hi)]、max 对偶。
 * 可能 NaN 时挂 NaN 臂（option 1）。
 */
function minMaxAbs(name: "min" | "max", args: Abs[]): Abs {
  const phi = currentExecPhi();
  // 全字面量已在上游折叠；这里处理非全字面量
  const empty: NumBounds = {};
  let acc: NumBounds = empty;
  // 结果项恒构造（无 term 实参用占位），否则 pred 无锚点 → unproven
  const termArgs: Term[] = args.map((a, i) =>
    a.term ?? termApp(`arg${i}`, []),
  );
  const term = simplifyTerm(termApp(`Math.${name}`, termArgs));
  // min 空参 = +Inf，max 空参 = -Inf（已由折叠处理）；非空时从操作数收
  let first = true;
  let mayNaN = false;
  for (const a of args) {
    if (!isNonNaN(a, phi)) mayNaN = true;
    const b = numericBounds(a, phi) ?? {};
    if (first) {
      acc = { lo: b.lo, hi: b.hi };
      first = false;
      continue;
    }
    if (name === "min") {
      acc = { lo: loMin(acc, b), hi: hiMin(acc, b) };
    } else {
      acc = { lo: loMax(acc, b), hi: hiMax(acc, b) };
    }
  }
  // 无界操作数不贡献端点；min 的 lo 需两侧都有 lo
  const pred = boundsToPred(term, acc);
  const bounded = abs({ k: "prim", type: "number" }, term, pred, "path");

  if (!mayNaN) return bounded;
  const nanArm = numLit(NaN);
  return makeSum(nanArm, bounded);
}

/** round/floor/ceil/trunc：保区间并按函数收紧端点；NaN 臂保留 */
function roundingAbs(
  name: "round" | "floor" | "ceil" | "trunc",
  arg: Abs,
): Abs {
  const phi = currentExecPhi();
  const impl =
    name === "round"
      ? Math.round
      : name === "floor"
        ? Math.floor
        : name === "ceil"
          ? Math.ceil
          : Math.trunc;
  const b = numericBounds(arg, phi);
  const mayNaN = !isNonNaN(arg, phi);
  const term = arg.term ? simplifyTerm(termApp(`Math.${name}`, [arg.term])) : undefined;

  let out: NumBounds = {};
  if (b) {
    if (b.lo !== undefined) {
      const v = impl(b.lo.value);
      out.lo = Number.isNaN(v) ? undefined : { value: v, strict: false };
    }
    if (b.hi !== undefined) {
      const v = impl(b.hi.value);
      out.hi = Number.isNaN(v) ? undefined : { value: v, strict: false };
    }
  }
  const pred = term ? boundsToPred(term, out) : undefined;
  const bounded = abs({ k: "prim", type: "number" }, term, pred, "path");
  if (!mayNaN) return bounded;
  return makeSum(numLit(NaN), bounded);
}

export function evalMathMethod(name: string, args: Abs[]): Abs | undefined {
  if (name === "random") return numPrim("path");

  // 区间透传优先（仍兼容全字面量折叠）
  if (name === "min" || name === "max") {
    const nums: number[] = [];
    let allLit = true;
    for (const a of args) {
      const n = coerceMathArg(a);
      if (n === undefined) {
        allLit = false;
        break;
      }
      if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
      nums.push(n);
    }
    if (allLit) {
      try {
        return numLit((name === "min" ? Math.min : Math.max)(...nums));
      } catch {
        return numPrim();
      }
    }
    // symbol/bigint 实参仍 TypeError（与原生 ToNumber 一致）
    for (const a of args) {
      const n = coerceMathArg(a);
      if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    return minMaxAbs(name, args);
  }

  if (name === "round" || name === "floor" || name === "ceil" || name === "trunc") {
    const n = coerceMathArg(args[0]);
    if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    if (typeof n === "number") {
      try {
        return numLit(
          name === "round"
            ? Math.round(n)
            : name === "floor"
              ? Math.floor(n)
              : name === "ceil"
                ? Math.ceil(n)
                : Math.trunc(n),
        );
      } catch {
        return numPrim();
      }
    }
    if (args[0]) {
      const c2 = coerceMathArg(args[0]);
      if (c2 === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
      return roundingAbs(name, args[0]);
    }
    return numPrim();
  }

  const impl = mathMethod(name);
  if (!impl) return undefined;

  const nums: number[] = [];
  for (const a of args) {
    const n = coerceMathArg(a);
    if (n === undefined) return numPrim();
    if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    nums.push(n);
  }

  try {
    // 空实参：min()→+Inf、max()→-Inf、hypot()→0、abs()→NaN（ToNumber(undefined)）
    // 由原生自身处理，与 ToNumber 语义一致
    return numLit(impl(...nums));
  } catch {
    return numPrim();
  }
}
