/**
 * A1 步骤 3 的**前置钉**（`docs/design/generator-laziness.md` §5.3 R3-b）。
 *
 * 设计文档 §5.3 明确写着「体在消费点才跑 ⇒ 若消费点在另一个函数里（生成器
 * 被返回给外部再消费），体读到的外层绑定是**消费时刻**的值 ⇒ 与当前 eager
 * 结果不同 ⇒ 既有期望值可能过时（按纪律**停下来报告**）」，但仓内此前
 * **没有**覆盖该形态的回归钉（Grep `return (g|gen|it|iter);` 无生成器用例）。
 *
 * 本文件把现状与步骤 3/4 后应有的语义都登记下来：
 * - 一条**实测钉**钉住当前 eager 结果（防止步骤 3 静默改变值面而无人察觉）；
 * - 三条 `it.todo` 是步骤 3/4 的验收清单，不冒充已实现。
 *
 * 本文件不改任何生产代码。
 */
import { describe, it, expect } from "vitest";
import { formatAbs } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("A1 · 生成器跨函数消费（R3-b 前置钉）", () => {
  it("现状：体在构造期求值 ⇒ yield 读到构造期绑定，不是消费期绑定", () => {
    // native：`yield n` 在首次 next() 才求值 ⇒ 9。
    // 引擎（eager）：构造期就收集完 yield 序列 ⇒ 0。
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it.next().value;
    }`);
    expect(formatAbs(r.result)).toEqual("0  #exact");
  });

  it("现状：生成器对象被 return 出外层函数后消费，仍取构造期已收集的元素", () => {
    const r = call(`export function f() {
      let n = 0;
      function* g() { yield n; }
      const it = g();
      n = 9;
      return it;
    }`);
    // 元素面是构造期烘进 shape 的数字下标槽（族 01 契约）
    expect(formatAbs(r.result)).toContain('"0": 0');
  });

  it.todo(
    "步骤 3 后：消费期绑定应可见（`yield n` ⇒ 9 或 sound 的 0 | 9），并同步订正上面两条精确断言",
  );
  it.todo(
    "步骤 3 后：dts 元素面不得退成 `Generator<unknown>`（§5.2 的「可延后填充元素面」是前置条件）",
  );
  it.todo(
    "步骤 4 后：首个 yield 之后的写不提前落地（Bug 212 c3/c4 的 native 1 / \"a\" 精确复现）",
  );
});
