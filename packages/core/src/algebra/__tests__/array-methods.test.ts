/**
 * Wave 7 回归：Array.prototype / Array 静态方法族的值域 + throws 域。
 * 覆盖 bug-report 21/28/36/49/51/55/56/65/66/67/71/73/74/84：
 * - 回调/比较器 GetMethod/IsCallable 前置校验（空接收者零迭代也要抛）；
 * - 下标实参 ToIntegerOrInfinity 校验（symbol/bigint shape 判定）；
 * - join 逐元素 ToString 校验；Number/BigInt 原型方法实参校验；
 * - flat/toReversed/toSpliced/with/concat/slice/indexOf/lastIndexOf/
 * findLast/findLastIndex/toSorted/reverse(表达式) 的值域建模；
 * - flatMap 展开投影（first-wins 不丢元素 + 非数组映射值原样追加）。
 * 基准：node v26 原生语义（native 是 ground truth）。
 * throws 面：definite NudoThrow → result=never + throws=TypeError；
 * may → throws=never + effects 含 kind（L2 门在 effects 上）。
 */
import { describe, it, expect } from "vitest";
// 经 src 直引（同 differential/harness.ts）：vitest 下 @nudojs/core 走
// node_modules dist（陈旧），与下方 live src 的 may-throw 会话收集器分裂成
// 两个模块实例——软效果（recordMayThrow）永远进不了本文件的 collector
import {
  runTranspiled,
  callTranspiledExportFull,
  litValue,
  abs,
  formatAbs,
  formatShape,
  num,
  str,
  type Abs,
} from "../../index.ts";
import {
  runWithMayThrowSession,
  setMayThrowCollector,
  type MayThrowEffect,
} from "../diagnostics/may-throw.ts";
import { denoteGuard } from "../denote.ts";

const anyAbs = abs({ k: "any" }, undefined, undefined, "path");

function call(src: string, args: unknown[] = [], fnName = "f") {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(exports, fnName, args as never);
}

/** tuple 元素具体值（litValue 不折整 tuple；嵌套 tuple 递归） */
function els(r: { result?: unknown }): unknown[] {
  const a = r.result as { shape?: { k?: string; elements?: Array<{ shape?: unknown }> } };
  return (a?.shape?.elements ?? []).map((e) => {
    const s = (e as { shape?: { k?: string } }).shape;
    if (s?.k === "tuple") return els({ result: e });
    const lv = litValue(e as never);
    return lv.ok ? lv.value : undefined;
  });
}

