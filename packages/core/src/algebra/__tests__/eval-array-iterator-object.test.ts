/**
 * Array.prototype.entries/keys/values 返回元素序列（tuple），
 * 而非迭代器对象。Array.isArray 折 true、Object.keys 折 ["0","1","2"]、
 * typeof .next 折 "undefined"——三面全 wrong-exact。
 * 修复：tuple 接收者走 Map/Set 的 collectionIteratorAbs 协议面（next/
 * @@iterator 槽 + 元素侧表——均不可枚举：原生 next 在 %ArrayIteratorPrototype%
 * 上）；长度未知（arr 接收者）走 abstractSeqIteratorAbs 保守面（不挂侧表，
 * spread/for-of 不折精确长度）。
 */
import { describe, it, expect } from "vitest";
import { litValue, abs } from "@nudojs/core";
// 域渲染取 src 单源（@nudojs/core 别名可能落到 dist 旧产物）
import { formatAbs } from "../format/format.ts";
import { call, effects } from "./eval-helpers.ts";

function v(src: string): unknown {
  const r = litValue(call(src, "f").result);
  return r.ok ? r.value : undefined;
}

/** arr 形态（长度未知）实参：invokeArrMethod 非 tuple 臂的接收者 */
const abstractArr = abs(
  { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "path") },
  undefined,
  undefined,
  "partial",
);

/** 抽象 number 形参（谓词 / limit 真值不可判） */
const abstractNum = abs({ k: "prim", type: "number" }, undefined, undefined, "path");

/** throws 面的 Error brand 名（非 brand 面返回 shape.k） */
function throwsName(r: { throws: unknown }): string | undefined {
  const t = r.throws as { shape?: { k?: string; name?: string } } | undefined;
  return t?.shape?.k === "brand" ? t.shape.name : t?.shape?.k;
}

