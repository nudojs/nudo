/**
 * absToConstraint / joinThenProject：Abs → 契约投影（Phase 1 可表达子集）。
 *
 * 覆盖：字面量、number 常数界（含 int 编码）、string 长度界、boolean、
 * union（sum / or-pred 字面量集）、shape 递归（optional/空对象）、
 * array（元素投影与 prim 均匀退化）、conf 门槛、
 * joinThenProject 聚合、constraintToEntryAbs 往返。
 * 每类不可表达形态反例 → undefined。
 */
import { describe, it, expect } from "vitest";
import { absToConstraint, joinThenProject } from "../projection.ts";
import {
  abs,
  bool,
  boolLit,
  num,
  numLit,
  numVar,
  obj,
  str,
  strLit,
  type Abs,
} from "../abs.ts";
import {
  and,
  eq,
  ge,
  gt,
  le,
  lt,
  ne,
  or,
  predToString,
  ptypeof,
  type Pred,
} from "../pred.ts";
import { app, lit, v } from "../term.ts";
import {
  array,
  constraintToEntryAbs,
  instantiateConstraint,
  isNudoConstraint,
  isIntFlag,
  lit as cLit,
  number,
  shape,
  string,
  union,
  type NudoConstraint,
} from "../constraint.ts";
import { formatConstraint } from "../interface.ts";
import { joinAbs } from "../objects.ts";

/** 契约实例化成 Pred 的显示串（golden 比较用） */
function inst(c: NudoConstraint, name = "x"): string {
  return predToString(instantiateConstraint(c, name));
}

/** 投影必须成功，返回实例化显示串 */
function round(a: Abs, name = "x"): string {
  const c = absToConstraint(a);
  expect(c).toBeDefined();
  expect(isNudoConstraint(c!)).toBe(true);
  return inst(c!, name);
}

/** prim string 参数 Abs（abs.ts 无 strVar 工厂，手工搭） */
function strVar(id: string, pred?: Pred, conf: Abs["conf"] = "path"): Abs {
  return abs({ k: "prim", type: "string" }, v(id), pred, conf);
}

const len = (t: ReturnType<typeof v>) => app("length", [t]);

