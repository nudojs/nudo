/**
 * A1 步骤 3/4 的**实证依据 · core 侧**（2026-11-06，独立成族轮）。
 *
 * 台账 `docs/design/generator-laziness.md` §5.3 停点此前只是文档推断；本文件
 * 把三组受控实验固化为可执行钉，用**真实 `$gen`** 复核。service 侧的两组
 * （B / C：dts 元素面退化、快照副本丢补写）见
 * `service/src/emit/__tests__/a1-laziness-evidence-poc.test.ts`。
 *
 * | 实验 | 结论 | 本文件 |
 * |---|---|---|
 * | A | 构造期不跑体 ⇒ 生成器 8 族 **100 条失败 / 38 通过** ⇒ eager 收集是值域 / `conf` / 元素面的承重结构（§2.1）。本钉收敛为「空体 ⇒ 元素表为空」这一最小可复核事实 | `eager 收集是元素面唯一来源` |
 * | D | `$gen` 的 `body` thunk 捕获**活绑定**（不是构造期快照）⇒ 消费点重跑能读到改写后的 9 | `活绑定` |
 * | E | 但重跑会**重复副作用**（体里的 `n++` 把 9 写成 10）⇒ 否决「消费点重跑 + join」这条捷径 | `重复副作用` |
 *
 * **本文件不接生产、不改任何既有断言**。D 是文档此前没有的新发现，E 是
 * 对「既然活绑定，能否直接重跑」这一自然想法的实测否决：体重跑会把体内
 * 副作用再执行一次，外层绑定被二次改写 ⇒ 不是 sound 的修法。
 * ⇒ 步骤 3/4 仍需 §2.3 的引擎内核表示变更（Abs 无时间轴 / 续体不可表达）。
 */
import { describe, it, expect } from "vitest";
import { numLit, type Abs } from "../../abs.ts";
import { formatAbs } from "../../format/format.ts";
import { $gen, $yield } from "../runtime/async.ts";
import { undef } from "../runtime/state.ts";
import { matchIterElements } from "../match-iter.ts";

/** 单元素生成器的首个 yield 值（`noUncheckedIndexedAccess` 下显式收窄）。 */
function firstYield(g: Abs): string {
  const els = matchIterElements(g) ?? [];
  expect(els).toHaveLength(1);
  const head = els[0];
  if (head === undefined) throw new Error("expected one collected yield");
  return formatAbs(head);
}

describe("A1 · 实验 A：eager 收集是元素面唯一来源", () => {
  it("真实 $gen 空体 ⇒ 元素表为空；yield 一次 ⇒ 元素表一项", () => {
    const empty = $gen(() => undef());
    expect(matchIterElements(empty)).toHaveLength(0);
    const collected = $gen(() => {
      $yield(numLit(1), 0);
      return undef();
    });
    expect(matchIterElements(collected)).toHaveLength(1);
  });

  it("构造期收集到的元素值 = 体的 yield 值（构造期绑定）", () => {
    let n = numLit(0);
    const body = (): Abs => {
      $yield(n, 0);
      return undef();
    };
    expect(firstYield($gen(body))).toBe("0  #exact");
  });
});

describe("A1 · 实验 D/E：body thunk 是活绑定，但重跑会重复副作用", () => {
  it("D：消费点重跑体读到的是**消费期**绑定，不是构造期快照", () => {
    let n = numLit(0);
    const body = (): Abs => {
      $yield(n, 0);
      return undef();
    };
    const first = $gen(body);
    expect(firstYield(first)).toBe("0  #exact");
    // 跨函数消费形态（R3-b）：外层绑定在构造之后被改写
    n = numLit(9);
    const rerun = $gen(body);
    expect(firstYield(rerun)).toBe("9  #exact");
  });

  it("E：重跑体会再执行一次副作用 ⇒ 否决「消费点重跑 + join」捷径", () => {
    let n = numLit(0);
    const body = (): Abs => {
      $yield(n, 0);
      n = numLit(99); // 模拟体里的 `n++` / 赋值
      return undef();
    };
    expect(firstYield($gen(body))).toBe("0  #exact");
    // 第二次跑：体先读到被上次副作用写成的 99，再写一次 ⇒ 副作用重复累加
    expect(firstYield($gen(body))).toBe("99  #exact");
  });
});