/** 值 + throws + may-effects 三面（effects 去重 kind） */
function evalSrc(
  src: string,
  args: unknown[] = [],
  fnName = "f",
): { value: string; throws: string; effects: string[] } {
  const run = runTranspiled(src, { mode: "analyze" });
  const effects: MayThrowEffect[] = [];
  let result: { result?: unknown; throws?: unknown } = {};
  runWithMayThrowSession(() => {
    setMayThrowCollector((e) => effects.push(e));
    try {
      result = callTranspiledExportFull(run, fnName, args as never[]) as never;
    } catch {
      /* 入口整抛：throws 面表达 */
    }
    setMayThrowCollector(null);
  });
  const norm = (a: unknown): string =>
    formatAbs(a as never)?.replace(/\s+#[a-z]+$/, "") ?? "";
  return {
    value: norm(result.result),
    throws: norm(result.throws),
    effects: [...new Set(effects.map((e) => e.kind))],
  };
}

const throwsTypeError = (r: { throws: string }): boolean =>
  r.throws === "TypeError";
const throwsRangeError = (r: { throws: string }): boolean =>
  r.throws === "RangeError";

describe("HOF callback GetCallback validation", () => {
  it("non-callable callback on EMPTY receiver still definite-throws (spec order)", () => {
    for (const m of [
      "map", "filter", "some", "every", "forEach", "find", "findIndex",
      "findLast", "findLastIndex", "flatMap", "reduce", "reduceRight",
    ]) {
      const r = evalSrc(`export function f() { return [].${m}(Symbol()); }`);
      expect(throwsTypeError(r), m).toBe(true);
    }
  });

  it("non-callable callback on non-empty receiver definite-throws", () => {
    for (const m of [
      "map", "filter", "some", "every", "forEach", "find", "findIndex",
      "findLast", "findLastIndex", "flatMap", "reduce", "reduceRight",
    ]) {
      const r = evalSrc(`export function f() { return [1].${m}(Symbol()); }`);
      expect(throwsTypeError(r), m).toBe(true);
    }
  });

  it("reduce single-element no-initial path validates before taking the element", () => {
    // native: [1].reduce(Symbol()) → TypeError（IsCallable 先于取首元素）
    const r = evalSrc(`export function f() { return [1].reduce(Symbol()); }`);
    expect(throwsTypeError(r)).toBe(true);
    const r2 = evalSrc(`export function f() { return [1].reduceRight(Symbol()); }`);
    expect(throwsTypeError(r2)).toBe(true);
  });

  it("null/undefined/absent callbacks definite-throw (undefined is not a function)", () => {
    for (const cb of ["null", "undefined", ""]) {
      const r = evalSrc(`export function f() { return [1].map(${cb}); }`);
      expect(throwsTypeError(r), `map(${cb || "absent"})`).toBe(true);
    }
  });

  it("any callback → may TypeError, value domain conservative", () => {
    const r = evalSrc(`export function f(x) { return [1].map(x); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    expect(r.value).not.toBe("never");
    const r2 = evalSrc(`export function f(x) { return [].map(x); }`, [anyAbs]);
    expect(r2.effects).toContain("TypeError");
  });

  it("valid fn callbacks unchanged (control)", () => {
    const r = evalSrc(`export function f() { return [1].map((v) => v); }`);
    expect(r.value).toBe("[1]");
    expect(r.throws).toBe("never");
    expect(r.effects).toEqual([]);
  });
});

describe("sort comparator GetSortComparator validation", () => {
  it("non-callable comparator (both positions) definite-throws", () => {
    for (const cmp of ["1", "Symbol()", "null", '"x"']) {
      const stmt = evalSrc(`export function f() { const a = [3,1,2]; a.sort(${cmp}); return a; }`);
      expect(throwsTypeError(stmt), `stmt sort(${cmp})`).toBe(true);
      const expr = evalSrc(`export function f() { return [3,1,2].sort(${cmp}); }`);
      expect(throwsTypeError(expr), `expr sort(${cmp})`).toBe(true);
      const toSorted = evalSrc(`export function f() { return [3,1,2].toSorted(${cmp}); }`);
      expect(throwsTypeError(toSorted), `toSorted(${cmp})`).toBe(true);
    }
  });

  it("absent / strict undefined / fn comparator legal (control)", () => {
    for (const cmp of ["", "undefined", "(p, q) => p - q"]) {
      const stmt = evalSrc(`export function f() { const a = [3,1,2]; a.sort(${cmp}); return a; }`);
      expect(stmt.throws, `stmt sort(${cmp || "absent"})`).toBe("never");
      expect(stmt.effects, `stmt sort(${cmp || "absent"})`).toEqual([]);
    }
    const expr = evalSrc(`export function f() { return [3,1,2].sort(); }`);
    expect(expr.throws).toBe("never");
  });

  it("abstract comparator → may TypeError", () => {
    const r = evalSrc(`export function f(x) { const a = [3,1,2]; a.sort(x); return a; }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    const r2 = evalSrc(`export function f(x) { return [3,1,2].toSorted(x); }`, [anyAbs]);
    expect(r2.effects).toContain("TypeError");
  });

  it("default comparator sorts literal tuples exactly (ToString order)", () => {
    // native: [1,2,3]；[10,1,2] → [1,10,2]（"1" < "10" < "2"）
    expect(els(call(`export function f() { return [3,1,2].sort(); }`))).toEqual([1, 2, 3]);
    expect(els(call(`export function f() { return [10,1,2].sort(); }`))).toEqual([1, 10, 2]);
    // undefined 恒排尾不参与比较
    expect(els(call(`export function f() { return [3,undefined,1].sort(); }`))).toEqual([1, 3, undefined]);
    expect(els(call(`export function f() { return [3,1,2].toSorted(); }`))).toEqual([1, 2, 3]);
    expect(evalSrc(`export function f() { return [3,1,2].sort(); }`).throws).toBe("never");
  });

  it("statement sort is exact for literal tuples (Bug 49 unification)", () => {
    // 语句位与表达式位同一事实源（sortTupleAbs）：默认比较器 + 全字面量
    // → 精确排序容器（此前语句位钉降级 (3|1|2)[]）
    const r = evalSrc(`export function f() { const a = [3,1,2]; a.sort(); return a; }`);
    expect(r.value).toBe("[1, 2, 3]");
    expect(r.throws).toBe("never");
  });

  it("default comparator on ≥2 comparable elements incl. symbol → definite TypeError", () => {
    // native: [Symbol(),1].sort() → TypeError（比较 ToString）
    const r = evalSrc(`export function f() { return [Symbol(), 1].sort(); }`);
    expect(throwsTypeError(r)).toBe(true);
    // 单元素 symbol 不比较 → 合法（native [Symbol()].sort() → [Symbol()]）
    const r2 = evalSrc(`export function f() { return [Symbol()].sort(); }`);
    expect(r2.throws).toBe("never");
    expect(r2.effects).toEqual([]);
    // 比较器在场时不做 ToString → symbol 元素合法
    const r3 = evalSrc(`export function f() { return [Symbol()].sort(() => 0); }`);
    expect(r3.throws).toBe("never");
    expect(r3.effects).toEqual([]);
  });
});

describe("flatMap flatten projection", () => {
  it("flatMap(x => x) keeps non-array mapped values as elements", () => {
    // native: [1,2]
    const r = evalSrc(`export function f() { return [1, 2].flatMap((x) => x); }`);
    expect(r.value).toBe("(1 | 2)[]");
    expect(r.throws).toBe("never");
    // native: ["ab"]
    const r2 = evalSrc(`export function f() { return [1].flatMap(() => "ab"); }`);
    expect(r2.value).toBe('"ab"[]');
  });

  it("structural elements join instead of first-wins (unsound narrowing fixed)", () => {
    // native: [[1],[2]] — 元素域 [1] | [2]
    const r = evalSrc(`export function f() { return [1, 2].flatMap((v) => [[v]]); }`);
    expect(r.value).toBe("([1] | [2])[]");
    // native: [[1,1],[2,2]]
    const r2 = evalSrc(`export function f() { return [1, 2].flatMap((v) => [[v, v]]); }`);
    expect(r2.value).not.toBe("[1, 1][]");
  });

  it("empty flatten returns exact empty tuple, not unknown", () => {
    const r = evalSrc(`export function f() { return [1].flatMap(() => []); }`);
    expect(r.value).toBe("[]");
  });

  it("array-returning callback control unchanged", () => {
    const r = evalSrc(`export function f() { return [1, 2].flatMap((v) => [v, v]); }`);
    expect(r.value).toBe("(1 | 2)[]");
  });
});

describe("Array.from receiver + mapper validation", () => {
  it("nullish/absent receiver definite TypeError", () => {
    for (const recv of ["null", "undefined", ""]) {
      const r = evalSrc(`export function f() { return Array.from(${recv}); }`);
      expect(throwsTypeError(r), `from(${recv || "absent"})`).toBe(true);
    }
  });

  it("abstract receiver → may TypeError", () => {
    const r = evalSrc(`export function f(x) { return Array.from(x); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
  });

  it("non-callable mapper definite TypeError, even on empty receiver", () => {
    // native: Array.from([], 1) → TypeError（GetMethod 先于迭代）；null 同抛
    for (const mapper of ["1", "null", '"x"']) {
      const r = evalSrc(`export function f() { return Array.from([], ${mapper}); }`);
      expect(throwsTypeError(r), `from([], ${mapper})`).toBe(true);
      const r2 = evalSrc(`export function f() { return Array.from([1], ${mapper}); }`);
      expect(throwsTypeError(r2), `from([1], ${mapper})`).toBe(true);
    }
  });

  it("abstract mapper → may TypeError; absent/undefined mapper legal", () => {
    const r = evalSrc(`export function f(x) { return Array.from([], x); }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    const r2 = evalSrc(`export function f() { return Array.from([], undefined); }`);
    expect(r2.throws).toBe("never");
    expect(r2.effects).toEqual([]);
  });

  it("valid receivers unchanged (controls)", () => {
    const r = evalSrc(`export function f() { return Array.from("ab"); }`);
    expect(r.value).toBe("string[]");
    expect(r.throws).toBe("never");
    const r2 = evalSrc(`export function f() { return Array.from([1, 2], (x) => x + 1); }`);
    expect(r2.value).toBe("(2 | 3)[]");
    expect(r2.throws).toBe("never");
  });
});

describe("join symbol-element check", () => {
  it("symbol element definite TypeError; abstract element may throw", () => {
    const r = evalSrc(`export function f() { return [Symbol()].join(); }`);
    expect(throwsTypeError(r)).toBe(true);
    const r2 = evalSrc(`export function f() { return [Symbol(), Symbol()].join(","); }`);
    expect(throwsTypeError(r2)).toBe(true);
    const r3 = evalSrc(`export function f(x) { return [x].join(); }`, [anyAbs]);
    expect(r3.effects).toContain("TypeError");
    expect(r3.value).toBe("string");
  });

  it("legal elements keep path string (controls)", () => {
    // 全字面量元素 + 缺省分隔符 → 精确折叠（原生 ToString 语义）
    const r1 = evalSrc(`export function f() { return [1n].join(); }`);
    expect(r1.value).toBe('"1"');
    expect(r1.throws).toBe("never");
    // undefined/null 字面量元素合法（ToString 不抛）
    const r2 = evalSrc(`export function f() { return [undefined, null].join(); }`);
    expect(r2.throws).toBe("never");
    expect(r2.effects).toEqual([]);
  });
});

describe("mutator index args ToIntegerOrInfinity", () => {
  it("symbol index definite TypeError (splice/copyWithin/fill), empty receiver too", () => {
    for (const m of ["splice", "copyWithin", "fill"]) {
      const arg = m === "fill" ? `1, Symbol()` : "Symbol()";
      const r = evalSrc(`export function f() { const a = [1,2]; a.${m}(${arg}); return a; }`);
      expect(throwsTypeError(r), `${m}(${arg})`).toBe(true);
      const r2 = evalSrc(`export function f() { const a = []; a.${m}(${arg}); return a; }`);
      expect(throwsTypeError(r2), `empty ${m}(${arg})`).toBe(true);
    }
  });

  it("bigint index definite TypeError (native ToNumber(bigint) throws)", () => {
    const r = evalSrc(`export function f() { const a = [1,2]; a.splice(1n); return a; }`);
    expect(throwsTypeError(r)).toBe(true);
    const r2 = evalSrc(`export function f() { const a = [1,2]; a.copyWithin(1n); return a; }`);
    expect(throwsTypeError(r2)).toBe(true);
    const r3 = evalSrc(`export function f() { const a = [1,2]; a.fill(1, 1n); return a; }`);
    expect(throwsTypeError(r3)).toBe(true);
  });

  it("abstract index → may TypeError; fill VALUE arg never validated", () => {
    const r = evalSrc(`export function f(x) { const a = [1,2]; a.splice(x); return a; }`, [anyAbs]);
    expect(r.effects).toContain("TypeError");
    const r2 = evalSrc(`export function f(x) { const a = [1,2]; a.copyWithin(x); return a; }`, [anyAbs]);
    expect(r2.effects).toContain("TypeError");
    const r3 = evalSrc(`export function f(x) { const a = [1,2]; a.fill(1, x); return a; }`, [anyAbs]);
    expect(r3.effects).toContain("TypeError");
    // fill(Symbol()) 原生合法（存储不转换）
    const r4 = evalSrc(`export function f() { const a = [1,2]; a.fill(Symbol()); return a; }`);
    expect(r4.throws).toBe("never");
    expect(r4.effects).toEqual([]);
  });

  it("legal index args unchanged (controls)", () => {
    const r1 = evalSrc(`export function f() { const a = [1,2]; a.splice(0, 1); return a; }`);
    expect(r1.throws).toBe("never");
    expect(r1.effects).toEqual([]);
    expect(evalSrc(`export function f() { const a = [1,2]; a.copyWithin(0, 1); return a; }`).value).toBe("[2, 2]");
    expect(evalSrc(`export function f() { const a = [1,2]; a.fill(9); return a; }`).value).toBe("[9, 9]");
  });
});

describe("Number/BigInt prototype method arg validation", () => {
  it("symbol arg definite TypeError; abstract arg may throw", () => {
    for (const m of ["toString", "toFixed", "toExponential", "toPrecision"]) {
      const r = evalSrc(`export function f() { return (1).${m}(Symbol()); }`);
      expect(throwsTypeError(r), m).toBe(true);
      const r2 = evalSrc(`export function f(x) { return (1).${m}(x); }`, [anyAbs]);
      expect(r2.effects, m).toContain("TypeError");
      expect(r2.value).toBe("string");
    }
    const rb = evalSrc(`export function f() { return (1n).toString(Symbol()); }`);
    expect(throwsTypeError(rb)).toBe(true);
    const rb2 = evalSrc(`export function f(x) { return (1n).toString(x); }`, [anyAbs]);
    expect(rb2.effects).toContain("TypeError");
  });

  it("literal args keep real-execution path (controls)", () => {
    // (1).toString(100) → RangeError（radix ∉ 2..36）
    const r = evalSrc(`export function f() { return (1).toString(100); }`);
    expect(throwsRangeError(r)).toBe(true);
    expect(litValue(call(`export function f() { return (255).toString(16); }`).result)).toEqual({ ok: true, value: "ff" });
    expect(litValue(call(`export function f() { return (5).valueOf(); }`).result)).toEqual({ ok: true, value: 5 });
    // toLocaleString 实参原生不转换（ICU 路径）：(1).toLocaleString(Symbol()) → "1"
    const r3 = evalSrc(`export function f() { return (1).toLocaleString(Symbol()); }`);
    expect(r3.throws).toBe("never");
    expect(r3.effects).toEqual([]);
  });
});

describe("flat/toReversed/toSpliced/with/concat/slice/indexOf/lastIndexOf", () => {
  it("value domain folds on literal tuples", () => {
    expect(els(call(`export function f() { return [1, [2]].flat(); }`))).toEqual([1, 2]);
    expect(els(call(`export function f() { return [1, [2, [3]]].flat(2); }`))).toEqual([1, 2, 3]);
    expect(els(call(`export function f() { return [1, [2]].flat(-1); }`))).toEqual([1, [2]]);
    expect(els(call(`export function f() { return [1, 2, 3].toReversed(); }`))).toEqual([3, 2, 1]);
    expect(els(call(`export function f() { return [1, 2, 3].with(1, 9); }`))).toEqual([1, 9, 3]);
    expect(els(call(`export function f() { return [1, 2, 3].with(-3, 9); }`))).toEqual([9, 2, 3]);
    expect(els(call(`export function f() { return [1, 2].concat([3]); }`))).toEqual([1, 2, 3]);
    expect(els(call(`export function f() { return [1, 2].concat(3, [4]); }`))).toEqual([1, 2, 3, 4]);
    expect(els(call(`export function f() { return [1, 2].slice(1); }`))).toEqual([2]);
    expect(els(call(`export function f() { return [1, 2, 3].slice(-1); }`))).toEqual([3]);
    expect(els(call(`export function f() { return [1, 2, 3].slice(1, -1); }`))).toEqual([2]);
    expect(litValue(call(`export function f() { return [1, 2].indexOf(2); }`).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return [1, 2].indexOf(3); }`).result)).toEqual({ ok: true, value: -1 });
    expect(litValue(call(`export function f() { return [1, 2, 1].lastIndexOf(1); }`).result)).toEqual({ ok: true, value: 2 });
    expect(els(call(`export function f() { return [1, 2, 3].toSpliced(1, 1, 9); }`))).toEqual([1, 9, 3]);
    expect(els(call(`export function f() { return [1, 2, 3].toSpliced(1); }`))).toEqual([1]);
  });

  it("with OOB literal index → definite RangeError; negative past start ditto", () => {
    const r = evalSrc(`export function f() { return [1, 2, 3].with(5, 9); }`);
    expect(throwsRangeError(r)).toBe(true);
    const r2 = evalSrc(`export function f() { return [1, 2, 3].with(-4, 9); }`);
    expect(throwsRangeError(r2)).toBe(true);
  });

  it("flat/slice/indexOf-fromIndex symbol index → definite TypeError; abstract → may", () => {
    const r = evalSrc(`export function f() { return [1].flat(Symbol()); }`);
    expect(throwsTypeError(r)).toBe(true);
    const r2 = evalSrc(`export function f(x) { return [1].flat(x); }`, [anyAbs]);
    expect(r2.effects).toContain("TypeError");
    const r3 = evalSrc(`export function f() { return [1, 2].slice(Symbol()); }`);
    expect(throwsTypeError(r3)).toBe(true);
    const r4 = evalSrc(`export function f(x) { return [1, 2].slice(x); }`, [anyAbs]);
    expect(r4.effects).toContain("TypeError");
    // 原生 indexOf fromIndex 经 ToIntegerOrInfinity：symbol 抛
    const r5 = evalSrc(`export function f() { return [1, 2].indexOf(2, Symbol()); }`);
    expect(throwsTypeError(r5)).toBe(true);
    const r6 = evalSrc(`export function f() { return [1, 2].lastIndexOf(2, Symbol()); }`);
    expect(throwsTypeError(r6)).toBe(true);
  });

  it("modeled neighbors unchanged (controls)", () => {
    expect(els(call(`export function f() { return [1, 2].map((x) => x); }`))).toEqual([1, 2]);
    expect(litValue(call(`export function f() { return [1, 2].at(1); }`).result)).toEqual({ ok: true, value: 2 });
  });
});

describe("at index validation", () => {
  it("symbol index definite TypeError; abstract → may + conservative union", () => {
    const r = evalSrc(`export function f() { return [1, 2].at(Symbol()); }`);
    expect(throwsTypeError(r)).toBe(true);
    const r2 = evalSrc(`export function f(x) { return [1, 2].at(x); }`, [anyAbs]);
    expect(r2.effects).toContain("TypeError");
    expect(r2.value).toContain("1 | 2 | undefined");
  });

  it("literal folds unchanged (controls)", () => {
    expect(litValue(call(`export function f() { return [1, 2].at(1); }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return [1, 2].at(-1); }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return [1, 2].at(5); }`).result)).toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return [1, 2].at(); }`).result)).toEqual({ ok: true, value: 1 });
  });
});