describe("absToConstraint", () => {
  describe("字面量 → lit", () => {
    it("term lit 形态（numLit/strLit/boolLit 工厂）", () => {
      expect(round(numLit(42))).toBe("x = 42");
      expect(round(strLit("a"))).toBe('x = "a"');
      expect(round(boolLit(true))).toBe("x = true");
    });

    it("eq(self, lit) pred 形态（constraintToEntryAbs(lit) 的产物）", () => {
      expect(round(numVar("n", eq(v("n"), lit(42))))).toBe("x = 42");
      expect(round(strVar("s", eq(v("s"), lit("a"))))).toBe('x = "a"');
    });

    it("eq 两侧顺序无关", () => {
      expect(round(numVar("n", eq(lit(42), v("n"))))).toBe("x = 42");
    });

    it("eq 与常数界并存：eq 主导", () => {
      expect(round(numVar("n", and(eq(v("n"), lit(5)), gt(v("n"), lit(0)))))).toBe(
        "x = 5",
      );
    });

    it("两个不同 eq：不可满足 → undefined", () => {
      expect(
        absToConstraint(numVar("n", and(eq(v("n"), lit(5)), eq(v("n"), lit(6))))),
      ).toBeUndefined();
    });
  });

  describe("number 常数界", () => {
    it("单个 gt 界", () => {
      expect(round(numVar("n", gt(v("n"), lit(0))))).toBe("x > 0");
    });

    it("and 链 ge/le", () => {
      expect(
        round(numVar("n", and(ge(v("n"), lit(0)), le(v("n"), lit(100))))),
      ).toBe("x ≥ 0 ∧ x ≤ 100");
    });

    it("无界 num() → number()", () => {
      const c = absToConstraint(num());
      expect(c).toBeDefined();
      expect(c!.prim).toBe("number");
      expect(c!.preds).toHaveLength(0);
    });

    it("typeof self 冗余叶跳过", () => {
      const c = absToConstraint(numVar("n", ptypeof(v("n"), "number")));
      expect(c).toBeDefined();
      expect(c!.preds).toHaveLength(0);
    });

    it("int 位：eq((self % 1), 0) 编码 → .int()", () => {
      const c = absToConstraint(
        numVar("n", and(eq(app("%", [v("n"), lit(1)]), lit(0)), gt(v("n"), lit(0)))),
      );
      expect(c).toBeDefined();
      // 投影产物是 builder：int 标志经 isIntFlag 统一读取
      expect(isIntFlag(c!)).toBe(true);
      expect(inst(c!)).toBe("x > 0");
    });

    it("不可满足界集（含冗余 ge/le）→ undefined", () => {
      // gt(x,5) ∧ le(x,5) 已不可满足；冗余 ge(x,5) 不得把 strict 降级而误判可满足
      expect(
        absToConstraint(numVar("n", and(gt(v("n"), lit(5)), ge(v("n"), lit(5)), le(v("n"), lit(5))))),
      ).toBeUndefined();
      // 对称：lt(x,5) ∧ le(x,5) ∧ ge(x,5)
      expect(
        absToConstraint(numVar("n", and(lt(v("n"), lit(5)), le(v("n"), lit(5)), ge(v("n"), lit(5))))),
      ).toBeUndefined();
      // 对照组：无冗余同样不可满足
      expect(
        absToConstraint(numVar("n", and(gt(v("n"), lit(5)), le(v("n"), lit(5))))),
      ).toBeUndefined();
    });

    it("反例：ne → undefined", () => {
      expect(absToConstraint(numVar("n", ne(v("n"), lit(0))))).toBeUndefined();
    });

    it("反例：界未锚定 self 项 → undefined", () => {
      expect(absToConstraint(numVar("n", gt(v("y"), lit(0))))).toBeUndefined();
      expect(absToConstraint(numVar("n", gt(v("m"), v("n"))))).toBeUndefined();
    });

    it("反例：常数界左 lit 右 self（翻转形态）→ undefined", () => {
      expect(absToConstraint(numVar("n", gt(lit(0), v("n"))))).toBeUndefined();
    });

    it("反例：length 于 number → undefined", () => {
      expect(
        absToConstraint(numVar("n", ge(app("length", [v("n")]), lit(3)))),
      ).toBeUndefined();
    });

    it("反例：typeof 与 shape 不符 → undefined", () => {
      expect(
        absToConstraint(numVar("n", ptypeof(v("n"), "string"))),
      ).toBeUndefined();
    });

    it("反例：无 term 却带 pred → undefined", () => {
      expect(absToConstraint(abs(num().shape, undefined, gt(v("n"), lit(0)), "path"))).toBeUndefined();
    });
  });

  describe("string 长度界", () => {
    it("min/max（ge/le 于 length(self)）", () => {
      const pred = and(ge(len(v("s")), lit(1)), le(len(v("s")), lit(20)));
      expect(round(strVar("s", pred))).toBe(
        inst(string().min(1).max(20)),
      );
    });

    it("gt/lt 长度界按整数域归一（> 2 ⇒ ≥ 3、< 5 ⇒ ≤ 4）", () => {
      expect(round(strVar("s", gt(len(v("s")), lit(2))))).toBe(
        inst(string().min(3)),
      );
      expect(round(strVar("s", lt(len(v("s")), lit(5))))).toBe(
        inst(string().max(4)),
      );
    });

    it("无界 str() → string()", () => {
      const c = absToConstraint(str());
      expect(c).toBeDefined();
      expect(c!.prim).toBe("string");
      expect(c!.preds).toHaveLength(0);
    });

    it("反例：数值界于 self（非 length）→ undefined", () => {
      expect(absToConstraint(strVar("s", gt(v("s"), lit(0))))).toBeUndefined();
    });

    it("反例：长度界未锚定 self → undefined", () => {
      expect(absToConstraint(strVar("s", ge(len(v("t")), lit(1))))).toBeUndefined();
    });
  });

  describe("boolean", () => {
    it("无界 → boolean()", () => {
      const c = absToConstraint(bool());
      expect(c).toBeDefined();
      expect(c!.prim).toBe("boolean");
      expect(c!.preds).toHaveLength(0);
    });

    it("eq(self, true) → lit(true)", () => {
      expect(
        round(abs({ k: "prim", type: "boolean" }, v("b"), eq(v("b"), lit(true)), "path")),
      ).toBe("x = true");
    });
  });

  describe("union：sum 形态", () => {
    it("全员字面量 → union(lit…)", () => {
      const sum = joinAbs(numLit(42), strLit("a"));
      expect(sum.shape.k).toBe("sum");
      expect(round(sum)).toBe(inst(union(cLit(42), cLit("a"))));
    });

    it("never 成员是空域，不贡献", () => {
      const sum: Abs = {
        shape: { k: "sum", members: [{ shape: { k: "never" }, conf: "exact" }, numLit(42)] },
        conf: "exact",
      };
      expect(round(sum)).toBe("x = 42");
    });

    it("反例：成员含非字面量（obj）→ undefined", () => {
      const sum = joinAbs(numLit(1), obj({ x: { value: numLit(1) } }));
      expect(sum.shape.k).toBe("sum");
      expect(absToConstraint(sum)).toBeUndefined();
    });

    it("反例：全员 never → undefined", () => {
      const sum: Abs = {
        shape: { k: "sum", members: [{ shape: { k: "never" }, conf: "exact" }] },
        conf: "exact",
      };
      expect(absToConstraint(sum)).toBeUndefined();
    });
  });

  describe("union：or-pred 字面量集", () => {
    it("prim string 或等值收窄 → union(lit…)", () => {
      const pred = or(eq(v("s"), lit("a")), eq(v("s"), lit("b")));
      expect(round(strVar("s", pred))).toBe(inst(union(cLit("a"), cLit("b"))));
    });

    it("prim number 同样成立", () => {
      const pred = or(eq(v("n"), lit(1)), eq(v("n"), lit(2)));
      expect(round(numVar("n", pred))).toBe(inst(union(cLit(1), cLit(2))));
    });

    it("any 形态携带 or-pred 也可投影", () => {
      const a = abs({ k: "any" }, v("x"), or(eq(v("x"), lit(1)), eq(v("x"), lit(2))), "path");
      expect(round(a)).toBe(inst(union(cLit(1), cLit(2))));
    });

    it("反例：or 含非 eq 叶 → undefined", () => {
      const pred = or(eq(v("s"), lit("a")), ptypeof(v("s"), "string"));
      expect(absToConstraint(strVar("s", pred))).toBeUndefined();
    });

    it("反例：字面量 prim 与 shape 不符 → undefined", () => {
      const pred = or(eq(v("n"), lit(1)), eq(v("n"), lit("a")));
      expect(absToConstraint(numVar("n", pred))).toBeUndefined();
    });
  });

  describe("shape：obj 递归", () => {
    it("字段递归投影", () => {
      expect(round(obj({ id: { value: numLit(1) } }), "u")).toBe(
        inst(shape({ id: cLit(1) }), "u"),
      );
    });

    it("嵌套 shape", () => {
      const a = obj({ user: { value: obj({ name: { value: strLit("n") } }) } });
      expect(round(a, "u")).toBe(inst(shape({ user: shape({ name: cLit("n") }) }), "u"));
    });

    it("可选槽位 → 字段 optional", () => {
      const c = absToConstraint(obj({ name: { value: str(), optional: true } }));
      expect(c).toBeDefined();
      expect(c!.fields!.name!.optional).toBe(true);
      expect(c!.fields!.name!.constraint.prim).toBe("string");
    });

    it("空对象 → shape({})", () => {
      const c = absToConstraint(obj({}));
      expect(c).toBeDefined();
      expect(c!.fields).toEqual({});
    });

    it("反例：任一字段不可投影 → 整体 undefined", () => {
      expect(absToConstraint(obj({ f: { value: { shape: { k: "unknown" }, conf: "partial" } } }))).toBeUndefined();
    });

    it("反例：open / 动态 index → undefined", () => {
      expect(
        absToConstraint(abs({ k: "obj", slots: {}, open: true }, undefined, undefined, "exact")),
      ).toBeUndefined();
      expect(
        absToConstraint(
          abs({ k: "obj", slots: {}, index: { key: str(), value: num() } }, undefined, undefined, "exact"),
        ),
      ).toBeUndefined();
    });
  });

  describe("array", () => {
    it("元素可投影 → array(item)", () => {
      const arr = abs({ k: "arr", element: numLit(3) }, undefined, undefined, "exact");
      const c = absToConstraint(arr);
      expect(c).toBeDefined();
      expect(c!.element).toBeDefined();
      expect(inst(c!.element!)).toBe("x = 3");
    });

    it("元素带界 → array(number().gt(0))", () => {
      const arr = abs(
        { k: "arr", element: numVar("e", gt(v("e"), lit(0))) },
        undefined,
        undefined,
        "exact",
      );
      const c = absToConstraint(arr);
      expect(c).toBeDefined();
      expect(inst(c!.element!)).toBe(inst(number().gt(0)));
    });

    it("元素不可投影但 prim 均匀无 preds → array(number()) 退化", () => {
      const element: Abs = { shape: { k: "prim", type: "number" }, conf: "widened" };
      const arr = abs({ k: "arr", element }, undefined, undefined, "exact");
      const c = absToConstraint(arr);
      expect(c).toBeDefined();
      expect(c!.element!.prim).toBe("number");
      expect(c!.element!.preds).toHaveLength(0);
    });

    it("反例：元素 unknown → undefined", () => {
      const arr = abs(
        { k: "arr", element: { shape: { k: "unknown" }, conf: "partial" } },
        undefined,
        undefined,
        "exact",
      );
      expect(absToConstraint(arr)).toBeUndefined();
    });

    it("反例：widened 元素仍带 preds → 不退化，undefined", () => {
      const element = { ...numVar("e", gt(v("e"), lit(0))), conf: "widened" as const };
      const arr = abs({ k: "arr", element }, undefined, undefined, "exact");
      expect(absToConstraint(arr)).toBeUndefined();
    });

    it("反例：元素 prim partial（分析失败）→ undefined", () => {
      const element: Abs = { shape: { k: "prim", type: "number" }, conf: "partial" };
      const arr = abs({ k: "arr", element }, undefined, undefined, "exact");
      expect(absToConstraint(arr)).toBeUndefined();
    });

    it("反例：元素 bigint（无构建器）→ undefined", () => {
      const element: Abs = { shape: { k: "prim", type: "bigint" }, conf: "exact" };
      const arr = abs({ k: "arr", element }, undefined, undefined, "exact");
      expect(absToConstraint(arr)).toBeUndefined();
    });
  });

  describe("conf 门槛：仅 exact/path 投影", () => {
    it("widened / partial / opaque / mock → undefined", () => {
      expect(absToConstraint({ ...numLit(42), conf: "widened" })).toBeUndefined();
      expect(absToConstraint({ ...numLit(42), conf: "partial" })).toBeUndefined();
      expect(absToConstraint({ ...numLit(42), conf: "opaque" })).toBeUndefined();
      expect(absToConstraint({ ...numLit(42), conf: "mock" })).toBeUndefined();
    });

    it("嵌套字段 conf 不达标 → 整体 undefined", () => {
      expect(
        absToConstraint(obj({ f: { value: { ...numLit(1), conf: "widened" } } })),
      ).toBeUndefined();
    });
  });

  describe("不可表达形态", () => {
    it("never / unknown / any（无 or-pred）→ undefined", () => {
      expect(absToConstraint({ shape: { k: "never" }, conf: "exact" })).toBeUndefined();
      expect(absToConstraint({ shape: { k: "unknown" }, conf: "partial" })).toBeUndefined();
      expect(absToConstraint(abs({ k: "any" }, v("x"), undefined, "path"))).toBeUndefined();
    });

    it("tuple / fn / eff / brand → undefined", () => {
      expect(
        absToConstraint(abs({ k: "tuple", elements: [numLit(1)] }, undefined, undefined, "exact")),
      ).toBeUndefined();
      expect(
        absToConstraint(abs({ k: "fn", params: ["x"] }, undefined, undefined, "exact")),
      ).toBeUndefined();
      expect(
        absToConstraint(abs({ k: "eff", eff: "promise", inner: num() }, undefined, undefined, "exact")),
      ).toBeUndefined();
      expect(
        absToConstraint(abs({ k: "brand", name: "b", shape: num() }, undefined, undefined, "exact")),
      ).toBeUndefined();
    });

    it("pred false → undefined", () => {
      expect(absToConstraint(numVar("n", { op: "false" }))).toBeUndefined();
    });

    it("嵌套 and 内 or → undefined", () => {
      const pred = and(gt(v("n"), lit(0)), or(eq(v("n"), lit(1)), eq(v("n"), lit(2))));
      expect(absToConstraint(numVar("n", pred))).toBeUndefined();
    });
  });
});

