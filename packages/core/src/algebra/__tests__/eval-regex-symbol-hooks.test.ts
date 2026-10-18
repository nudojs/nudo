/**
 * Bug 81 回归（class-regex 半边）：`String.prototype.match/search/matchAll`
 * 识别 RegExp 品牌后直接重建宿主 RegExp 调用，从不读模式的 @@match/
 * @@search/@@matchAll 槽（`re[Symbol.match] = fn` 形——symbolKey 槽投影
 * "@@match"）。修复：分派前查槽——可调用 → 以模式为 this、字符串为唯一
 * 实参调用（GetMethod 语义：不可调用 → TypeError；nullish 字面 → 视为
 * 缺省，此后原生走 RegExpCreate(ToString(pattern))，模式变为
 * "/source/flags" 文本、起点 lastIndex=0）；matchAll 的 g 检查仍先行
 * （原生顺序，node 实测）。replace/replaceAll 臂（methods.ts）另测。
 */
import { describe, it, expect } from "vitest";
import { call } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

function expectVal(body: string, expected: unknown) {
  const rec = call(`export function f() {\n${body}\n}`);
  expect(rec.throws?.shape?.k ?? "never", `throws face for: ${body}`).toBe("never");
  expect(litValue(rec.result), `value for: ${body}`).toEqual({ ok: true, value: expected });
}

describe("pattern @@match/@@search/@@matchAll slots dispatch (Bug 81, class-regex half)", () => {
  it("@@match 槽可调用 → 钩子返回值取代匹配结果", () => {
    // node: r[Symbol.match] = () => "Q"; "aa".match(r) → "Q"
    expectVal(`const r = /a/; r[Symbol.match] = () => "Q"; return "aa".match(r);`, "Q");
  });

  it("@@search 槽可调用 → 钩子返回值", () => {
    // node: 42
    expectVal(`const r = /a/; r[Symbol.search] = () => 42; return "aa".search(r);`, 42);
  });

  it("钩子以模式为 this、字符串为唯一实参", () => {
    // node: "aa:a"（this.source = "a"）
    expectVal(`const r = /a/; r[Symbol.match] = function (s) { return s + ":" + this.source; }; return "aa".match(r);`, "aa:a");
  });

  it("@@matchAll 槽可调用 → 钩子返回值（可迭代即可展开）", () => {
    // node: 2
    expectVal(`const r = /a/g; r[Symbol.matchAll] = function (s) { return [s, s]; }; return [..."aa".matchAll(r)].length;`, 2);
  });

  it("matchAll 的 g 检查先于 @@matchAll 槽查找", () => {
    // node: 非全局 brand 带钩子仍抛 TypeError（flags 检查先行）
    expectVal(`const r = /a/; r[Symbol.matchAll] = () => 1; try { "aa".matchAll(r); return "ok"; } catch (e) { return e.name; }`, "TypeError");
  });

  it("槽为不可调用值 → TypeError（GetMethod）", () => {
    // node: r[Symbol.match] = 5 → TypeError
    expectVal(`const r = /a/; r[Symbol.match] = 5; try { "aa".match(r); return "ok"; } catch (e) { return e.name; }`, "TypeError");
  });

  it("nullish 槽 → RegExpCreate(ToString(pattern)) 覆盖形（match）", () => {
    // node: r[Symbol.match] = undefined 后模式为 "/a/g" 文本——"/a/g".match(r) → ["/a/g"]
    expectVal(`const r = /a/g; r[Symbol.match] = undefined; return JSON.stringify("/a/g".match(r));`, `["/a/g"]`);
  });

  it("nullish 槽 → ToString 模式（search 未中 → -1）", () => {
    // node: "/a/g" 不在 "aa" → -1
    expectVal(`const r = /a/g; r[Symbol.search] = null; return "aa".search(r);`, -1);
  });

  it("nullish 槽 → ToString 模式 + 强制 g（matchAll）", () => {
    // node: "aa" 无 "/a/g" 子串 → 0；"/a/gxx" → 1
    expectVal(`const r = /a/g; r[Symbol.matchAll] = undefined; return [..."aa".matchAll(r)].length;`, 0);
    expectVal(`const r = /a/g; r[Symbol.matchAll] = undefined; return [..."/a/gxx".matchAll(r)].length;`, 1);
  });

  // controls：无钩子槽 → 默认宿主 regex 重建路径不变
  it("control：无钩子 match 走宿主重建", () => {
    expectVal(`return "aa".match(/a/)[0];`, "a");
  });

  it("control：无钩子 search 走宿主重建", () => {
    expectVal(`return "aa".search(/a/);`, 0);
  });
});
