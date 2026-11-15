/**
 * ABS-09：递归类型 coinductive `leq`。
 *
 * 表示层（format / absKey）早已支持环；判定层此前在 depth>32 直接失败。
 * 现在用 (src,tgt) 路径假设做 coinduction：正在检查的对再次出现 = 假设
 * 成立（equirecursive subtyping 的最大不动点）。路径纪律保证失败分支的
 * 假设不泄漏（否则假绿）。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, str, type Abs } from "../abs.ts";
import { v } from "../term.ts";
import { leqAbs } from "../leq.ts";
import { formatShape } from "../format/format.ts";

/** null 字面量 Abs（shape unknown + term lit(null)，与引擎编码同款） */
function nullAbs(): Abs {
  return makeAbs({ k: "unknown" }, { op: "lit", value: null }, undefined, "exact");
}

/** 递归链表节点：{ value, next: Node | null } */
function linkedList(value: Abs): Abs {
  const node = makeAbs(
    { k: "obj", slots: {} as Record<string, { value: Abs; optional?: boolean }> },
    v("node"),
    undefined,
    "path",
  );
  const shape = node.shape as {
    k: "obj";
    slots: Record<string, { value: Abs; optional?: boolean }>;
  };
  shape.slots.value = { value };
  shape.slots.next = {
    value: makeAbs({ k: "sum", members: [node, nullAbs()] }, undefined, undefined, "path"),
  };
  return node;
}

/** 互递归：A = { b: B | null }，B = { a: A | null } */
function mutuallyRecursive(): { a: Abs; b: Abs } {
  const a = makeAbs(
    { k: "obj", slots: {} as Record<string, { value: Abs }> },
    v("a"),
    undefined,
    "path",
  );
  const b = makeAbs(
    { k: "obj", slots: {} as Record<string, { value: Abs }> },
    v("b"),
    undefined,
    "path",
  );
  (a.shape as { k: "obj"; slots: Record<string, { value: Abs }> }).slots.b = {
    value: makeAbs({ k: "sum", members: [b, nullAbs()] }, undefined, undefined, "path"),
  };
  (b.shape as { k: "obj"; slots: Record<string, { value: Abs }> }).slots.a = {
    value: makeAbs({ k: "sum", members: [a, nullAbs()] }, undefined, undefined, "path"),
  };
  return { a, b };
}

describe("ABS-09 递归类型判定不再深度失败", () => {
  it("同构但不同对象身份的递归链表 ⇒ leq 通过", () => {
    const a = linkedList(num());
    const b = linkedList(num());
    expect(a).not.toBe(b);
    const r = leqAbs(a, b);
    expect(r.ok).toBe(true);
    // 表示层仍可渲染环（不崩）
    expect(formatShape(a).length).toBeGreaterThan(0);
  });

  it("值域不匹配的递归链表 ⇒ 报出最短字段路径（不是 depth exceeded）", () => {
    const r = leqAbs(linkedList(num()), linkedList(str()));
    expect(r.ok).toBe(false);
    expect(r.reason ?? "").toContain("value");
    expect(r.reason ?? "").not.toContain("depth exceeded");
  });

  it("互递归 A/B 树（A→B→A）判定终止且通过", () => {
    const { a: a1, b: b1 } = mutuallyRecursive();
    const { a: a2 } = mutuallyRecursive();
    // 环确实存在：B 的 a 槽指向 A（同一对象身份）
    const bSlots = (b1.shape as { k: "obj"; slots: Record<string, { value: Abs }> }).slots;
    expect(bSlots.a!.value.shape.k).toBe("sum");
    const r = leqAbs(a1, a2);
    expect(r.ok).toBe(true);
  });

  it("递归 brand 内层同样 coinductive", () => {
    const a = linkedList(num());
    const b = linkedList(num());
    const ba = makeAbs({ k: "brand", name: "Node", shape: a }, undefined, undefined, "path");
    const bb = makeAbs({ k: "brand", name: "Node", shape: b }, undefined, undefined, "path");
    expect(leqAbs(ba, bb).ok).toBe(true);
    expect(leqAbs(ba, makeAbs({ k: "brand", name: "Other", shape: b }, undefined, undefined, "path")).ok).toBe(
      false,
    );
  });

  it("非递归但超深结构仍由 depth 兜底（有界终止）", () => {
    const deep = (n: number, leaf: Abs): Abs => {
      let cur = leaf;
      for (let i = 0; i < n; i++) {
        cur = makeAbs({ k: "obj", slots: { x: { value: cur } } }, undefined, undefined, "path");
      }
      return cur;
    };
    const r = leqAbs(deep(80, num()), deep(80, num()));
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("depth exceeded");
  });
});
