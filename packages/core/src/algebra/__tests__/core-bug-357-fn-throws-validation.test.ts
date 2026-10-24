/**
 * Bug 357 —— 侧车 `fn()` 的**第三实参**（`{ throws: … }`）零形态校验：
 * - `opts` 传非对象（如 `fn(p, r, "Error")`）⇒ `opts?.throws` 是 undefined
 *   ⇒ 整条 throws 申报被**静默丢弃**（零诊断）；
 * - `opts.throws` 归一后抠不出错误名（`{ throws: 42 }` / `{ throws: null }`）
 *   ⇒ throws 义务整条消失 ⇒ 用户已申报却仍报「may throw」，零诊断说明申报被吞。
 *
 * 修法（core/algebra/constraint.ts `fn`）：第三实参做形态校验 ——
 * `opts` 必须是对象；`opts.throws` 归一后必须能抽出至少一个错误名
 * （`throwConstraintToKinds` 非 undefined），否则抛出一条指名道姓的 DSL 错误。
 */
import { describe, it, expect } from "vitest";
import {
  fn,
  litC,
  number,
  throwConstraintToKinds,
  union,
} from "../constraint.ts";

describe("Bug 357：fn() 第三实参（throws）形态校验", () => {
  it("opts 非对象 → 抛指名道姓的错误（不再静默丢弃申报）", () => {
    expect(() => fn({ x: number() }, number(), "Error" as never)).toThrow(
      /third argument must be an options object/,
    );
  });

  it("opts 为 null → 同样报错", () => {
    expect(() => fn({ x: number() }, number(), null as never)).toThrow(
      /third argument must be an options object/,
    );
  });

  it("throws 声明抽不出错误名（数字 / null）→ 报错点名", () => {
    expect(() => fn({ x: number() }, number(), { throws: 42 })).toThrow(
      /does not name an error kind/,
    );
    expect(() => fn({ x: number() }, number(), { throws: null })).toThrow(
      /does not name an error kind/,
    );
  });

  it("合法 throws 申报照旧生效", () => {
    const c = fn({ x: number() }, number(), { throws: "TypeError" });
    expect(throwConstraintToKinds(c.fn!.throws)).toEqual(["TypeError"]);
    const c2 = fn({ x: number() }, number(), { throws: litC("TypeError") });
    expect(throwConstraintToKinds(c2.fn!.throws)).toEqual(["TypeError"]);
    const c3 = fn(
      { x: number() },
      number(),
      { throws: union(litC("TypeError"), litC("RangeError")) },
    );
    expect(throwConstraintToKinds(c3.fn!.throws)).toEqual([
      "TypeError",
      "RangeError",
    ]);
  });

  it("'*' 通配申报照旧生效", () => {
    const c = fn({ x: number() }, number(), { throws: "*" });
    expect(throwConstraintToKinds(c.fn!.throws)).toBe("*");
  });

  it("不传第三实参 → 槽位缺省（无申报）", () => {
    const c = fn({ x: number() });
    expect(c.fn!.throws).toBeUndefined();
  });
});
