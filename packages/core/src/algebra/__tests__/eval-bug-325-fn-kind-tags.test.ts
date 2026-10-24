/**
 * Bug 325 回归：Object.prototype.toString 的**函数种类标签**。
 *
 * 原生（node v26 实测）：
 * - 普通函数 / 箭头 ⇒ "[object Function]"；
 * - async 函数 ⇒ "[object AsyncFunction]"；
 * - generator ⇒ "[object GeneratorFunction]"；
 * - async generator ⇒ "[object AsyncGeneratorFunction]"；
 * 判别式：`Object.prototype.toString.call(x).slice(8, -1) === "AsyncFunction"`。
 *
 * 修复前：整族折 "[object Function]"（wrong-exact——上述判别式恒假）。
 * 种类戳由 transpile 侧 $fnVal opts.kind 打（async × generator 四象限），
 * 读取面在 builtins/object-proto.ts 的 typeTagOf。
 *
 * 已知边界（**不是**本条的缺口）：**方法简写**（`{ async m(){} }.m`）与
 * **函数声明**（`async function f(){}`）走另外两条产生路径（transpile/
 * expr/object.ts、transpile/stmt/statement.ts——不在本分片文件清单内），
 * 尚未打戳 ⇒ 仍折 "[object Function]"（越界诉求见分片报告）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 325 — 函数种类标签（AsyncFunction / GeneratorFunction / …）", () => {
  it("async 函数 ⇒ [object AsyncFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(async () => 1);`))).toEqual({
      ok: true,
      value: "[object AsyncFunction]",
    });
  });

  it("generator ⇒ [object GeneratorFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(function* () {});`))).toEqual({
      ok: true,
      value: "[object GeneratorFunction]",
    });
  });

  it("async generator ⇒ [object AsyncGeneratorFunction]（改前折 [object Function]）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(async function* () {});`))).toEqual({
      ok: true,
      value: "[object AsyncGeneratorFunction]",
    });
  });

  it("负控制：普通函数表达式 ⇒ [object Function]（原生同款）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(function () {});`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  });

  it("负控制：箭头函数 ⇒ [object Function]（原生同款）", () => {
    expect(v(wrap(`return Object.prototype.toString.call(() => 1);`))).toEqual({
      ok: true,
      value: "[object Function]",
    });
  });

  it("负控制：generator 仍有原生 prototype（Bug 93 面不被新值域破坏）", () => {
    expect(v(wrap(`const g = function* () {}; return typeof g.prototype;`))).toEqual({
      ok: true,
      value: "object",
    });
  });
});
