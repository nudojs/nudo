/**
 * Bug 106 回归（core 面）：`isHiddenInternalSlot` 缺 `symbolKey` 规则
 * ⇒ check / test 签名面把符号键槽发布成运行时不存在的字符串字段
 * （`"@@iterator"` / `"@@sym#1"`），guard 面还写出恒假的 Object.hasOwn 子句。
 *
 * 修法：core 判据补 `if (slot.symbolKey === true) return true`（与 service
 * 侧 internal-slot.ts 的 BUG-131 同款），使 format（展示/签名）、projection
 * （约束）、denote（guard）三个消费点同口径剔除。
 */
import { describe, it, expect } from "vitest";
import { abs, numLit, type Abs } from "../abs.ts";
import { isHiddenInternalSlot } from "../interface/slot-visibility.ts";
import { formatShape } from "../format/format.ts";
import { denoteGuard } from "../denote.ts";

/** `const o = { a: 1, [Symbol.iterator]: 2 }; return o;` 的引擎建模 */
const withSymbolSlot = (): Abs =>
  abs(
    {
      k: "obj",
      slots: {
        a: { value: numLit(1) },
        "@@iterator": { value: numLit(2), symbolKey: true },
      },
    },
    undefined,
    undefined,
    "exact",
  );

describe("Bug 106：core 槽可见性 symbolKey 规则", () => {
  it("isHiddenInternalSlot 剔除 symbolKey 槽（与 service 副本同款）", () => {
    expect(isHiddenInternalSlot("@@iterator", { symbolKey: true })).toBe(true);
    expect(isHiddenInternalSlot("@@sym#1", { symbolKey: true })).toBe(true);
    expect(isHiddenInternalSlot("a", { symbolKey: false })).toBe(false);
    expect(isHiddenInternalSlot("a", {})).toBe(false);
  });

  it("internal 规则与规范数组下标例外保持不变", () => {
    expect(isHiddenInternalSlot("next", { internal: true })).toBe(true);
    expect(isHiddenInternalSlot("0", { internal: true })).toBe(false);
    // symbol 键不分数组下标例外——一律不可见
    expect(isHiddenInternalSlot("0", { internal: true, symbolKey: true })).toBe(true);
  });

  it("formatShape（check / test 签名面）不发布符号键槽", () => {
    const s = formatShape(withSymbolSlot(), { showLits: true });
    expect(s).toContain("a");
    expect(s).not.toContain("@@iterator");
  });

  it("denoteGuard（guard 面）不写恒假的 Object.hasOwn(@@iterator) 子句", () => {
    const g = denoteGuard(withSymbolSlot(), "data");
    expect(g).not.toContain("@@iterator");
    expect(g).toContain("data.a");
  });
});
