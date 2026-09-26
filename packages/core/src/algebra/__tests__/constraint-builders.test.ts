/**
 * Phase 1 组合子扩展：shift / lit / union / fn / and / partial / pick / omit。
 * 覆盖：实例化正确性、非法形态 throw、归一化（builder → 纯数据）、
 * union 的 or-pred 与 entry Abs join、fn 拆表。
 */
import { describe, it, expect } from "vitest";
import {
  number,
  string,
  boolean,
  array,
  shape,
  litC,
  union,
  fn,
  andC,
  partial,
  pick,
  omit,
  isNudoConstraint,
  instantiateConstraint,
  constraintToEntryAbs,
  fnConstraintToEntryReqs,
  isIntFlag,
} from "../constraint.ts";
import { predToString } from "../pred.ts";
import { leqAbs } from "../leq.ts";

function inst(c: Parameters<typeof instantiateConstraint>[0], name: string): string {
  return predToString(instantiateConstraint(c, name));
}

describe("shift(n)：数值常数界平移", () => {
  it("gt: x>0 shift(1) → x>1", () => {
    expect(inst(number().gt(0).shift(1), "ms")).toBe("ms > 1");
  });

  it("ge: x≥0 shift(2) → x≥2", () => {
    expect(inst(number().ge(0).shift(2), "ms")).toBe("ms ≥ 2");
  });

  it("lt: x<10 shift(3) → x<13", () => {
    expect(inst(number().lt(10).shift(3), "ms")).toBe("ms < 13");
  });

  it("le: x≤100 shift(5) → x≤105", () => {
    expect(inst(number().le(100).shift(5), "ms")).toBe("ms ≤ 105");
  });

  it("链上多个界同时平移", () => {
    expect(inst(number().ge(0).le(100).shift(5), "n")).toBe("n ≥ 5 ∧ n ≤ 105");
  });

  it("int 标志保留", () => {
    const c = number().int().gt(0).shift(1);
    // builder 上 int 恒为链式方法（幂等可重复调用）；标志经 isIntFlag 统一读取
    expect(isIntFlag(c)).toBe(true);
    expect(inst(c, "ms")).toBe("ms > 1");
  });

  it(".int() 重复调用幂等（方法遮蔽时期曾 TypeError）", () => {
    const c = number().int().int().gt(0);
    expect(isIntFlag(c)).toBe(true);
    // int 位不进实例化 pred（toPlainConstraint 归一后仍是单一 gt 界）
    expect(inst(c, "x")).toBe("x > 0");
  });

  it("不可变：原约束不受 shift 影响", () => {
    const c = number().gt(0);
    c.shift(1);
    expect(inst(c, "ms")).toBe("ms > 0");
  });

  it("负向平移", () => {
    expect(inst(number().gt(10).shift(-3), "ms")).toBe("ms > 7");
  });

  it("length 界 → throw", () => {
    expect(() => string().min(1).shift(1)).toThrow();
    expect(() => string().max(10).shift(1)).toThrow();
    expect(() => string().length(2).shift(1)).toThrow();
  });

  it("shape / array / union / fn 形态 → throw", () => {
    expect(() => shape({ a: number() }).shift(1)).toThrow();
    expect(() => array(number().gt(0)).shift(1)).toThrow();
    expect(() => union(number().gt(0), number().lt(5)).shift(1)).toThrow();
    expect(() => fn({ x: number() }).shift(1)).toThrow();
  });

  it("非数值 prim → throw", () => {
    expect(() => string().shift(1)).toThrow();
    expect(() => boolean().shift(1)).toThrow();
  });

  it("eq 谓词（lit 编码）→ throw", () => {
    expect(() => litC(42).shift(1)).toThrow();
  });

  it("非有限 offset → throw", () => {
    expect(() => number().gt(0).shift(NaN)).toThrow(/finite/);
    expect(() => number().gt(0).shift(Infinity)).toThrow(/finite/);
    expect(() => number().gt(0).shift(-Infinity)).toThrow(/finite/);
  });
});

