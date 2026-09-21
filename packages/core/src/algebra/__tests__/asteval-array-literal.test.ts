/**
 * ast-eval 数组字面量建模回归：
 * ① hole 压缩——[7,,9] 折 tuple [7,9]，下标整体左移（[1] 折 9、length 折 2、
 *    Object.keys 折 ["0","1"]），下游索引/迭代/键投影全假精确；
 * ② spread 丢弃——[...[1,2],3] 折 [3]，spread 元素被整体 filter 掉。
 * 原生：hole 是「下标保留、Get 返回 undefined」的缺席槽；spread 按迭代器
 * 就地展开（字符串按码点、源 hole 位产出 undefined 实槽而非 hole）。
 * 修复：ArrayExpression 逐位建模——hole → undefined 槽 + holes 记录；
 * spread 逐源展开（tuple/字符串字面量折叠，未知长度整体降 arr partial）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFn, litValue, formatAbs } from "../index.ts";

describe("ast-eval array literal holes", () => {
  it("length counts holes", () => {
    expect(litValue(analyzeFn(`function f() { return [7,,9].length; }`, "f", []))).toBe(3);
  });

  it("hole index reads undefined (indices not compressed)", () => {
    expect(litValue(analyzeFn(`function f() { return [7,,9][1] === undefined; }`, "f", []))).toBe(true);
    expect(litValue(analyzeFn(`function f() { return [7,,9][2]; }`, "f", []))).toBe(9);
  });

  it("Object.keys/values/entries keep true indices (skip holes)", () => {
    expect(litValue(analyzeFn(`function f() { return Object.keys([7,,9]).length; }`, "f", []))).toBe(2);
    expect(litValue(analyzeFn(`function f() { return Object.keys([7,,9])[1]; }`, "f", []))).toBe("2");
    expect(litValue(analyzeFn(`function f() { return Object.values([7,,9]).length; }`, "f", []))).toBe(2);
    expect(litValue(analyzeFn(`function f() { return Object.entries([7,,9])[1][0]; }`, "f", []))).toBe("2");
  });

  it("for-of yields undefined at holes", () => {
    expect(
      litValue(analyzeFn(`function f() { let c = 0; for (const v of [7,,9]) { c++; } return c; }`, "f", [])),
    ).toBe(3);
    expect(
      litValue(analyzeFn(`function f() { let u = 0; for (const v of [7,,9]) { if (v === undefined) u++; } return u; }`, "f", [])),
    ).toBe(1);
  });

  it("find/findIndex do not skip holes (Get semantics)", () => {
    expect(litValue(analyzeFn(`function f() { return [7,,9].findIndex(x => x === undefined); }`, "f", []))).toBe(1);
    expect(litValue(analyzeFn(`function f() { return [7,,9].find(x => x === undefined) === undefined; }`, "f", []))).toBe(true);
  });

  it("some/every skip holes (HasProperty) with true indices", () => {
    expect(litValue(analyzeFn(`function f() { return [7,,9].some(x => x === undefined); }`, "f", []))).toBe(false);
    expect(litValue(analyzeFn(`function f() { return [7,,9].some((x, i) => i === 1); }`, "f", []))).toBe(false);
    expect(litValue(analyzeFn(`function f() { return [7,,9].every((x, i) => i < 3); }`, "f", []))).toBe(true);
  });

  it("map skips holes with true indices", () => {
    const r = analyzeFn(`function f() { return [7,,9].map((x, i) => i); }`, "f", []);
    expect(litValue(r)).toBeUndefined(); // 元素并集（0|2）非字面量
    const s = formatAbs(r);
    expect(s).toContain("0");
    expect(s).toContain("2");
    expect(s).not.toContain("1");
  });

  it("Object.assign source skips holes (true keys)", () => {
    expect(litValue(analyzeFn(`function f() { return Object.assign({}, [7,,9])['2']; }`, "f", []))).toBe(9);
    expect(
      litValue(analyzeFn(`function f() { return Object.hasOwn(Object.assign({}, [7,,9]), '1'); }`, "f", [])),
    ).toBe(false);
    expect(
      litValue(analyzeFn(`function f() { return Object.keys(Object.assign({}, [7,,9])).length; }`, "f", [])),
    ).toBe(2);
  });
});

describe("ast-eval array literal spread", () => {
  it("spread elements are projected (not dropped)", () => {
    expect(litValue(analyzeFn(`function f() { return [...[1,2],3].length; }`, "f", []))).toBe(3);
    expect(litValue(analyzeFn(`function f() { return [...[1,2],3][2]; }`, "f", []))).toBe(3);
    expect(litValue(analyzeFn(`function f() { return [1,2,...[3]][2]; }`, "f", []))).toBe(3);
    expect(litValue(analyzeFn(`function f() { return [...[1],...[2,3]].length; }`, "f", []))).toBe(3);
  });

  it("string spread yields code points", () => {
    expect(litValue(analyzeFn(`function f() { return [...'ab'][1]; }`, "f", []))).toBe("b");
    expect(litValue(analyzeFn(`function f() { return [...'\uD83D\uDE00'].length; }`, "f", []))).toBe(1);
  });

  it("holey source spread yields undefined slots, not holes", () => {
    expect(litValue(analyzeFn(`function f() { return [...[1,,3]].length; }`, "f", []))).toBe(3);
    expect(litValue(analyzeFn(`function f() { return [...[1,,3]][1] === undefined; }`, "f", []))).toBe(true);
    // 结果无 hole：自有键覆盖全下标
    expect(litValue(analyzeFn(`function f() { return Object.keys([...[1,,3]]).length; }`, "f", []))).toBe(3);
  });

  it("unknown-length spread stays conservative", () => {
    const r = analyzeFn(`function f(a) { return [...a]; }`, "f", []);
    expect(litValue(r)).toBeUndefined();
    const r2 = analyzeFn(`function f(a) { return [...[1,2],...a].length; }`, "f", []);
    expect(litValue(r2)).toBeUndefined();
  });
});
