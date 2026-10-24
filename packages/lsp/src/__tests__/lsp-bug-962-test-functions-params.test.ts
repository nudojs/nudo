/**
 * Bug 962 — LSP agent 工具 `nudo.test` 的 **`functions` 入参零校验**。
 *
 * 改前两种畸形形态：
 * 1. 传**字符串** ⇒ 按**字符**建集合 ⇒ 函数全被过滤掉 ⇒ 返回一份**完全
 *    合法但全空**的报告（`0 fn · 0 case`）⇒ agent 得出「这个文件没有
 *    函数」的**假空**结论（无错误、无警告、零信号）；
 * 2. 传**数字 / 对象** ⇒ `params.functions.length` 为 undefined ⇒ 过滤被
 *    **整体跳过** ⇒ 请求**静默失效**（拿到的是未过滤的全量报告）。
 *
 * 修法：入口做形态校验 ⇒ 畸形入参一律**工具错误**（`isError: true`）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const SRC = `function a(x) { return x; }
function b(x) { return x + 1; }
`;

describe("Bug 962 — agent nudo/test 的 functions 入参形态校验", () => {
  it("functions 传字符串 ⇒ 工具错误（不是全空报告）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: "b",
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("functions must be an array of function names");
    });
  });

  it("functions 传数字 ⇒ 工具错误（不再静默跳过过滤）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: 42,
      });
      expect(r.isError).toBe(true);
      expect(r.content[0].text).toContain("functions must be an array of function names");
    });
  });

  it("functions 传对象 ⇒ 工具错误", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: { name: "b" },
      });
      expect(r.isError).toBe(true);
    });
  });

  it("functions 传非字符串元素的数组 ⇒ 工具错误", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: ["b", 7],
      });
      expect(r.isError).toBe(true);
    });
  });

  it("合法数组仍然过滤（回归护栏）", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({
        file: `${dir}/m.js`,
        format: "json",
        functions: ["b"],
      });
      expect(r.isError).toBeUndefined();
      const json = JSON.parse(r.content[0].text);
      expect(json.functions.map((f: { name: string }) => f.name)).toEqual(["b"]);
    });
  });

  it("缺省（不传 functions）仍然返回全量报告", async () => {
    await withLspServer({ "m.js": SRC }, async ({ req, dir }) => {
      const r = await req("nudo/test")({ file: `${dir}/m.js`, format: "json" });
      expect(r.isError).toBeUndefined();
      const json = JSON.parse(r.content[0].text);
      expect(json.functions.length).toBe(2);
    });
  });
});