describe("litC(v)：字面量契约", () => {
  it("number 编码：prim number + eq(self, 42)", () => {
    const c = litC(42);
    expect(isNudoConstraint(c)).toBe(true);
    expect(c.prim).toBe("number");
    expect(inst(c, "x")).toBe("x = 42");
  });

  it("string 编码", () => {
    const c = litC("a");
    expect(c.prim).toBe("string");
    expect(inst(c, "x")).toBe('x = "a"');
  });

  it("boolean 编码", () => {
    const c = litC(true);
    expect(c.prim).toBe("boolean");
    expect(inst(c, "x")).toBe("x = true");
  });

  it("null 编码：无 prim + eq(self, null)", () => {
    const c = litC(null);
    expect(c.prim).toBeUndefined();
    expect(inst(c, "x")).toBe("x = null");
  });

  it("不开新字段：members/fn/fields/element 全空", () => {
    const c = litC(42);
    expect(c.members).toBeUndefined();
    expect(c.fn).toBeUndefined();
    expect(c.fields).toBeUndefined();
    expect(c.element).toBeUndefined();
  });

  it("entry Abs：prim 形态", () => {
    const a = constraintToEntryAbs(litC(42), "x");
    expect(a.shape.k).toBe("prim");
  });
});

describe("union(...cs)：成员析取", () => {
  it("实例化为 or-pred", () => {
    expect(inst(union(number().gt(0), number().lt(-5)), "x")).toBe(
      "(x > 0 ∨ x < -5)",
    );
  });

  it("嵌套 union 经 or() 展平", () => {
    const inner = union(number().gt(0), number().lt(-5));
    const outer = union(inner, boolean());
    expect(inst(outer, "x")).toBe(
      '(x > 0 ∨ x < -5 ∨ typeof x = "boolean")',
    );
  });

  it("prim-only 成员实例化为 typeof", () => {
    const p = instantiateConstraint(union(number(), string()), "x");
    if (p.op !== "or") throw new Error("expected or");
    expect(p.args.map(predToString)).toEqual([
      'typeof x = "number"',
      'typeof x = "string"',
    ]);
  });

  it("空参 throw；非约束成员 throw；字面量成员合法", () => {
    expect(() => union()).toThrow();
    expect(() => union({} as never)).toThrow();
    expect(() => union(42)).not.toThrow();
  });

  it("成员归一化为纯数据（builder 方法剥除）", () => {
    const u = union(number().gt(0));
    const m = u.members![0]!;
    expect(isNudoConstraint(m)).toBe(true);
    expect((m as { gt?: unknown }).gt).toBeUndefined();
    expect(m.preds[0]!.op).toBe("gt");
  });

  it("isNudoConstraint 接受 union 形态", () => {
    expect(isNudoConstraint(union(number().gt(0), litC(0)))).toBe(true);
  });

  it("entry Abs 为成员 join（sum）", () => {
    const a = constraintToEntryAbs(
      union(number().gt(0), string().min(1)),
      "x",
    );
    expect(a.shape.k).toBe("sum");
    if (a.shape.k === "sum") {
      expect(a.shape.members).toHaveLength(2);
      expect(a.shape.members.map((m) => m.shape)).toEqual([
        { k: "prim", type: "number" },
        { k: "prim", type: "string" },
      ]);
    }
  });

  it("同 prim 字面量 union → or(eq…) 保留字面量域（不塌成裸 number）", () => {
    // joinValues 对同 prim 双字面量会急切塌成裸 prim——entry Abs 必须绕开，
    // 否则 union(litC(5),litC(7)) 与更宽的字面量集在 leq/drift 下不可区分
    const a = constraintToEntryAbs(union(litC(5), litC(7)), "x");
    expect(a.shape).toEqual({ k: "prim", type: "number" });
    expect(a.pred?.op).toBe("or");
    if (a.pred?.op === "or") {
      expect(a.pred.args).toHaveLength(2);
    }
    const b = constraintToEntryAbs(union(litC(5), litC(7), litC(-1)), "x");
    expect(b.pred?.op).toBe("or");
    // 更宽的集不是更窄集的子集（今天 ⊄ 期望）→ drift 应能区分
    expect(leqAbs(b, a).ok).toBe(false);
    expect(leqAbs(a, b).ok).toBe(true);
  });

  it("跨 prim 字面量 union 仍走 sum（number|string）", () => {
    const a = constraintToEntryAbs(union(litC(42), litC("a")), "x");
    expect(a.shape.k).toBe("sum");
  });

  it("union 嵌在 shape 字段里递归 or", () => {
    const s = shape({ level: union(number().gt(0), number().lt(-1)) });
    expect(inst(s, "u")).toBe("(u.level > 0 ∨ u.level < -1)");
  });
});

