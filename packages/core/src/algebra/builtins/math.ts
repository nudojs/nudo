/**
 * Math.* — 字面量实参走 ToNumber/ToInt32 后调用原生折叠；非字面量对
 * min/max/round/floor/ceil/trunc 透传数值区间（#68）。
 *
 * NaN 策略（DEC：显式 NaN 臂）：操作数可能为 NaN 时结果为
 * `NaN | number@bounds`。契约 `ge(0).le(100)` 对 NaN 臂诚实报违例；
 * `if (Number.isNaN(n)) return …` 假臂的 `ne(n, NaN)` 事实可排除 NaN 臂。
 *
 * Invariants（Bug 958）：min/max 的**区间端点合并按合取/析取分家**——
 * 合取位（min 的 lo / max 的 hi：`min(a,b) ≥ L ⟺ a ≥ L ∧ b ≥ L`）端点值
 * 相同取**更松**（非 strict）的一侧；析取位（max 的 lo / min 的 hi）取
 * **更严**的一侧。取反会产出**不可满足**谓词（`min(x,0) > 0 ∧ ≤ 0`）⇒
 * 证明器 ex falso 放电 ⇒ 契约门禁假绿 + 分支选错臂且 `conf: exact`。
 */
import type { Abs } from "../abs.ts";
import { abs, numLit } from "../abs.ts";
import type { Term } from "../term.ts";
import { app as termApp, lit, simplifyTerm } from "../term.ts";
import type { Pred } from "../pred.ts";
import { and as pAnd } from "../pred.ts";
import { numericBounds, isNonNaN, type NumBounds } from "../arithmetic.ts";
import { makeSum } from "../objects.ts";
import { currentExecPhi } from "../exec/runtime/state.ts";
import { numPrim } from "./shared.ts";
import { isBigintPrimAbs, mayCoerceThrowOperand } from "./shared.ts";
import { isSymbolAbs as isSymbolPrim } from "./symbol.ts";
import { NudoThrow } from "../exec/nudo-throw.ts";
import { errorTypeAbs, recordMayThrow } from "../exec/may-throw.ts";
import { noteAbsTruncation, MATH_FOLD_ERROR_LABEL } from "../call-budget.ts";

/**
 * Math 算子实参：ToNumber（clz32/imul 走 ToInt32/ToUint32 由原生完成）。
 * 抽象 / lit(undefined) 不折叠——transpile 把 call spread 占位成 $lit(undefined)，
 * 折成 NaN 会把 `Math.max(...[1,2,3])` 钉成假精确。symbol/bigint 原生 TypeError。
 * 空实参（args 为空）由原生 ToNumber(undefined) 处理（min()→+Inf、abs()→NaN）。
 */
