/**
 * BUG-157 回归：`URLSearchParams` 的 `@@entries` 是**内部槽**（原生不可枚举 /
 * 不可见），不得被投影面发布成必填自有属性。
 *
 * 根因：`packages/core/src/algebra/builtins/error/web.ts` 的
 * `urlSearchParamsBrandAbs` 建 `@@entries` 槽时**只给了 `value`**、没给
 * `internal: true`（而同文件 `:223` 的注释原文写着「条目表存内层 obj 的
 * `@@entries` 槽（内部槽——原生不可枚举/不可见）」⇒ 注释与实现相反）⇒
 * guard 产物要求被检查值**自带一个叫 `"@@entries"` 的属性**
 *（`Object.hasOwn(data, "@@entries")`）⇒ 任何真实的 `URLSearchParams` 都被
 * 拒绝（假红），而 dts / zod / standard 三面正确 ⇒ 四面矛盾。
 *
 * 修法：该槽补 `internal: true`（投影面统一按 `internal` 剔除）。
 */
import { describe, it, expect } from "vitest";
import { call, val, tupleEls } from "./eval-helpers.ts";
import { makeUrlSearchParamsAbs, URL_SEARCH_PARAMS_ENTRIES_SLOT } from "../builtins/error/web.ts";
import { isHiddenInternalSlot } from "../slot-visibility.ts";
import { $lit } from "../exec/runtime/state.ts";
import type { Slot } from "../objects.ts";

const lit = (src: string): unknown => {
  const r = val(src);
  return r.ok ? r.value : undefined;
};
const wrap = (body: string): string => `export function f() { ${body} }`;

describe("BUG-157：URLSearchParams 的 @@entries 内部槽", () => {
  it("@@entries 槽带 internal 标记（投影面据此剔除）", () => {
    const brand = makeUrlSearchParamsAbs($lit("a=1&b=2" as never));
    const inner = brand.shape.k === "brand" ? brand.shape.shape : undefined;
    expect(inner?.shape.k).toBe("obj");
    const slot = (inner!.shape as { slots: Record<string, Slot> }).slots[
      URL_SEARCH_PARAMS_ENTRIES_SLOT
    ];
    expect(slot, "@@entries 槽缺席（条目表未建模）").toBeDefined();
    expect(slot!.internal, "@@entries 未打 internal ⇒ guard 产物会要求它存在").toBe(true);
    expect(isHiddenInternalSlot(URL_SEARCH_PARAMS_ENTRIES_SLOT, slot!)).toBe(true);
  });

  it("运行时面：new URLSearchParams(\"a=1\") 的 getOwnPropertyNames 是 []", () => {
    expect(
      tupleEls(
        call(wrap('return Object.getOwnPropertyNames(new URLSearchParams("a=1"));')).result,
      ),
    ).toEqual([]);
  });

  it("运行时面：hasOwnProperty(\"@@entries\") 是 false（原生同款）", () => {
    expect(
      lit(wrap('return new URLSearchParams("a=1").hasOwnProperty("@@entries");')),
    ).toBe(false);
  });

  it("对照组：条目表本身仍可读（内部槽不影响 $get 派发）", () => {
    expect(lit(wrap('return new URLSearchParams("a=1&b=2").get("a");'))).toBe("1");
    expect(lit(wrap('return new URLSearchParams("a=1&b=2").size;'))).toBe(2);
  });
});