describe("expression-position reverse", () => {
  it("reverse() folds exactly in expression position", () => {
    expect(els(call(`export function f() { return [1, 2, 3].reverse(); }`))).toEqual([3, 2, 1]);
    const r = evalSrc(`export function f() { return [1, 2, 3].reverse(); }`);
    expect(r.throws).toBe("never");
    expect(r.effects).toEqual([]);
  });

  it("statement-position rebinding unchanged (control)", () => {
    expect(els(call(`export function g() { const a = [1, 2, 3]; a.reverse(); return a; }`, [], "g"))).toEqual([3, 2, 1]);
  });
});

describe("findLast/findLastIndex/toSorted", () => {
  it("valid calls keep the value domain", () => {
    expect(litValue(call(`export function f() { return [1, 2].findLast((v) => v > 1); }`).result)).toEqual({ ok: true, value: 2 });
    expect(litValue(call(`export function f() { return [1, 2].findLastIndex((v) => v > 1); }`).result)).toEqual({ ok: true, value: 1 });
    expect(litValue(call(`export function f() { return [1, 2].findLast((v) => false); }`).result)).toEqual({ ok: true, value: undefined });
    expect(litValue(call(`export function f() { return [1, 2].findLastIndex((v) => false); }`).result)).toEqual({ ok: true, value: -1 });
    expect(els(call(`export function f() { return [3, 1, 2].toSorted(); }`))).toEqual([1, 2, 3]);
  });

  it("non-callable callback/comparator definite TypeError; abstract → may", () => {
    for (const m of ["findLast", "findLastIndex", "toSorted"]) {
      const r = evalSrc(`export function f() { return [1, 2].${m}(Symbol()); }`);
      expect(throwsTypeError(r), m).toBe(true);
      const r2 = evalSrc(`export function f(x) { return [1, 2].${m}(x); }`, [anyAbs]);
      expect(r2.effects, m).toContain("TypeError");
    }
    // 空接收者同样前置校验
    const r3 = evalSrc(`export function f() { return [].findLast(Symbol()); }`);
    expect(throwsTypeError(r3)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fix-16：BUG-357 flat 元素域 / BUG-364 数组迭代器元素域
// ---------------------------------------------------------------------------
describe("flat 的元素域 = 展开后的元素域（不再与原元素 join）", () => {
  const numAbs = num();
  const strAbs = str();
  const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");

  it("T[][] flat() → T[]；flat(0) 不展开；flat(2) 递归两层", () => {
    const nn = arrOf(arrOf(numAbs));
    expect(formatShape(call(`export function f(xs) { return xs.flat(); }`, [nn]).result as never)).toBe("number[]");
    expect(formatShape(call(`export function f(xs) { return xs.flat(0); }`, [nn]).result as never)).toBe("number[][]");
    const nnn = arrOf(arrOf(arrOf(numAbs)));
    expect(formatShape(call(`export function f(xs) { return xs.flat(2); }`, [nnn]).result as never)).toBe("number[]");
  });

  it("(number | string)[][] flat() → (number | string)[]", () => {
    const mixed = arrOf(abs({ k: "sum", members: [numAbs, strAbs] }, undefined, undefined, "path"));
    expect(formatShape(call(`export function f(xs) { return xs.flat(); }`, [arrOf(mixed)]).result as never)).toBe(
      "(number | string)[]",
    );
  });

  it("非数组元素原样保留（flat 不是无条件去一层）", () => {
    const mixed = arrOf(abs({ k: "sum", members: [numAbs, arrOf(strAbs)] }, undefined, undefined, "path"));
    expect(formatShape(call(`export function f(xs) { return xs.flat(); }`, [mixed]).result as never)).toBe(
      "(number | string)[]",
    );
  });

  it("guard 面只接受 number 元素（校验器不再恒真）", () => {
    const nn = arrOf(arrOf(numAbs));
    const r = call(`export function f(xs) { return xs.flat(); }`, [nn]);
    const guard = denoteGuard(r.result as never, "data");
    expect(guard).toContain('typeof item === "number"');
    expect(guard).not.toContain("(item) => true");
  });
});

describe("长度未知数组的 values/keys/entries 保留元素域", () => {
  const arrOf = (element: Abs): Abs => abs({ k: "arr", element }, undefined, undefined, "exact");
  const strArr = arrOf(str());

  it("values() 迭代元素 = string；for-of 结果 string[]", () => {
    const r = evalSrc(
      `export function f(xs) { const out = []; for (const v of xs.values()) out.push(v); return out; }`,
      [strArr],
    );
    expect(r.effects).not.toContain("TypeError");
    expect(formatShape(call(`export function f(xs) { const out = []; for (const v of xs.values()) out.push(v); return out; }`, [strArr]).result as never)).toBe("string[]");
  });

  it("keys() 迭代元素 = number（不再 number | string）", () => {
    const src = `export function f(xs) { let t = 0; for (const i of xs.keys()) t += i; return t; }`;
    const r = evalSrc(src, [strArr]);
    expect(r.effects).not.toContain("TypeError");
    expect(formatShape(call(src, [strArr]).result as never)).toBe("number");
  });

  it("entries() 解构 [i, v] 不记假 TypeError；Array.from(entries) 元素是 [number, string]", () => {
    const src = `export function f(xs) { const out = []; for (const [i, v] of xs.entries()) out.push(String(i) + v); return out; }`;
    const r = evalSrc(src, [strArr]);
    expect(r.effects).not.toContain("TypeError");
    expect(formatShape(call(src, [strArr]).result as never)).toBe("string[]");
    const fromSrc = `export function f(xs) { return Array.from(xs.entries()); }`;
    expect(formatShape(call(fromSrc, [strArr]).result as never)).toBe("[number, string][]");
  });

  it("next() 保留元素域（value = string | undefined，判空后成员读不假抛）", () => {
    const src = `export function f(xs) { const it = xs.values(); const v = it.next().value; return v === undefined ? 0 : v.length; }`;
    const r = evalSrc(src, [strArr]);
    expect(r.effects).not.toContain("TypeError");
    expect(formatShape(call(src, [strArr]).result as never)).toMatch(/^(0 \| number|number \| 0)$/);
  });
});
