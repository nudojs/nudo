/**
 * ABS-11：contract 合取与 union 精度。
 *
 * 覆盖：
 * - `and()`（andC）的结构合取：shape∧shape 字段级、array∧array 元素级、
 *   union∧union 成员交叉、fn∧fn 参数/返回位；矛盾形态显式 throw（conflict）；
 * - 合取不得静默丢字段 / 丢长度界（missing 字段 = 并集；单侧谓词并入）；
 * - dts 投影层「契约 × HOF 关系」合取：契约覆盖位绑定 HOF α，未覆盖位与
 *   返回位保留 β 链接（写契约不再退化成 unknown）。
 *
 * 说明：判别式穷尽性 warning 未在本批实现（避免高误报率的启发式；
 * 零误报优先，留待后续批次）。
 */
import { describe, it, expect } from "vitest";
import {
  andC,
  array,
  any,
  fn,
  formatConstraint,
  litC,
  number,
  shape,
  string,
  union,
} from "../index.ts";

describe("ABS-11 and() 结构合取", () => {
  it("shape ∧ shape：字段并集（缺失字段保留，同字段递归合取）", () => {
    expect(formatConstraint(andC(shape({ a: number() }), shape({ b: string() })))).toBe(
      "shape({ a: number(), b: string() })",
    );
    expect(
      formatConstraint(andC(shape({ a: number() }), shape({ a: number().gt(0) }))),
    ).toBe("shape({ a: number().gt(0) })");
  });

  it("array ∧ array：元素级合取 + 长度界并入（不丢义务）", () => {
    expect(
      formatConstraint(andC(array(number()), array(number().gt(0)))),
    ).toBe("array(number().gt(0))");
    const withLen = andC(array(number()), any().min(2));
    expect(formatConstraint(withLen)).toContain("array(number())");
    expect(formatConstraint(withLen)).toContain(".min(2)");
  });

  it("union ∧ union：成员交叉（2×2 = 4 支，语义为交集）", () => {
    const c = andC(union(litC(1), litC(2)), union(litC(1), litC(3)));
    const text = formatConstraint(c);
    expect(text.startsWith("union(")).toBe(true);
    // 4 个成员（交叉积）；字面量 1 的自交保留（eq(1).eq(1) 仍等价 1）
    expect((text.match(/number\(\)/g) ?? []).length).toBe(4);
  });

  it("fn ∧ fn：同键参数递归合取、返回位合取", () => {
    expect(
      formatConstraint(
        andC(fn({ x: number() }, number()), fn({ x: number().gt(0) }, number())),
      ),
    ).toBe("fn({ x: number().gt(0) }, number())");
  });

  it("矛盾形态显式 throw（conflict 通道，不静默丢义务）", () => {
    // 结构型 × 数字 prim：obj/arr/fn 不可能同时是 number
    expect(() => andC(shape({ a: number() }), number())).toThrow(/structurally impossible|cannot be conjoined/);
    expect(() => andC(array(number()), number())).toThrow(/structurally impossible|cannot be conjoined/);
    // 标量 prim 矛盾
    expect(() => andC(number(), string())).toThrow(/inconsistent prim/);
    // union × 非标量：显式拒绝（先窄化）
    expect(() => andC(union(litC(1), litC(2)), shape({ a: number() }))).toThrow(
      /union × non-scalar|not supported/,
    );
  });

  it("binder 合取规则：同名合并、异名 conflict", () => {
    const c = andC(
      shape({ x: number() }),
      shape({ x: number().gt(0) }),
    );
    expect(formatConstraint(c)).toContain("gt(0)");
    expect(() => andC(shape({ a: number() }), array(number()))).toThrow();
  });
});
