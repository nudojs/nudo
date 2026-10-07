/**
 * lazy(() => tpl) 自引用约束模板（issue #120，unit）。
 *
 * 覆盖：builder 往返（thunk 保留 / optional 链保持）、非约束 thunk throw、
 * derefConstraint 按 thunk 记忆化（同一对象身份）、递归模板的
 * constraintToEntryAbs 按 LAZY_TEMPLATE_DEPTH 预算展开（嵌套 obj 槽 +
 * optional 标志）、预算耗尽字段为**缺席槽**（不发 undefined 值槽）、
 * 值位预算耗尽 → any、constraintAdmitsNullish / throwConstraintToKinds /
 * literalMeetsConstraint 环终止、formatConstraint 两层 + `…` 显示、
 * partial/pick/omit/andC 对 lazy 包装先解一层。
 */
import { describe, it, expect } from "vitest";
import { type Abs } from "../abs.ts";
import {
  LAZY_TEMPLATE_DEPTH,
  lazy,
  derefConstraint,
  isNudoConstraint,
  shape,
  string,
  boolean,
  number,
  array,
  nullable,
  union,
  litC,
  andC,
  partial,
  pick,
  omit,
  constraintToEntryAbs,
  constraintAdmitsNullish,
  throwConstraintToKinds,
  instantiateConstraint,
  instantiateOnTerm,
} from "../constraint.ts";
import { formatConstraint } from "../interface.ts";
import { literalMeetsConstraint } from "../domain-membership.ts";

/** issue #120 的递归 astNode 模板（侧车形态同款） */
const astNode = shape({
  type: string(),
  name: string().optional(),
  computed: boolean().optional(),
  object: lazy(() => astNode).optional(),
  property: lazy(() => astNode).optional(),
  callee: lazy(() => astNode).optional(),
  arguments: array(lazy(() => astNode)).optional(),
});

type ObjSlots = Record<string, { value: Abs; optional?: boolean }>;

function slotsOf(a: Abs): ObjSlots {
  if (a.shape.k !== "obj") throw new Error(`expected obj shape, got ${a.shape.k}`);
  return (a.shape as { slots: ObjSlots }).slots;
}

describe("lazy builder 往返", () => {
  it("lazy(thunk) 是约束，thunk 原样保留", () => {
    const thunk = () => number().gt(0);
    const c = lazy(thunk);
    expect(isNudoConstraint(c)).toBe(true);
    expect(c.lazy).toBe(thunk);
  });

  it("非函数实参 throw", () => {
    expect(() => lazy(42 as never)).toThrow(/lazy\(\)/);
  });

  it("optional() 链保持 thunk（同闭包跨包装）", () => {
    const thunk = () => string();
    const c = lazy(thunk).optional();
    expect(c.lazy).toBe(thunk);
    expect(c.isOptional).toBe(true);
  });

  it("shape 字段 / array 元素位的 lazy 经 toPlainConstraint 归一化保留", () => {
    expect(astNode.fields!.object!.constraint.lazy).toBeTypeOf("function");
    expect(astNode.fields!.arguments!.constraint.element!.lazy).toBeTypeOf("function");
    expect(astNode.fields!.object!.optional).toBe(true);
  });
});

describe("derefConstraint：解一层 + 记忆化", () => {
  it("thunk 不返回约束 → throw（描述性错误）", () => {
    expect(() => derefConstraint(lazy(() => 42 as never))).toThrow(
      /thunk must return a constraint/,
    );
  });

  it("重复 deref 同一 thunk → 同一对象身份（leq/缓存稳定）", () => {
    const c = lazy(() => number().gt(0));
    expect(derefConstraint(c)).toBe(derefConstraint(c));
    // optional() 重包装共享 thunk → 记忆化仍然命中
    expect(derefConstraint(c.optional())).toBe(derefConstraint(c));
  });

  it("deref 产物为归一化纯数据（无链式方法）", () => {
    const d = derefConstraint(lazy(() => number().gt(0)));
    expect((d as { gt?: unknown }).gt).toBeUndefined();
    expect(d.preds[0]!.op).toBe("gt");
  });
});

