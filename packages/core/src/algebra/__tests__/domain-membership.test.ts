/**
 * literalMeetsConstraint：字面量域隶属判定（Phase 1 标量子集）。
 *
 * 覆盖：number 域（gt/int）、string 域（min/max/length 长度界、eq 字面量）、
 * boolean/null 字面量、union members、对象/数组/函数域 → false、prim 门。
 */
import { describe, it, expect } from "vitest";
import { literalMeetsConstraint } from "../domain-membership.ts";
import {
  SELF,
  array,
  boolean,
  number,
  shape,
  string,
  type NudoConstraint,
} from "../constraint.ts";
import { eq, ge } from "../pred.ts";
import { lit, v } from "../term.ts";
import { lit as cLit, union as cUnion, and as cAnd } from "../constraint.ts";

/** lit(v) 的编码形态（prim + eq(self, lit v)；null 无 PrimName 可配） */
function litConstraint(value: number | string | boolean | null): NudoConstraint {
  if (value === null) {
    return { __nudoConstraint: true, preds: [eq(v(SELF), lit(null))] };
  }
  const prim =
    typeof value === "number"
      ? "number"
      : typeof value === "string"
        ? "string"
        : "boolean";
  return { __nudoConstraint: true, prim, preds: [eq(v(SELF), lit(value))] };
}

/** union(...cs) 编码形态的手工等价物：绕过 toPlainConstraint 归一化直测
 *  members 裸解码（union() 构建器已落地，此处不复刻其 builder 表面） */
function unionOf(...members: NudoConstraint[]): NudoConstraint {
  return {
    __nudoConstraint: true,
    preds: [],
    members,
  } as unknown as NudoConstraint;
}

