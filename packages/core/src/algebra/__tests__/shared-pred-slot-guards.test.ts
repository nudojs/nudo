/**
 * 共享叶子守卫钉：`pred-bounds.ts` / `slot-visibility.ts`。
 *
 * 两处此前各有多份逐字重复的实现（leq ↔ postcondition 的
 * numericBoundsImply；format / projection / denote 的 isHiddenInternalSlot）
 * ——现收敛到叶子模块。本测试钉住叶子语义，防未来改动让两份消费面重新分叉。
 */
import { describe, expect, it } from "vitest";
import { eq, ge, gt, le, lt } from "../pred.ts";
import { lit, v } from "../term.ts";
import { numericBoundsImply } from "../pred-bounds.ts";
import { isHiddenInternalSlot } from "../slot-visibility.ts";

const x = v("x");
const y = v("y");

describe("numericBoundsImply：界宽窄判定", () => {
  it("更紧的下界蕴含更宽下界（gt / ge）", () => {
    expect(numericBoundsImply(gt(x, lit(5)), gt(x, lit(0)))).toBe(true);
    expect(numericBoundsImply(ge(x, lit(5)), ge(x, lit(0)))).toBe(true);
    expect(numericBoundsImply(ge(x, lit(0)), ge(x, lit(0)))).toBe(true);
  });

  it("更宽的下界不蕴含更紧目标", () => {
    expect(numericBoundsImply(gt(x, lit(5)), gt(x, lit(6)))).toBe(false);
    expect(numericBoundsImply(ge(x, lit(0)), ge(x, lit(1)))).toBe(false);
  });

  it("更紧的上界蕴含更宽上界（lt / le），反向不成立", () => {
    expect(numericBoundsImply(lt(x, lit(5)), lt(x, lit(9)))).toBe(true);
    expect(numericBoundsImply(le(x, lit(5)), le(x, lit(9)))).toBe(true);
    expect(numericBoundsImply(lt(x, lit(9)), lt(x, lit(5)))).toBe(false);
    expect(numericBoundsImply(le(x, lit(9)), le(x, lit(5)))).toBe(false);
  });

  it("gt ⇒ ge / lt ⇒ le 的单向放宽；反向不放宽", () => {
    expect(numericBoundsImply(gt(x, lit(5)), ge(x, lit(5)))).toBe(true);
    expect(numericBoundsImply(ge(x, lit(5)), gt(x, lit(5)))).toBe(false);
    expect(numericBoundsImply(lt(x, lit(5)), le(x, lit(5)))).toBe(true);
    expect(numericBoundsImply(le(x, lit(5)), lt(x, lit(5)))).toBe(false);
  });

  it("不同被约束项 / 非数值界 / 非单比较 pred 一律不蕴含", () => {
    expect(numericBoundsImply(gt(y, lit(5)), gt(x, lit(0)))).toBe(false);
    expect(numericBoundsImply(gt(x, lit("a")), gt(x, lit(0)))).toBe(false);
    expect(numericBoundsImply(eq(x, lit(1)), eq(x, lit(1)))).toBe(false);
  });
});

describe("isHiddenInternalSlot：内部槽可见性", () => {
  it("internal 槽且键不是规范数组下标 ⇒ 隐藏", () => {
    expect(isHiddenInternalSlot("next", { internal: true })).toBe(true);
    expect(isHiddenInternalSlot("@@iterator", { internal: true })).toBe(true);
    // 非规范下标（前导零 / 负数 / 非整数）不是元素域槽 ⇒ 照旧隐藏
    expect(isHiddenInternalSlot("01", { internal: true })).toBe(true);
    expect(isHiddenInternalSlot("-1", { internal: true })).toBe(true);
  });

  it("规范数组下标槽保留（承载元素域，族 01 口径）", () => {
    expect(isHiddenInternalSlot("0", { internal: true })).toBe(false);
    expect(isHiddenInternalSlot("12", { internal: true })).toBe(false);
  });

  it("非 internal 槽一律可见", () => {
    expect(isHiddenInternalSlot("value", {})).toBe(false);
    expect(isHiddenInternalSlot("value", { internal: false })).toBe(false);
    expect(isHiddenInternalSlot("0", { internal: false })).toBe(false);
  });
});