describe("constraintToEntryAbs：递归模板按预算展开", () => {
  it("LAZY_TEMPLATE_DEPTH = 3（预算钉住）", () => {
    expect(LAZY_TEMPLATE_DEPTH).toBe(3);
  });

  it("issue #120 astNode 模板终止，产出嵌套 obj 槽 + optional 标志", () => {
    const entry = constraintToEntryAbs(astNode, "node");
    // L1：顶层槽齐全，lazy 槽 optional
    const l1 = slotsOf(entry);
    expect(Object.keys(l1).sort()).toEqual(
      ["arguments", "callee", "computed", "name", "object", "property", "type"],
    );
    expect(l1.object!.optional).toBe(true);
    // L2/L3/L4：object 链一路是 obj 槽（3 次 lazy 展开）
    const l2 = slotsOf(l1.object!.value);
    const l3 = slotsOf(l2.object!.value);
    const l4 = slotsOf(l3.object!.value);
    expect(l1.type && l2.type && l3.type && l4.type).toBeTruthy();
    // 非lazy 字段在最深层照常展开
    expect(l4.type!.value.shape.k).toBe("prim");
    // 每层 object 槽都带 optional
    expect(l2.object!.optional).toBe(true);
    expect(l3.object!.optional).toBe(true);
    expect(l4.object).toBeUndefined(); // 预算耗尽：缺席槽
  });

  it("预算耗尽的 lazy 字段是缺席槽（不是 undefined 值槽）", () => {
    const entry = constraintToEntryAbs(astNode, "node");
    const l1 = slotsOf(entry);
    const l4 = slotsOf(slotsOf(slotsOf(l1.object!.value).object!.value).object!.value);
    for (const k of ["object", "property", "callee"]) {
      expect(l4[k]).toBeUndefined();
      expect(Object.hasOwn(l4, k)).toBe(false);
    }
    // 非 lazy 字段不受影响
    expect(Object.hasOwn(l4, "type")).toBe(true);
    // array 字段本身非 lazy：预算耗尽的是元素位 → arr(any)（值位预算语义）
    const args4 = l4.arguments!;
    expect(args4.optional).toBe(true);
    const elem = (args4.value.shape as { element: Abs }).element;
    expect(elem.shape.k).toBe("any");
  });

  it("值位（顶层/数组元素）预算耗尽 → any（保留参数项）", () => {
    const top = constraintToEntryAbs(lazy(() => astNode), "x", 0);
    expect(top.shape.k).toBe("any");
    const elem = constraintToEntryAbs(array(lazy(() => astNode)), "xs", 0);
    if (elem.shape.k !== "arr") throw new Error("expected arr");
    expect((elem.shape as { element: Abs }).element.shape.k).toBe("any");
  });

  it("instantiate：预算耗尽 → 恒真（宽松，不误报必选 lazy 字段）", () => {
    const c = lazy(() => shape({ id: number().gt(0) }));
    expect(instantiateConstraint(c, "u", 0)).toEqual({ op: "true" });
    expect(instantiateOnTerm(c, { op: "var", id: "u" }, 0)).toEqual({ op: "true" });
    // 预算内：正常展开字段谓词
    expect(instantiateConstraint(c, "u")).toEqual({
      op: "gt",
      a: { op: "app", fn: "get", args: [{ op: "var", id: "u" }, { op: "lit", value: "id" }] },
      b: { op: "lit", value: 0 },
    });
  });
});

describe("环终止（seen / 记忆化）", () => {
  it("constraintAdmitsNullish：环穿过 nullable → true（找到有限 nullish 位）", () => {
    const t = lazy(() => nullable(t));
    expect(constraintAdmitsNullish(t)).toBe(true);
  });

  it("constraintAdmitsNullish：纯 shape 环 → false（无 nullish 位）", () => {
    const s = lazy(() => shape({ child: s }));
    expect(constraintAdmitsNullish(s)).toBe(false);
  });

  it("constraintAdmitsNullish：lazy 包装不被误判成 any()（先 deref）", () => {
    expect(constraintAdmitsNullish(lazy(() => shape({ a: string() })))).toBe(false);
  });

  it("throwConstraintToKinds：union(lazy 自环, lit('Error')) 找到 'Error'", () => {
    const c = union(lazy(() => c), litC("Error"));
    expect(throwConstraintToKinds(c)).toContain("Error");
  });

  it("literalMeetsConstraint：lazy 环终止，字面量对 shape 域保守 false", () => {
    const t = lazy(() => nullable(t));
    expect(literalMeetsConstraint(null, t)).toBe(true);
    const s = lazy(() => shape({ child: s }));
    expect(literalMeetsConstraint("x", s)).toBe(false);
  });
});

describe("formatConstraint：两层 + 省略号", () => {
  it("递归模板渲染为 2 层展开 + `…`", () => {
    const t = shape({ type: string(), object: lazy(() => t).optional() });
    expect(formatConstraint(t)).toBe(
      "shape({ type: string(), object?: shape({ type: string(), object?: shape({ type: string(), object?: … }) }) })",
    );
  });

  it("issue #120 完整模板渲染包含 `…`（不无限展开）", () => {
    const s = formatConstraint(astNode);
    expect(s).toContain("…");
    expect(s).toContain("arguments?: array(");
  });
});

describe("组合子对 lazy 包装先解一层", () => {
  const leaf = shape({ id: number() });

  it("partial(lazy-wrapped shape)：字段全变可选", () => {
    const p = partial(lazy(() => leaf));
    expect(Object.keys(p.fields!).sort()).toEqual(["id"]);
    expect(p.fields!.id!.optional).toBe(true);
    expect(p.fields!.id!.constraint.isOptional).toBe(true);
  });

  it("pick / omit 同样穿透 lazy", () => {
    const t = lazy(() => shape({ a: number(), b: string() }));
    expect(Object.keys(pick(t, ["a"]).fields!)).toEqual(["a"]);
    expect(Object.keys(omit(t, ["a"]).fields!)).toEqual(["b"]);
  });

  it("andC(lazy(() => shape(...))) 与直接 shape 同样 throw", () => {
    expect(() => andC(lazy(() => leaf), number())).toThrow(/and\(\)/);
  });

  it("andC(lazy(() => 标量)) 正常合取", () => {
    const c = andC(number().gt(0), lazy(() => number().lt(10)));
    expect(c.preds).toHaveLength(2);
  });

  it("partial(lazy(() => 非shape)) 仍 throw", () => {
    expect(() => partial(lazy(() => number()))).toThrow(/partial\(\)/);
  });
});