describe("joinThenProject（§4.2 先 join 再投影）", () => {
  it("空列表 → undefined", () => {
    expect(joinThenProject([])).toBeUndefined();
  });

  it("单元素直投", () => {
    expect(inst(joinThenProject([numLit(42)])!)).toBe("x = 42");
  });

  it("跨 prim 字面量 → union(lit(42), lit(\"a\"))", () => {
    const c = joinThenProject([numLit(42), strLit("a")]);
    expect(c).toBeDefined();
    expect(inst(c!)).toBe(inst(union(cLit(42), cLit("a"))));
  });

  it("同 prim 字面量 → union(lit…)（字面量快路径，顺序无关）", () => {
    // joinValues 的同 prim 塌缩（Phase A 丢 term）曾使结果依赖证据顺序：
    // [42,7,"a"] 一序 union 三字面量、另一序 not-projectable。快路径绕过
    // join 直接聚合（去重 + typeof/value 排序），任意证据顺序产物一致。
    const a = joinThenProject([numLit(42), numLit(7)]);
    const b = joinThenProject([numLit(7), numLit(42)]);
    expect(formatConstraint(a!)).toBe("union(lit(7), lit(42))");
    expect(formatConstraint(b!)).toBe("union(lit(7), lit(42))");
  });

  it("混合 widened → undefined", () => {
    // widened 须在前：joinValues 双字面量分支只取 a.conf（引擎 Phase A 形态），
    // [exact, widened] 顺序会把 widened 静默降为 path
    expect(
      joinThenProject([{ ...numLit(7), conf: "widened" }, numLit(42)]),
    ).toBeUndefined();
    // 非字面量 widened（join 走 confJoin 全量路径）同样拦下
    expect(
      joinThenProject([numLit(42), { ...num(), conf: "widened" }]),
    ).toBeUndefined();
  });

  it("同形对象聚合 → 槽位级 join 投影为字面量枚举", () => {
    const c = joinThenProject([
      obj({ x: { value: numLit(1) } }),
      obj({ x: { value: numLit(2) } }),
    ]);
    expect(c).toBeDefined();
    expect(inst(c!, "u")).toBe("(u.x = 1 ∨ u.x = 2)");
  });
});