describe("entries/keys/values return iterator objects", () => {
  it("Array.isArray → false（迭代器对象非数组）", () => {
    expect(v(`export function f() { return Array.isArray([1,2,3].entries()); }`)).toBe(false);
    expect(v(`export function f() { return Array.isArray([1,2,3].keys()); }`)).toBe(false);
    expect(v(`export function f() { return Array.isArray([1,2,3].values()); }`)).toBe(false);
  });

  it("Object.keys → []（next 在原型上，非自有可枚举）", () => {
    expect(v(`export function f() { return Object.keys([1,2,3].entries()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys([1,2,3].keys()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys([1,2,3].values()).length; }`)).toBe(0);
  });

  it("typeof .next → \"function\"", () => {
    expect(v(`export function f() { return typeof [1,2,3].entries().next; }`)).toBe("function");
    expect(v(`export function f() { return typeof [1,2,3].keys().next; }`)).toBe("function");
    expect(v(`export function f() { return typeof [1,2,3].values().next; }`)).toBe("function");
  });

  it("next() 协议：按调用序折 {value, done}", () => {
    expect(v(`export function f() { return [1,2,3].entries().next().value[1]; }`)).toBe(1);
    expect(v(`export function f() { return [1,2,3].keys().next().value; }`)).toBe(0);
    expect(v(`export function f() { return [1,2,3].values().next().value; }`)).toBe(1);
    expect(v(`export function f() { return [1,2,3].values().next().done; }`)).toBe(false);
    expect(v(`export function f() { const it = [1].values(); it.next(); return it.next().done; }`)).toBe(true);
    expect(v(`export function f() { const it = [1].values(); it.next(); return it.next().value === undefined; }`)).toBe(true);
  });

  it("spread 精确展开（含 hole / entries 条目元组）", () => {
    expect(v(`export function f() { return [...[1,2,3].entries()].length; }`)).toBe(3);
    expect(v(`export function f() { const e = [...[1,2,3].entries()]; return e[0][0] + "," + e[0][1] + "," + e[2][1]; }`)).toBe("0,1,3");
    expect(v(`export function f() { return [...[1,2,3].keys()].join(","); }`)).toBe("0,1,2");
    expect(v(`export function f() { const vs = [...[1,2,3].values()]; return vs[0] + vs[1] + vs[2]; }`)).toBe(6);
    // hole：keys 覆盖全下标；values/entries 按 Get 语义产出 undefined
    expect(v(`export function f() { return [...[1,,3].keys()].join(","); }`)).toBe("0,1,2");
    expect(v(`export function f() { return [...[1,,3].values()].length; }`)).toBe(3);
    expect(v(`export function f() { return [...[1,,3].values()][1] === undefined; }`)).toBe(true);
    expect(v(`export function f() { return [...[1,,3].entries()][1][1] === undefined; }`)).toBe(true);
  });

  it("for-of / 解构 消费链路（Array.from 同引擎既有精度：元素域数组）", () => {
    expect(v(`export function f() { let s = 0; for (const k of [10,20].keys()) s += k; return s; }`)).toBe(1);
    expect(v(`export function f() { let out = []; for (const [i, x] of [1,2,3].entries()) out.push(i * x); return out.join(","); }`)).toBe("0,2,6");
    expect(v(`export function f() { const [[i, x]] = [7,8].entries(); return i + x; }`)).toBe(7);
    const af = call(`export function f() { return Array.from([5,6].values()).join("+"); }`);
    expect(litValue(af.result).ok).toBe(false); // 引擎 Array.from 面恒元素域（同 Array.from([5,6])）
  });

  it("消费位同步（Bug 54 同款）：next 后 spread 取剩余并排空", () => {
    expect(v(`export function f() { const it = [1,2,3].values(); it.next(); return [...it].join(""); }`)).toBe("23");
    expect(v(`export function f() { const it = [1,2,3].values(); it.next(); let s = 0; for (const v of it) s += v; return s; }`)).toBe(5);
    expect(v(`export function f() { const it = [1,2,3].values(); const a = [...it]; const b = [...it]; return a.length + b.length; }`)).toBe(3);
  });

  it("回调三参 a.entries() 是迭代器对象（非条目数组）", () => {
    expect(v(`export function f() { return [1,2].map((x, i, a) => Array.isArray(a.entries())).join(","); }`)).toBe("false,false");
    expect(v(`export function f() { return [1,2].map((x, i, a) => typeof a.entries().next).join(","); }`)).toBe("function,function");
  });

  it("抽象数组（arr 形态，长度未知）：迭代器对象保守面，不折精确长度", () => {
    const r = call(`export function f(a) { let out = []; for (const k of a.keys()) { out.push(k); } return out; }`, "f", [abstractArr]);
    expect(litValue(r.result).ok).toBe(false); // 出口 join 非具体（0..maxIters）
    const isArr = call(`export function f(a) { return Array.isArray(a.entries()); }`, "f", [abstractArr]);
    expect(litValue(isArr.result)).toEqual({ ok: true, value: false });
    const nextFn = call(`export function f(a) { return typeof a.values().next; }`, "f", [abstractArr]);
    expect(litValue(nextFn.result)).toEqual({ ok: true, value: "function" });
    const keysLen = call(`export function f(a) { return Object.keys(a.keys()).length; }`, "f", [abstractArr]);
    expect(litValue(keysLen.result)).toEqual({ ok: true, value: 0 });
    // spread 不折精确长度（无元素侧表 → arr/unknown 面）
    const spread = call(`export function f(a) { return [...a.values()].length; }`, "f", [abstractArr]);
    expect(litValue(spread.result).ok).toBe(false);
  });

  it("Map/Set 迭代器 Object.keys → []（共享 collectionIteratorAbs 修复）", () => {
    expect(v(`export function f() { return Object.keys(new Map().keys()).length; }`)).toBe(0);
    expect(v(`export function f() { return Object.keys(new Set().values()).length; }`)).toBe(0);
  });
});

/**
 * ES2025 `%IteratorPrototype%` 助手方法（toArray / map / filter / take /
 * drop / flatMap / reduce / forEach / some / every / find）（BUG-114）。
 *
 * 根因：collectionIteratorAbs 的协议对象只有 next / @@iterator 两个槽 ⇒
 * Array/Map/Set 迭代器的第一次助手方法读落 miss，调用未知被记 TypeError
 * （L2 假红，与 env 的 Iterator brand 声明自相矛盾）。修复：同一工厂挂上
 * 助手方法（非枚举，共享 next 游标 / live 视图）；wrapper 为**惰性**：
 * 创建期只做原生同步校验（回调可调用 / ToNumber），首次 next() 才拉源。
 */
