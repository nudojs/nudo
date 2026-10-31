/**
 * BUG-220 —— 无界（next() 永不报 done）用户迭代器的 for-of 代表元必须是
 * **元素域**（已采集元素 join / unknown），不得取首个具体元素去**决定**分支。
 *
 * 修前：`$forOf` 的 unbounded 单代表迭代取 `items[Math.min(i, items.length - 1)]`
 * ＝**首元素**；`for (const x of o) { if (x > 0) break }` 的首元素 `0` 把条件
 * 决定性判假 ⇒ then 臂（连同其 IteratorClose `return()`）根本没被求值 ⇒
 * 引擎印 `"NOT" #exact`，宿主是 `"CLOSED"`（引擎结论与宿主相反 + 必发副作用
 * 被吞）。
 * 修后：代表元 = 整个未知元素域（采集触顶 / 条目过多折 unknown）⇒ 条件两侧
 * 都探索 ⇒ break 臂可达，`return()` 对出口绑定的写不再丢失。
 */
import { describe, it, expect } from "vitest";
import { formatAbs } from "../../format.ts";
import { litValue } from "../../abs.ts";
import { call } from "../../__tests__/eval-helpers.ts";

const probe = (src: string) => call(src, "probe", []);

describe("BUG-220: 无界用户迭代器的代表元不得取首个具体元素", () => {
  it("a) 无界迭代器：break 臂可达 ⇒ IteratorClose 的 return() 计入出口（宿主同结论）", () => {
    // BUG-220 原始复现器（宿主 returns CLOSED；修前引擎 "NOT" #exact）
    const r = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return { value: i++, done: false }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) break;
  }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "CLOSED" });
  });

  it("b) 有界迭代器（报 done）仍逐元素精确展开：break 关闭 ⇒ CLOSED，自然耗尽 ⇒ 不关闭 ⇒ NOT", () => {
    const withBreak = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) break;
  }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(withBreak.result)).toEqual({ ok: true, value: "CLOSED" });

    const exhausted = probe(`export function probe() {
  let closed = false;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
        return() { closed = true; return {}; },
      };
    },
  };
  for (const x of o) { }
  return closed ? "CLOSED" : "NOT";
}`);
    expect(litValue(exhausted.result)).toEqual({ ok: true, value: "NOT" });
  });

  it("b2) 有界迭代仍精确：0+1+2 折 3 #exact（不得因代表元抽象而宽化）", () => {
    const r = probe(`export function probe() {
  let acc = 0;
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return i < 3 ? { value: i++, done: false } : { value: undefined, done: true }; },
      };
    },
  };
  for (const x of o) { acc += x; }
  return acc;
}`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 3 });
    expect(formatAbs(r.result)).toContain("#exact");
  });

  it("c) 循环变量 = 元素域抽象（不折首元素 0）——修前 `return x` 折 0 #exact", () => {
    const r = probe(`export function probe() {
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return { next() { return { value: i++, done: false }; } };
    },
  };
  for (const x of o) { return x; }
  return -1;
}`);
    expect(r.result.shape.k).toBe("unknown");
    expect(litValue(r.result)).not.toEqual({ ok: true, value: 0 });
  });

  it("c2) 代表元抽象后分支两侧都探索——修前 out 折 \"miss\" #exact", () => {
    const r = probe(`export function probe() {
  let out = "miss";
  const o = {
    [Symbol.iterator]() {
      let i = 0;
      return {
        next() { return { value: i++, done: false }; },
        return() { return {}; },
      };
    },
  };
  for (const x of o) {
    if (x > 0) { out = "hit"; break; }
  }
  return out;
}`);
    // 修前：首元素 0 ⇒ 条件判假 ⇒ then 臂（out = "hit"）根本不进 ⇒ "miss" #exact
    expect(litValue(r.result)).not.toEqual({ ok: true, value: "miss" });
  });
});