describe("fn(params, returns?, { throws? })：一等函数约束", () => {
  it("字段归一：params/returns/throws 纯数据存入 fn 槽", () => {
    const c = fn(
      { x: number().gt(0), y: string() },
      number().le(10),
      { throws: string().min(1) },
    );
    expect(isNudoConstraint(c)).toBe(true);
    expect(c.fn!.params.x!.prim).toBe("number");
    expect(c.fn!.params.x!.preds[0]!.op).toBe("gt");
    expect(c.fn!.params.y!.prim).toBe("string");
    expect(c.fn!.returns?.prim).toBe("number");
    expect(c.fn!.throws?.prim).toBe("string");
    // builder 方法剥除
    expect((c.fn!.params.x! as { gt?: unknown }).gt).toBeUndefined();
  });

  it("省略 returns/throws 时槽位缺省", () => {
    const c = fn({ x: number() });
    expect(c.fn!.returns).toBeUndefined();
    expect(c.fn!.throws).toBeUndefined();
  });

  it("参数位 instantiate 恒真（Phase 1 只展示不执法）", () => {
    expect(instantiateConstraint(fn({ x: number().gt(0) }), "cb")).toEqual({
      op: "true",
    });
  });

  it("entry Abs 落成 fn shape（refine→error 可测路径）", () => {
    expect(constraintToEntryAbs(fn({ x: number() }), "cb").shape.k).toBe("fn");
  });

  it("fnConstraintToEntryReqs：拆逐参约束表", () => {
    const c = fn({ x: number().gt(0), y: string() });
    const reqs = fnConstraintToEntryReqs(c);
    expect(reqs.map((r) => r.param)).toEqual(["x", "y"]);
    expect(reqs[0]!.constraint.prim).toBe("number");
    expect(reqs[1]!.constraint.prim).toBe("string");
    for (const r of reqs) expect(isNudoConstraint(r.constraint)).toBe(true);
  });

  it("fnConstraintToEntryReqs：非 fn 形态 throw", () => {
    expect(() => fnConstraintToEntryReqs(number().gt(0))).toThrow();
  });
});

describe("andC(...cs)：标量合取", () => {
  it("prim 一致 → preds 拼接", () => {
    const c = andC(number().gt(0), number().lt(10));
    expect(c.prim).toBe("number");
    expect(inst(c, "n")).toBe("n > 0 ∧ n < 10");
  });

  it("lit 参与合取（prim 同为 number）", () => {
    const c = andC(number().gt(0), litC(5));
    expect(inst(c, "n")).toBe("n > 0 ∧ n = 5");
  });

  it("无 prim 标量（litC(null)）不与显式 prim 冲突", () => {
    const c = andC(litC(null), number().gt(0));
    expect(c.prim).toBe("number");
    expect(inst(c, "n")).toBe("n = null ∧ n > 0");
  });

  it("不可变：操作数不受影响", () => {
    const a = number().gt(0);
    andC(a, number().lt(10));
    expect(a.preds).toHaveLength(1);
  });

  it("prim 不一致 → throw", () => {
    expect(() => andC(number().gt(0), string())).toThrow();
    expect(() => andC(string(), boolean())).toThrow();
  });

  it("fields / element / members / fn → throw", () => {
    expect(() => andC(shape({ a: number() }), number())).toThrow();
    expect(() => andC(array(number()), number())).toThrow();
    expect(() => andC(union(number(), number()), number())).toThrow();
    expect(() => andC(fn({ x: number() }), number())).toThrow();
  });

  it("空参 throw；非约束 → throw", () => {
    expect(() => andC()).toThrow();
    expect(() => andC("x" as never)).toThrow();
  });
});