function coerceMathArg(a: Abs | undefined): number | undefined | "throw" {
  if (!a || a.term?.op !== "lit") {
    // Bug 25：shape 先于 lit——prim symbol/bigint（无 lit 项，Symbol()/BigInt(x)
    // 产物）ToNumber 恒抛 TypeError（node 实测 Math.abs(1n)/Math.floor(Symbol())）
    if (a && (isSymbolPrim(a) || isBigintPrimAbs(a))) return "throw";
    return undefined;
  }
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

function ieeeBoundNum(n: number): number | undefined {
  return Number.isFinite(n) || n === Infinity || n === -Infinity ? n : undefined;
}

/**
 * min 的 lo = min(a.lo,b.lo)：任一侧无界（-∞）→ 无下界。
 *
 * Bug 958（合取语义）：`min(a,b) ≥ L ⟺ a ≥ L ∧ b ≥ L` ⇒ 端点值相同时取
 * **更松**（非 strict）的一侧——`a > 0 ∧ b ≥ 0` 只能推出 `min(a,b) ≥ 0`
 * （b 可恰为 0 ⇒ min = 0），取严的一侧会造出 `> 0 ∧ ≤ 0` 的**不可满足**
 * 谓词（ex falso ⇒ 契约门禁假绿 / 分支选错臂且 conf: exact）。
 */
function loMin(a: NumBounds, b: NumBounds): NumBounds["lo"] {
  if (a.lo === undefined || b.lo === undefined) return undefined;
  if (b.lo.value < a.lo.value) return b.lo;
  if (b.lo.value === a.lo.value && !b.lo.strict && a.lo.strict) return b.lo;
  return a.lo;
}
/**
 * max 的 lo = max(a.lo,b.lo)：一侧无界取另一侧。
 *
 * Bug 958（析取语义）：`max(a,b) ≥ L ⟺ a ≥ L ∨ b ≥ L` ⇒ 端点值相同时取
 * **更严**（strict）的一侧——`a ≥ 0 ∧ b > 0` 时 max 恒 > 0（max ≥ b > 0）。
 */
function loMax(a: NumBounds, b: NumBounds): NumBounds["lo"] {
  if (a.lo === undefined) return b.lo;
  if (b.lo === undefined) return a.lo;
  if (b.lo.value > a.lo.value) return b.lo;
  if (b.lo.value === a.lo.value && b.lo.strict && !a.lo.strict) return b.lo;
  return a.lo;
}
/**
 * min 的 hi = min(a.hi,b.hi)：一侧无界（+∞）取另一侧。
 *
 * Bug 958（析取语义）：`min(a,b) ≤ U ⟺ a ≤ U ∨ b ≤ U` ⇒ 端点值相同时取
 * **更严**（strict）的一侧——`a ≤ 0 ∧ b < 0` 时 min 恒 < 0（min ≤ b < 0）。
 */
function hiMin(a: NumBounds, b: NumBounds): NumBounds["hi"] {
  if (a.hi === undefined) return b.hi;
  if (b.hi === undefined) return a.hi;
  if (b.hi.value < a.hi.value) return b.hi;
  if (b.hi.value === a.hi.value && b.hi.strict && !a.hi.strict) return b.hi;
  return a.hi;
}
/**
 * max 的 hi = max(a.hi,b.hi)：任一侧无界 → 无上界。
 *
 * Bug 958（合取语义）：`max(a,b) ≤ U ⟺ a ≤ U ∧ b ≤ U` ⇒ 端点值相同时取
 * **更松**（非 strict）的一侧（`a < 0 ∧ b ≤ 0` 只能推出 `max(a,b) ≤ 0`——
 * b 可恰为 0 ⇒ max = 0）。与 loMin 同款：取严的一侧会造出不可满足谓词。
 */
function hiMax(a: NumBounds, b: NumBounds): NumBounds["hi"] {
  if (a.hi === undefined || b.hi === undefined) return undefined;
  if (b.hi.value > a.hi.value) return b.hi;
  if (b.hi.value === a.hi.value && !b.hi.strict && a.hi.strict) return b.hi;
  return a.hi;
}

/**
 * 数值区间 → pred（lo 事实 + hi 事实）。
 *
 * Bug 958 **自洽性守卫**：lo/hi 端点构成**空区间**（值序颠倒 lo > hi，
 * 或同值但至少一侧 strict ⇒ `v < x < v` / `v < x ≤ v` / `v ≤ x < v`）时，
 * 两条事实互斥 ⇒ 合成为 pred 即**不可满足**谓词 ⇒ 证明器 ex falso 放电
 * ⇒ 真正的契约违例被判「已证明」（门禁**假绿**）。
 *
 * 守卫方向取 sound：空区间 ⇒ **不发**这两条事实（退化成无界）。宁可少
 * 一条界证据（后续证明通道报不出界 ⇒ 报红），也不制造一条假证据
 * （假绿）。修正端点 tie-break（loMin/hiMax）后本守卫对**相容**操作数
 * 不触发（合并区间非空）——它是最后一道防线。
 */
function boundsToPred(t: Term, b: NumBounds): Pred | undefined {
  const facts: Pred[] = [];
  let loV: number | undefined;
  let loStrict = false;
  let hiV: number | undefined;
  let hiStrict = false;
  if (b.lo !== undefined) {
    const v = ieeeBoundNum(b.lo.value);
    if (v !== undefined) {
      loV = v;
      loStrict = b.lo.strict;
      facts.push(b.lo.strict ? { op: "gt", a: t, b: lit(v) } : { op: "ge", a: t, b: lit(v) });
    }
  }
  if (b.hi !== undefined) {
    const v = ieeeBoundNum(b.hi.value);
    if (v !== undefined) {
      hiV = v;
      hiStrict = b.hi.strict;
      facts.push(b.hi.strict ? { op: "lt", a: t, b: lit(v) } : { op: "le", a: t, b: lit(v) });
    }
  }
  if (facts.length === 0) return undefined;
  // 空区间 ⇒ 事实互斥 ⇒ 不得发出（见上）
  if (
    loV !== undefined &&
    hiV !== undefined &&
    (loV > hiV || (loV === hiV && (loStrict || hiStrict)))
  ) {
    return undefined;
  }
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
  // 结果项恒构造（无 term 实参用占位，同 minMaxAbs），否则 pred 无锚点
  // → 界算出却挂不上（sum 实参无 term，Math.round(clamp100(sum)) 退化成
  // 纯 number，区间契约 unproven）。
  const term = simplifyTerm(
    termApp(`Math.${name}`, [arg.term ?? termApp("arg0", [])]),
  );

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
  const pred = boundsToPred(term, out);
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
        // 原生折叠抛错（宿主篡改 Math.* 等）：拓宽为 number 必须可观测
        noteAbsTruncation(MATH_FOLD_ERROR_LABEL);
        return numPrim();
      }
    }
    // symbol/bigint 实参仍 TypeError（与原生 ToNumber 一致）
    for (const a of args) {
      const n = coerceMathArg(a);
      if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    }
    // Bug 25：抽象实参（any/obj/…）ToPrimitive 后可能成 Symbol/BigInt 值 →
    // ToNumber may TypeError（node 实测 Math.max({valueOf(){return 1n}}) 抛）
    if (args.some((a) => mayCoerceThrowOperand(a))) {
      recordMayThrow({ kind: "TypeError", cause: "Math operand ToNumber may throw (Symbol/BigInt)" });
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
        // 原生折叠抛错（宿主篡改 Math.* 等）：拓宽为 number 必须可观测
        noteAbsTruncation(MATH_FOLD_ERROR_LABEL);
        return numPrim();
      }
    }
    if (args[0]) {
      const c2 = coerceMathArg(args[0]);
      if (c2 === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
      // Bug 25：抽象操作数 ToNumber may TypeError（同 min/max 口径）
      if (mayCoerceThrowOperand(args[0])) {
        recordMayThrow({ kind: "TypeError", cause: "Math operand ToNumber may throw (Symbol/BigInt)" });
      }
      return roundingAbs(name, args[0]);
    }
    return numPrim();
  }

  const impl = mathMethod(name);
  if (!impl) return undefined;

  const nums: number[] = [];
  for (const a of args) {
    const n = coerceMathArg(a);
    if (n === undefined) {
      // Bug 25：抽象操作数 ToNumber may TypeError（symbol/bigint 载体）
      if (mayCoerceThrowOperand(a)) {
        recordMayThrow({ kind: "TypeError", cause: "Math operand ToNumber may throw (Symbol/BigInt)" });
      }
      return numPrim();
    }
    if (n === "throw") throw new NudoThrow(errorTypeAbs("TypeError"));
    nums.push(n);
  }

  try {
    // 空实参：min()→+Inf、max()→-Inf、hypot()→0、abs()→NaN（ToNumber(undefined)）
    // 由原生自身处理，与 ToNumber 语义一致
    return numLit(impl(...nums));
  } catch {
    // 原生折叠抛错（宿主篡改 Math.* 等）：拓宽为 number 必须可观测
    noteAbsTruncation(MATH_FOLD_ERROR_LABEL);
    return numPrim();
  }
}
