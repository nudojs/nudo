/**
 * A1 步骤 3/4 的**实证依据 · service 侧**（2026-11-06，独立成族轮）。
 *
 * 台账 `docs/design/generator-laziness.md` §5.3 停点此前只是文档推断；本文件
 * 把两组受控实验固化为可执行钉，用**真实生产函数**（`snapshotAbs` /
 * `absToTSType`）复核，供后续拍板时不必重做实验。core 侧的三组（A / D / E）
 * 见 `core/src/algebra/exec/__tests__/a1-laziness-evidence-core.test.ts`。
 *
 * | 实验 | 结论 | 对应钉 |
 * |---|---|---|
 * | B | 构造期无元素槽 ⇒ dts 从 `Generator<number>` 退成 **`Generator<unknown>`**（`iteratorTSType` 直读 shape，导出时无消费点） | `dts 元素面退化` |
 * | C | `snapshotAbs` 深拷贝 slots ⇒ 首消费点**原地补写 shape 槽只对原对象生效**，副本仍退化（§5.2 未处理的旁路） | `快照副本` |
 * | F | dts 是**纯投影**：`generateDts(result)` 只吃 `AnalysisResult`，模块只 import `@nudojs/core` 的纯函数、不引 exec 运行时 ⇒ 导出期没有、也不该有消费点 | `dts 纯投影` |
 *
 * **2026-11-06 订正**：实验 C 说的是 **shape 数字下标槽**的补写；
 * `snapshotAbs` 的 **match-iter 侧表迁移**（迭代元素 / drain / 延迟异常）已
 * 在同日补齐（`core/.../__tests__/snapshot-match-iter-tables.test.ts`），
 * 但那只搬 WeakMap 侧表，不改变 `shape.slots` 深拷贝这一事实 ⇒ C 仍成立。
 *
 * **本文件不接生产、不改任何既有断言**，只把「为什么步骤 3/4 必须引擎内核
 * 改造」钉成可复核证据。步骤 3 若推进，`eval-generator-cross-function-consume.test.ts`
 * 的 3 条 `it.todo` 是验收清单。product 决策（是否接受 `Generator<unknown>`
 * 的 sound 降级）见 `docs/design/generator-laziness.md` 「dts 元素域通道」。
 *
 * 口径说明：只用 `@nudojs/core` 公共导出 + 本包相对导入 —— 不跨包引 src
 * （vite 别名会把裸包名落到 dist 旧产物，与源码相对路径混用会串版本）。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, snapshotAbs, type Abs } from "@nudojs/core";
import { absToTSType } from "../dts-generator.ts";

const fnSlot = (): { value: Abs; internal: boolean } => ({
  value: abs({ k: "fn", params: [] }, undefined, undefined, "exact"),
  internal: true,
});

/** core `makeGenObject` 口径：internal 协议槽 + 可选数字下标元素槽。 */
function generatorLike(withElems: boolean): Abs {
  const slots: Record<string, { value: Abs; internal?: boolean }> = {
    next: fnSlot(),
    return: fnSlot(),
    throw: fnSlot(),
    ...(withElems ? { "0": { value: numLit(1), internal: true } } : {}),
  };
  const a = abs({ k: "obj", slots }, undefined, undefined, "exact");
  a.facets = { brand: "Generator" };
  return a;
}

describe("A1 · 实验 B/C：元素面可延后填充的两个结构性阻塞", () => {
  it("B：构造期有元素槽 ⇒ Generator<number>；无元素槽（体延后）⇒ Generator<unknown>", () => {
    expect(absToTSType(generatorLike(true))).toBe("Generator<number>");
    expect(absToTSType(generatorLike(false))).toBe("Generator<unknown>");
  });

  it("C：首消费点原地补写 shape 槽只对原对象生效，snapshotAbs 副本仍退化", () => {
    const g = generatorLike(false);
    const copy = snapshotAbs(g);
    const gSlots = (g.shape as { k: "obj"; slots: Record<string, { value: Abs; internal?: boolean }> }).slots;
    gSlots["0"] = { value: numLit(1), internal: true };
    expect(absToTSType(g), "原对象补写后恢复").toBe("Generator<number>");
    expect(absToTSType(copy), "副本拿不到补写").toBe("Generator<unknown>");
    expect(
      gSlots === (copy.shape as { slots: unknown }).slots,
      "snapshotAbs 深拷贝 slots，不共享引用",
    ).toBe(false);
  });
});

describe("A1 · 实验 F：dts 是纯投影（导出期无消费点）", () => {
  it("F：absToTSType 对同一 Abs 幂等，且不改变输入 shape", () => {
    const g = generatorLike(true);
    const before = JSON.stringify(g.shape);
    expect(absToTSType(g)).toBe("Generator<number>");
    expect(absToTSType(g)).toBe("Generator<number>");
    expect(JSON.stringify(g.shape), "投影不写回 Abs").toBe(before);
  });

  it("F：无元素槽时输出的是 sound 降级（unknown），不是错误或裸名", () => {
    const t = absToTSType(generatorLike(false));
    expect(t).toBe("Generator<unknown>");
    expect(t, "恒带类型实参，不触发 TS2314").toContain("<");
    expect(t).not.toBe("Generator");
  });
});