describe("literalMeetsConstraint", () => {
  describe("number 域", () => {
    it("gt 常数界", () => {
      expect(literalMeetsConstraint(5, number().gt(0))).toBe(true);
      expect(literalMeetsConstraint(1, number().gt(0))).toBe(true);
      expect(literalMeetsConstraint(0, number().gt(0))).toBe(false);
      expect(literalMeetsConstraint(-3, number().gt(0))).toBe(false);
    });

    it("ge/lt/le 含端点", () => {
      expect(literalMeetsConstraint(0, number().ge(0))).toBe(true);
      expect(literalMeetsConstraint(-1, number().ge(0))).toBe(false);
      expect(literalMeetsConstraint(9, number().lt(10))).toBe(true);
      expect(literalMeetsConstraint(10, number().lt(10))).toBe(false);
      expect(literalMeetsConstraint(10, number().le(10))).toBe(true);
    });

    it("int 整数性（int:true 标志位，仅 number prim 上执法）", () => {
      const intC: NudoConstraint = {
        __nudoConstraint: true,
        prim: "number",
        int: true,
        preds: [],
      };
      expect(literalMeetsConstraint(3, intC)).toBe(true);
      expect(literalMeetsConstraint(0, intC)).toBe(true);
      expect(literalMeetsConstraint(3.5, intC)).toBe(false);
      const intGe: NudoConstraint = {
        __nudoConstraint: true,
        prim: "number",
        int: true,
        preds: [ge(v(SELF), lit(-10))],
      };
      expect(literalMeetsConstraint(-2, intGe)).toBe(true);
      expect(literalMeetsConstraint(2.5, intGe)).toBe(false);
      expect(literalMeetsConstraint(-20, intGe)).toBe(false);
      // 非整数性标志不拖累布尔域
      expect(literalMeetsConstraint(true, boolean())).toBe(true);
      // builder 侧（assign 序修复后 int:true 可见）
      expect(literalMeetsConstraint(3, number().int())).toBe(true);
      expect(literalMeetsConstraint(3.5, number().int())).toBe(false);
      expect(literalMeetsConstraint(-2, number().int().ge(-10))).toBe(true);
    });

    it("非 number 字面量 → false（prim 门）", () => {
      expect(literalMeetsConstraint("5", number().gt(0))).toBe(false);
      expect(literalMeetsConstraint(true, number())).toBe(false);
      expect(literalMeetsConstraint(null, number())).toBe(false);
    });
  });

  describe("string 域", () => {
    it("min/max 长度界", () => {
      expect(literalMeetsConstraint("abc", string().min(1))).toBe(true);
      expect(literalMeetsConstraint("", string().min(1))).toBe(false);
      expect(literalMeetsConstraint("ab", string().max(2))).toBe(true);
      expect(literalMeetsConstraint("abc", string().max(2))).toBe(false);
    });

    it("length 精确长度（and 包裹的两个长度界）", () => {
      expect(literalMeetsConstraint("abc", string().length(3))).toBe(true);
      expect(literalMeetsConstraint("ab", string().length(3))).toBe(false);
      expect(literalMeetsConstraint(3, string().length(3))).toBe(false);
    });

    it("eq 字面量（string / number）", () => {
      expect(literalMeetsConstraint("a", litConstraint("a"))).toBe(true);
      expect(literalMeetsConstraint("b", litConstraint("a"))).toBe(false);
      expect(literalMeetsConstraint(42, litConstraint(42))).toBe(true);
      expect(literalMeetsConstraint(43, litConstraint(42))).toBe(false);
    });

    it("eq 字面量两端对称（lit 在左）", () => {
      const flipped: NudoConstraint = {
        __nudoConstraint: true,
        prim: "string",
        preds: [eq(lit("a"), v(SELF))],
      };
      expect(literalMeetsConstraint("a", flipped)).toBe(true);
      expect(literalMeetsConstraint("b", flipped)).toBe(false);
    });

    it("非 string 字面量 → false（prim 门）", () => {
      expect(literalMeetsConstraint(42, string().min(1))).toBe(false);
    });
  });

  describe("boolean / null 字面量", () => {
    it("boolean 域与 eq 字面量", () => {
      expect(literalMeetsConstraint(true, boolean())).toBe(true);
      expect(literalMeetsConstraint(false, boolean())).toBe(true);
      expect(literalMeetsConstraint(true, litConstraint(true))).toBe(true);
      expect(literalMeetsConstraint(false, litConstraint(true))).toBe(false);
    });

    it("null：lit(null) 无 prim，eq(self,null) 可满足；对非 null 字面量不满足", () => {
      expect(literalMeetsConstraint(null, litConstraint(null))).toBe(true);
      expect(literalMeetsConstraint(null, string())).toBe(false);
      expect(literalMeetsConstraint(0, litConstraint(null))).toBe(false);
    });
  });

  describe("union members", () => {
    const u = unionOf(litConstraint(42), litConstraint("a"));

    it("任一成员满足 → true", () => {
      expect(literalMeetsConstraint(42, u)).toBe(true);
      expect(literalMeetsConstraint("a", u)).toBe(true);
    });

    it("全不满足 → false", () => {
      expect(literalMeetsConstraint("b", u)).toBe(false);
      expect(literalMeetsConstraint(43, u)).toBe(false);
      expect(literalMeetsConstraint(true, u)).toBe(false);
    });

    it("union 与数值界成员组合", () => {
      const u2 = unionOf(number().gt(0), litConstraint("a"));
      expect(literalMeetsConstraint(7, u2)).toBe(true);
      expect(literalMeetsConstraint(-7, u2)).toBe(false);
      expect(literalMeetsConstraint("a", u2)).toBe(true);
    });
  });

  describe("真实构建器产物（lit/union，Phase 1 编码形态）", () => {
    it("lit(v)：prim 按 v 类型 + eq(self, v)", () => {
      expect(literalMeetsConstraint(42, cLit(42))).toBe(true);
      expect(literalMeetsConstraint(43, cLit(42))).toBe(false);
      expect(literalMeetsConstraint("a", cLit("a"))).toBe(true);
      expect(literalMeetsConstraint(true, cLit(true))).toBe(true);
      // lit(null) 无 prim，eq(self,null) 可满足
      expect(literalMeetsConstraint(null, cLit(null))).toBe(true);
      expect(literalMeetsConstraint(0, cLit(null))).toBe(false);
    });

    it("union(...cs)：members 任一满足", () => {
      const u = cUnion(cLit(42), cLit("a"));
      expect(literalMeetsConstraint(42, u)).toBe(true);
      expect(literalMeetsConstraint("a", u)).toBe(true);
      expect(literalMeetsConstraint("b", u)).toBe(false);
      // 非整数字面量成员：归一化不得带杂散 int 位（T1 assign 序修复后）
      expect(literalMeetsConstraint(2.5, cUnion(cLit(2.5), cLit("a")))).toBe(true);
    });

    it("and(...cs) 合成（源码 refine × 侧车同名合一的有效契约形态）", () => {
      // R02：effectiveInterface 的 conjoin 产出 and() 合成约束——prim 合并 +
      // preds 拼接 + int 位传播，域判定必须走同一条合取路径
      const both = cAnd(number().gt(0), number().int());
      expect(literalMeetsConstraint(3, both)).toBe(true);
      expect(literalMeetsConstraint(3.5, both)).toBe(false); // int 位传播
      expect(literalMeetsConstraint(0, both)).toBe(false); // gt(0) 下界
      const neg = cAnd(number().gt(0), number().lt(10));
      expect(literalMeetsConstraint(5, neg)).toBe(true);
      expect(literalMeetsConstraint(-1, neg)).toBe(false);
      expect(literalMeetsConstraint(11, neg)).toBe(false);
    });
  });

  describe("对象 / 数组 / 函数域 → false", () => {
    it("shape（fields）", () => {
      expect(literalMeetsConstraint(42, shape({ id: number() }))).toBe(false);
    });

    it("array（element）", () => {
      expect(literalMeetsConstraint(42, array(number()))).toBe(false);
    });

    it("fn（一等函数约束）", () => {
      const fnC = {
        __nudoConstraint: true,
        preds: [],
        fn: { params: { x: { __nudoConstraint: true, prim: "number", preds: [] } } },
      } as unknown as NudoConstraint;
      expect(literalMeetsConstraint(42, fnC)).toBe(false);
    });
  });

  describe("prim 门", () => {
    it("prim 缺失且无 preds（any）→ 接受字面量", () => {
      const anyC: NudoConstraint = { __nudoConstraint: true, preds: [] };
      expect(literalMeetsConstraint(42, anyC)).toBe(true);
      expect(literalMeetsConstraint(null, anyC)).toBe(true);
    });

    it("prim 与字面量类型不符 → false", () => {
      expect(literalMeetsConstraint("x", number().gt(0))).toBe(false);
      expect(literalMeetsConstraint(1, boolean())).toBe(false);
    });
  });

  describe("不可判定 pred 形态 → 保守 false", () => {
    it("ne / or / not / 右端非数字 lit 的界", () => {
      const neC: NudoConstraint = {
        __nudoConstraint: true,
        prim: "number",
        preds: [{ op: "ne", a: v(SELF), b: lit(1) }],
      };
      expect(literalMeetsConstraint(2, neC)).toBe(false);

      const strBound: NudoConstraint = {
        __nudoConstraint: true,
        prim: "number",
        preds: [{ op: "gt", a: v(SELF), b: lit("x") }],
      };
      expect(literalMeetsConstraint(5, strBound)).toBe(false);
    });
  });
});
