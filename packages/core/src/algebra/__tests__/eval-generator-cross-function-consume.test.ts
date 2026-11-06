/**
 * A1 步骤 3 的 **R3-b 验收钉**（`docs/design/generator-laziness.md` §5.3）。
 *
 * 2026-11-07 步骤 3 已落地：`$gen` 构造期只登记待跑体，首个消费点触发，
 * 求值收口（core `exec/run.ts::callTranspiledExportFull`）排空未触发的壳。
 * 于是 body thunk 捕获的**活绑定**在消费时刻求值 ⇒ 与原生一致：
 * `yield n` 读到的是 `n = 9` 之后的值，不再是构造期的 0。
 *
 * 本文件钉住：① 两条跨函数消费的精确值；② 副作用只跑一次（绕开实验 E
 * 「重跑重复副作用」）；③ 元素域随值搬运、dts 不退化；④ 步骤 4 仍待办。
 */
import { describe, it, expect } from "vitest";
import { formatAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("A1 步骤 3 · 生成器跨函数消费（R3-b 验收）", () => {
  it("消费期绑定可见：`yield n` 在首次 next() 读到 9（native 9）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it.next().value;
    }`);
    expect(formatAbs(r.result)).toEqual("9  #exact");
  });

  it("生成器对象被 return 出外层函数后，元素面仍取消费期绑定（9）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it;
    }`);
    expect(formatAbs(r.result)).toContain('"0": 9');
    // 求值收口排空后，随值搬运的完整 yield 序列仍在 facets 上（dts 同源）
    expect(r.result.facets?.genElements).toHaveLength(1);
  });

  it("副作用只跑一次：构造 + 多次消费不重复执行体（n 只加一次）", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { n++; yield n; }
      const it = g();
      const first = it.next().value;
      return first + ":" + n;
    }`);
    // native：首次 next() 跑体 ⇒ value = 1、n = 1；重复跑体会给 1:2
    expect(formatAbs(r.result)).toContain("1:1");
  });

  it("dts 元素面不退化：求值收口后形状数字槽与 genElements 同源非空", () => {
    const r = call(`export function f() {
      function* g() { yield 1; yield 2; }
      return g();
    }`);
    expect(formatAbs(r.result)).toContain('"0": 1');
    expect(r.result.facets?.genElements).toHaveLength(2);
  });

  it.todo(
    "步骤 4 后：首个 yield 之后的写不提前落地（Bug 212 c3/c4 的 native 1 / \"a\" 精确复现）",
  );
});
