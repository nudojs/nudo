/**
 * Bug 290 回归：RegExp `exec` / 非全局 `match` 的结果对象是**数组 exotic**
 * （原生 IsArray = true，继承 Array.prototype）⇒ 既有**数组方法面**
 * （join / slice / map…，族 01 的 Bug 195 已修），也有**可迭代面**
 * （spread / for-of / 数组解构）。
 *
 * 修前：结果只是「带下标槽的 obj」⇒ 迭代面按 obj 臂判 **definite 不可
 * 迭代** ⇒ `[...m]` / `for (const x of m)` / `const [a, b] = m` **定抛
 * TypeError**（原生全部正常返回 ⇒ 假抛 + L1/L2 假红）。
 *
 * 修法（regexp.ts）：匹配结果补「@@iterator 槽（非枚举）+ 下标元素侧表」
 * ——同 Bug 195 的标签模板对象口径（iterabilityKind 判 total、elemsOf 取
 * 到精确下标序列）；形状仍是 obj（#136 的槽读面依赖它）。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 290: match/exec 结果的可迭代面（原生数组 exotic）", () => {
  it("spread 展开下标序列（node: \"abc,b\"）", () => {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return [...m].join(","); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
  });

  it("for-of 逐元素累加（node: \"abcb\"）", () => {
    expect(
      v(`export function f() { const m = /a(b)c/.exec("abc"); let s = ""; for (const x of m) s += x; return s; }`),
    ).toEqual({ ok: true, value: "abcb" });
  });

  it("数组解构取捕获组（node: \"123123\"）", () => {
    expect(
      v(
        `export function f() { const m = /(\\d+)/.exec("abc123"); if (!m) return "no"; const [whole, g1] = m; return whole + g1; }`,
      ),
    ).toEqual({ ok: true, value: "123123" });
  });

  it("spread 保持未参与捕获组的 undefined 槽（node: [\"az\",null] 的展开面）", () => {
    expect(
      v(`export function f() { const m = /a(x)?z/.exec("az"); return [...m].length; }`),
    ).toEqual({ ok: true, value: 2 });
  });

  it("非全局 match 的结果同样可迭代（node: \"a\"）", () => {
    expect(v(`export function f() { return [...("a b".match(/\\w+/))].join(","); }`)).toEqual({
      ok: true,
      value: "a",
    });
  });

  it("matchAll 的每个匹配项可迭代（node: \"ab\"）", () => {
    expect(
      v(
        `export function f() { const it = "a b".matchAll(/\\w+/g); let s = ""; for (const m of it) s += [...m][0]; return s; }`,
      ),
    ).toEqual({ ok: true, value: "ab" });
  });

  it("indices 镜像（/d 标志）原生同为 Array ⇒ 同样可迭代（node: 2）", () => {
    expect(
      v(`export function f() { const m = /(?<y>\\d{4})/d.exec("2024"); return [...m.indices].length; }`),
    ).toEqual({ ok: true, value: 2 });
    expect(
      v(`export function f() { const m = /(?<y>\\d{4})/d.exec("2024"); return JSON.stringify(m.indices); }`),
    ).toEqual({ ok: true, value: "[[0,4],[0,4]]" });
  });

  it("原生不可迭代对象仍定抛 TypeError（负控制：普通 obj 不是数组）", () => {
    const r = call(`export function f() { const o = { a: 1 }; return [...o]; }`, "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("槽读面不回归：m[0] / m.length / m.index / m.input", () => {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m[0]; }`)).toEqual({
      ok: true,
      value: "abc",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.length; }`)).toEqual({
      ok: true,
      value: 2,
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.index; }`)).toEqual({
      ok: true,
      value: 0,
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.input; }`)).toEqual({
      ok: true,
      value: "abc",
    });
  });

  it("JSON 视图不回归：JSON.stringify(m) → '[\"abc\",\"b\"]'", () => {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return JSON.stringify(m); }`)).toEqual({
      ok: true,
      value: '["abc","b"]',
    });
  });

  it("枚举面不回归：Object.keys(m) 只有原生 5 个自有可枚举键（@@iterator 不可见）", () => {
    const r = call(
      `export function f() { const m = /a(b)c/.exec("abc"); return Object.keys(m).join(","); }`,
      "f",
    );
    const lv = litValue(r.result);
    expect(lv.ok).toBe(true);
    expect(String(lv.ok ? lv.value : undefined)).toBe("0,1,index,input,groups");
  });

  it("负控制：全局 match（纯串数组）与无匹配（null）行为不变", () => {
    expect(v(`export function f() { return "a b".match(/\\w+/g).join("-"); }`)).toEqual({
      ok: true,
      value: "a-b",
    });
    expect(v(`export function f() { const m = /zzz/.exec("abc"); return m === null; }`)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("负控制：数组方法面不回归（join / slice / map / toString / isArray）", () => {
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.join(","); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.slice(1).join(""); }`)).toEqual({
      ok: true,
      value: "b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return m.toString(); }`)).toEqual({
      ok: true,
      value: "abc,b",
    });
    expect(v(`export function f() { const m = /a(b)c/.exec("abc"); return Array.isArray(m); }`)).toEqual({
      ok: true,
      value: true,
    });
  });
});
