/**
 * Bug 296 回归：`Array.from(items, mapFn, thisArg)` 的**第三实参**不再被丢弃。
 *
 * ES 语义（node 实测）：`Array.from(items, mapFn, thisArg)` 的 mapFn 以
 * `thisArg` 为 this 调用（GetThisBinding）；未给 thisArg ⇒ this 为
 * undefined（strict）/ globalThis（sloppy）。
 *
 * 修复前：`evalArrayFrom` 的 `mapOne` 调 `applyCallbackValue` 时**不传**
 * thisVal ⇒ 回调的 this 恒 undefined ⇒ 回调体读 `this.k` 走
 * "property 'k' on undefined" **假抛 TypeError**、把计数器永远写成 0。
 * 数组 HOF 通道（invoke-arr.ts 的 callFn）本就传 thisVal（Bug 21 已钉）——
 * `Array.from` 是唯一把 thisArg 传丢的高阶内建。
 *
 * 负控制钉住：数组 HOF 的 thisArg（不变）、无 thisArg 的回调（this 仍是
 * undefined）、无 mapper 的 Array.from（不变）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";
import { checkSource } from "../check.ts";
import { pTrue } from "../pred.ts";

/** 结果字面量值（litValue） */
function v(src: string) {
  return litValue(call(src, "f").result);
}

/** 抛错名（无抛错 → ""） */
function throwName(src: string): string {
  const t = call(src, "f").throws as { shape?: { k?: string; name?: string } } | undefined;
  if (!t?.shape || t.shape.k === "never") return "";
  return t.shape.k === "brand" ? (t.shape.name ?? "") : t.shape.k;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 296 — Array.from 的第三实参 thisArg 透传给回调", () => {
  it("回调 this 是 thisArg（原生 20，改前假抛 TypeError）", () => {
    const src = wrap(
      `let n = 0; Array.from([1,2], function(){ n += this.k; }, {k:10}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 20 });
  });

  it("回调 this 参与返回值计算（原生 \"v1|v2\"，改前假抛）", () => {
    const src = wrap(
      `const r = Array.from([1,2], function(x){ return this.p + x; }, {p:"v"}); return r;`,
    );
    expect(throwName(src)).toBe("");
    // 元素域是 this.p + x 的 join（抽象 string）——不抛且非 unknown 即可
    const r = call(src, "f").result;
    expect(r.shape.k).toBe("arr");
    expect(r.shape.k === "arr" ? r.shape.element.shape.k : "").not.toBe("unknown");
  });

  it("thisArg 为 null ⇒ 回调 this 是 null（原生 \"null\"，改前 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }, null); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "null" });
  });

  it("thisArg 为 undefined ⇒ 回调 this 是 undefined（原生 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }, undefined); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("Set 迭代物同样透传 thisArg（原生 10，改前假抛）", () => {
    const src = wrap(
      `let n = 0; Array.from(new Set([1,2]), function(){ n += this.k; }, {k:5}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 10 });
  });

  it("字符串迭代物同样透传 thisArg（原生 6）", () => {
    const src = wrap(
      `let n = 0; Array.from("ab", function(){ n += this.k; }, {k:3}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 6 });
  });

  it("array-like 迭代物同样透传 thisArg（原生 8）", () => {
    const src = wrap(
      `let n = 0; Array.from({length:2,0:1,1:2}, function(){ n += this.k; }, {k:4}); return n;`,
    );
    expect(throwName(src)).toBe("");
    expect(v(src)).toEqual({ ok: true, value: 8 });
  });
});

describe("Bug 296 负控制：无 thisArg / 其它通道不受影响", () => {
  it("数组 HOF 的 thisArg 仍正确（原生 14）", () => {
    const src = wrap(`let n = 0; [1,2].map(function(){ n += this.k; }, {k:7}); return n;`);
    expect(v(src)).toEqual({ ok: true, value: 14 });
  });

  it("未给 thisArg ⇒ 回调 this 仍是 undefined（原生 \"undefined\"）", () => {
    const src = wrap(
      `let seen = "none"; Array.from([1], function(){ seen = String(this); return 0; }); return seen;`,
    );
    expect(v(src)).toEqual({ ok: true, value: "undefined" });
  });

  it("无 mapper 的 Array.from 不受影响（原生 2,4）", () => {
    const src = wrap(`return Array.from([1,2], x => x * 2);`);
    expect(throwName(src)).toBe("");
    expect(call(src, "f").result.shape.k).toBe("arr");
  });

  it("箭头回调不受 thisArg 影响（原生 2）", () => {
    const src = wrap(`let n = 0; Array.from([1,2], () => { n += 1; }, {k:10}); return n;`);
    expect(v(src)).toEqual({ ok: true, value: 2 });
  });

  it("L2 门禁不再假红：带 thisArg 的 Array.from 不再被判 may-throw", () => {
    // 改前：回调 this 恒 undefined ⇒ "property 'k' on undefined" ⇒ 假抛
    // ⇒ L2 门禁把合法的 thisArg 用法判红（原生不抛）。
    const r = checkSource(
      "/t/bug296-thisarg.js",
      `export function arrayFromThisArg() {
  let n = 0;
  Array.from([1, 2], function () { n += this.k; }, { k: 10 });
  return n;
}
`,
      pTrue,
      {},
    );
    expect(r.issues.some((i) => i.code === "nudo:entry-may-throw")).toBe(false);
  });
});

describe("Bug 296 越界待办（TypedArray.from 同款遗漏）", () => {
  // `Uint8Array.from(items, mapFn, thisArg)` 在 builtins/error/binary.ts
  // （G 分片地盘）有同款遗漏——mapper 调用不传 thisVal。
  it.todo("原生 Uint8Array.from([1,2], fn, {k:3}) 计数器 === 6（引擎当前假抛）——需 binary.ts 的 mapper 传 thisVal");
});