describe("constraintToEntryAbs 往返", () => {
  it("number().gt(0)", () => {
    const original = number().gt(0);
    expect(round(constraintToEntryAbs(original, "x"))).toBe(inst(original));
  });

  it("string().min(1).max(20)", () => {
    const original = string().min(1).max(20);
    expect(round(constraintToEntryAbs(original, "s"), "s")).toBe(inst(original, "s"));
  });

  it("lit(42)", () => {
    const original = cLit(42);
    expect(round(constraintToEntryAbs(original, "x"))).toBe(inst(original));
  });

  it("shape({ id, name })", () => {
    const original = shape({ id: number().gt(0), name: string() });
    expect(round(constraintToEntryAbs(original, "u"), "u")).toBe(inst(original, "u"));
  });

  it("union(lit(42), lit(\"a\"))", () => {
    const original = union(cLit(42), cLit("a"));
    expect(round(constraintToEntryAbs(original, "x"))).toBe(inst(original));
  });

  it("已知有损：int 位经 entry Abs 丢失（约束→Abs 单向）", () => {
    const c = absToConstraint(constraintToEntryAbs(number().int().ge(0), "x"));
    expect(c).toBeDefined();
    expect(c!.int).not.toBe(true);
    expect(inst(c!)).toBe(inst(number().ge(0)));
  });
});