describe("partial / pick / omit：shape 字段操作", () => {
  const base = shape({
    id: number().gt(0),
    name: string(),
    label: string().optional(),
  });

  it("partial：全字段变可选", () => {
    const p = partial(base);
    for (const k of ["id", "name", "label"]) {
      expect(p.fields![k]!.optional).toBe(true);
      expect(p.fields![k]!.constraint.isOptional).toBe(true);
    }
    // 原 shape 不可变
    expect(base.fields!.id!.optional).toBeUndefined();
  });

  it("partial 后 entry Abs 槽位 optional", () => {
    const a = constraintToEntryAbs(partial(shape({ a: number() })), "u");
    if (a.shape.k !== "obj") throw new Error("expected obj");
    expect(a.shape.slots.a!.optional).toBe(true);
  });

  it("partial 非 shape → throw", () => {
    expect(() => partial(number())).toThrow();
    expect(() => partial(litC(42))).toThrow();
  });

  it("pick：子形状，保留 optional 标志，忽略不存在 key", () => {
    const p = pick(base, ["id", "label", "zz"]);
    expect(Object.keys(p.fields!).sort()).toEqual(["id", "label"]);
    expect(p.fields!.label!.optional).toBe(true);
    expect(p.fields!.id!.constraint.preds[0]!.op).toBe("gt");
    // 原 shape 不可变
    expect(Object.keys(base.fields!).sort()).toEqual(["id", "label", "name"]);
  });

  it("pick 实例化为保留字段的谓词", () => {
    const p = pick(shape({ id: number().gt(0), name: string() }), ["id"]);
    expect(inst(p, "u")).toBe("u.id > 0");
  });

  it("pick 非 shape → throw", () => {
    expect(() => pick(number(), ["a"])).toThrow();
  });

  it("omit：去字段", () => {
    const o = omit(base, ["name"]);
    expect(Object.keys(o.fields!).sort()).toEqual(["id", "label"]);
    expect(omit(base, ["id", "name", "label"]).fields).toEqual({});
  });

  it("omit 非 shape → throw", () => {
    expect(() => omit(string(), ["a"])).toThrow();
  });
});

describe("既有构建器回归（新形态不改变原语义）", () => {
  it("number/string/array/shape 原样", () => {
    expect(inst(number().gt(0), "ms")).toBe("ms > 0");
    expect(inst(number().ge(0).le(100), "n")).toBe("n ≥ 0 ∧ n ≤ 100");
    expect(inst(string(), "s")).toBe('typeof s = "string"');
    expect(inst(shape({ id: number().gt(0) }), "u")).toBe("u.id > 0");
    // array 约束不经 pred 执法（既有行为）：实例化恒真
    expect(inst(array(number().gt(0)), "xs")).toBe("true");
  });

  it("int 链标志经 isIntFlag 可见（builder/纯数据统一读取）", () => {
    const withInt = number().int().gt(0);
    // builder 上 .int 恒为链式方法（重复调用幂等）；标志由 isIntFlag 承载
    expect(typeof withInt.int).toBe("function");
    expect(isIntFlag(withInt)).toBe(true);
    expect(isIntFlag(number().gt(0))).toBe(false);
    // 归一化后标志忠实保留 / 不虚增
    expect(union(withInt).members![0]!.int).toBe(true);
    expect(union(number().gt(0)).members![0]!.int).toBeUndefined();
  });
});

describe("非法成员不再静默丢弃", () => {
  it("shape 非约束字段 throw（对象/函数等非字面量）", () => {
    expect(() => shape({ id: {} as never })).toThrow(/shape/);
    expect(() => shape({ id: (() => 1) as never })).toThrow(/shape/);
  });

  it("shape/array 接受具体字面量（指令文法）", () => {
    expect(() => shape({ id: 42 })).not.toThrow();
    expect(() => array(42)).not.toThrow();
  });

  it("array 非约束元素 throw", () => {
    expect(() => array({} as never)).toThrow(/array/);
    expect(() => array((() => 1) as never)).toThrow(/array/);
  });

  it("optional 字段不进 instantiate 硬 pred（与 Abs 路径 slot.optional 对齐）", () => {
    const c = shape({ req: number().gt(0), opt: number().gt(0).optional() });
    expect(inst(c, "u")).toBe("u.req > 0");
  });
});