describe("ES2025 iterator helpers on Array/Map/Set iterators（BUG-114）", () => {
  it("toArray / keys / entries", () => {
    expect(v(`export function f() { return [1,2].values().toArray().join(","); }`)).toBe("1,2");
    expect(v(`export function f() { return [1,2].keys().toArray().join(","); }`)).toBe("0,1");
    expect(v(`export function f() { return [1,2].entries().toArray().length; }`)).toBe(2);
    expect(v(`export function f() { return new Map([["a",1]]).values().toArray().join(","); }`)).toBe("1");
    expect(v(`export function f() { return new Set([1]).values().toArray().join(","); }`)).toBe("1");
  });

  it("map / filter / take / drop 链", () => {
    expect(v(`export function f() { return [1,2].values().map(x => x * 2).toArray().join(","); }`)).toBe("2,4");
    expect(v(`export function f() { return [1,2,3].values().filter(x => x > 1).toArray().join(","); }`)).toBe("2,3");
    expect(v(`export function f() { return [1,2,3].values().take(2).toArray().join(","); }`)).toBe("1,2");
    expect(v(`export function f() { return [1,2,3].values().drop(1).toArray().join(","); }`)).toBe("2,3");
    expect(v(`export function f() { return [1,2].values().flatMap(x => [x, x]).toArray().length; }`)).toBe(4);
  });

  it("reduce / forEach / some / every / find", () => {
    expect(v(`export function f() { return [1,2,3].values().reduce((a,b) => a + b, 0); }`)).toBe(6);
    expect(v(`export function f() { return [1,2,3].values().reduce((a,b) => a + b); }`)).toBe(6);
    expect(v(`export function f() { let n = 0; [1,2].values().forEach(x => { n += x; }); return n; }`)).toBe(3);
    expect(v(`export function f() { return [1,2].values().some(x => x === 2); }`)).toBe(true);
    expect(v(`export function f() { return [1,2].values().every(x => x > 0); }`)).toBe(true);
    expect(v(`export function f() { return [1,2,3].values().find(x => x > 1); }`)).toBe(2);
  });

  it("take/drop 的 ToNumber + ToIntegerOrInfinity（NaN ⇒ 定抛 RangeError、null/false/\"\" ⇒ 0）", () => {
    const rangeError = (src: string) => {
      const r = call(src);
      expect(throwsName(r), src).toBe("RangeError");
    };
    // ToNumber(undefined) = NaN ⇒ 定抛（原生 take()/take(undefined) 均同）
    rangeError(`export function f() { return [1,2].values().take(undefined).toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().take().toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().drop(undefined).toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().take(NaN).toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().take("abc").toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().take(-1).toArray().length; }`);
    rangeError(`export function f() { return [1,2].values().drop(-1).toArray().length; }`);
    // 合法字面量面：null / false / "" → 0；true / "1" → 1
    expect(v(`export function f() { return [1,2].values().take(null).toArray().length; }`)).toBe(0);
    expect(v(`export function f() { return [1,2].values().take(false).toArray().length; }`)).toBe(0);
    expect(v(`export function f() { return [1,2].values().take("").toArray().length; }`)).toBe(0);
    expect(v(`export function f() { return [1,2].values().take("1").toArray().join(","); }`)).toBe("1");
    expect(v(`export function f() { return [1,2].values().take(true).toArray().join(","); }`)).toBe("1");
  });

  it("抽象 limit：结果长度不可知 + 记 may RangeError", () => {
    const src = `export function f(n) { return [1,2].values().take(n).toArray().length; }`;
    const r = call(src, "f", [abstractNum]);
    expect(litValue(r.result).ok).toBe(false); // 长度域（可能 0..2）
    expect(effects(src)).toContain("RangeError");
    const dropSrc = `export function f(n) { return [1,2].values().drop(n).toArray().length; }`;
    expect(litValue(call(dropSrc, "f", [abstractNum]).result).ok).toBe(false);
    expect(effects(dropSrc)).toContain("RangeError");
  });

  it("助手方法非自有可枚举键（Object.keys(iter) 仍为 []）", () => {
    expect(v(`export function f() { return Object.keys([1,2].values()).length; }`)).toBe(0);
    expect(v(`export function f() { return typeof [1,2].values().toArray; }`)).toBe("function");
  });

  it("wrapper 创建期不触碰源（惰性；源不折已耗尽）", () => {
    // 创建 wrapper 后源仍在原游标：next().done 原生 false、spread 长度原生 2
    expect(v(`export function f() { const it = [1,2].values(); it.map(x => x); return it.next().done; }`)).toBe(false);
    expect(v(`export function f() { const it = [1,2].values(); it.map(x => x); return [...it].length; }`)).toBe(2);
    expect(v(`export function f() { const it = [1,2].values(); it.take(1); return [...it].length; }`)).toBe(2);
    expect(v(`export function f() { const it = [1,2].values(); it.filter(x => true); return [...it].length; }`)).toBe(2);
    expect(v(`export function f() { const it = [1,2].values(); it.drop(1); return [...it].length; }`)).toBe(2);
    expect(v(`export function f() { const it = [1,2].values(); it.flatMap(x => [x]); return [...it].length; }`)).toBe(2);
    // 首次 next() 才拉源（map 的首个产出 = 源的第一个元素经回调）
    expect(v(`export function f() { return [1,2].values().map(x => x * 2).next().value; }`)).toBe(2);
    // 消费 take(1) 只推进源 1 个 ⇒ 源剩余 2（原生同）
    expect(v(`export function f() { const it = [1,2,3].values(); it.take(1).toArray(); return [...it].length; }`)).toBe(2);
    // 解构 peek 只拉到所需下标（不预取全部）：a=2、源剩余 2（原生同）
    expect(
      v(`export function f() { const it = [1,2,3].values(); const m = it.map(x => x * 2); const [a] = m; return a + "," + [...it].length; }`),
    ).toBe("2,2");
    // map wrapper 的 spread 精确展开（长度确切时挂消费视图）
    expect(v(`export function f() { return [...[1,2].values().map(x => x * 2)].join(","); }`)).toBe("2,4");
    expect(v(`export function f() { let s = 0; for (const x of [1,2].values().map(x => x * 2)) s += x; return s; }`)).toBe(6);
  });

  it("filter 抽象谓词：保留元素/长度是数据依赖（不折精确元数）", () => {
    const lenSrc = `export function f(n) { return [1,2].values().filter(x => x > n).toArray().length; }`;
    const lenR = call(lenSrc, "f", [abstractNum]);
    expect(litValue(lenR.result).ok).toBe(false); // 可能 0/1/2 个
    const arrR = call(
      `export function f(n) { return [1,2].values().filter(x => x > n).toArray(); }`,
      "f",
      [abstractNum],
    );
    const rendered = formatAbs(arrR.result);
    expect(rendered).not.toContain("#exact");
    expect(rendered).toContain("1");
    expect(rendered).toContain("2");
    // 对照：确定谓词仍可精确（长度 2 / 元素 2,3）
    expect(v(`export function f() { return [1,2,3].values().filter(x => x > 1).toArray().join(","); }`)).toBe("2,3");
  });

  it("find 抽象谓词：前序可能匹配不得被后到确定匹配覆盖", () => {
    // x=1 时谓词不可判（可能是首个匹配），x=2 定 true —— 结果域须含 1|2
    const r = call(
      `export function f(n) { return [1,2].values().find(x => x > 1 || n > 0); }`,
      "f",
      [abstractNum],
    );
    expect(litValue(r.result).ok).toBe(false);
    const rendered = formatAbs(r.result);
    expect(rendered).toContain("1");
    expect(rendered).toContain("2");
    // 全不可判 ⇒ 可能无匹配 ⇒ 并入 undefined
    const allUnknown = call(`export function f(n) { return [1,2].values().find(x => x > n); }`, "f", [abstractNum]);
    expect(formatAbs(allUnknown.result)).toContain("undefined");
    // 对照：确定谓词的首个匹配仍精确
    expect(v(`export function f() { return [1,2,3].values().find(x => x > 1); }`)).toBe(2);
  });

  it("flatMap 映射值 prim ⇒ 定抛 TypeError（字符串不按字符展开）", () => {
    for (const ret of [`"ab"`, "1", "true", "undefined", "null"]) {
      const r = call(`export function f() { return [1].values().flatMap(() => ${ret}).toArray(); }`);
      expect(throwsName(r), ret).toBe("TypeError");
    }
    // 对照：数组 / 内建迭代器展开、空数组不产出元素
    expect(v(`export function f() { return [1,2].values().flatMap(x => [x, x]).toArray().length; }`)).toBe(4);
    expect(v(`export function f() { return [1].values().flatMap(() => []).toArray().length; }`)).toBe(0);
    expect(
      v(`export function f() { const p = new URLSearchParams("a=1&b=2"); return [1].values().flatMap(() => p).toArray().length; }`),
    ).toBe(2);
  });

  it("flatMap 抽象数组映射值：结果长度不可知（不伪造基数）", () => {
    const src = `export function f(a) { return [1].values().flatMap(() => a).toArray().length; }`;
    expect(litValue(call(src, "f", [abstractArr]).result).ok).toBe(false);
  });
});
