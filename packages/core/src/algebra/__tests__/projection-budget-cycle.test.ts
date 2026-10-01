/**
 * DESIGN-001：投影/格式化层的环与深度预算。
 *
 * 回归背景：Abs 是可计算值，shape 图可环（evaluator 对 `const a = {};
 * a.self = a` 产出真环——service 侧 e2e 已钉）可深（嵌套结构）。修复前
 * formatShape / absToString / denoteGuard / absToConstraint 对环直接
 * RangeError: Maximum call stack size exceeded，打崩 CLI/LSP 进程。
 *
 * 修复：core/src/algebra/projection-budget.ts 共享 ProjectionBudget
 * （路径记账 seen + maxDepth=64），截断渲染显式标记（…cycle / … /
 * /* nudo:truncated:* *\/ true）或走既有「不可表达」信号（undefined）。
 */
import { describe, it, expect } from "vitest";
import { abs as makeAbs, num, formatShape, absToString, shapeToString, absToConstraint } from "@nudojs/core";
import { denoteGuard } from "@nudojs/core/internal";
import { ProjectionBudget, PROJECTION_MAX_DEPTH } from "@nudojs/core/internal";
import type { Abs } from "@nudojs/core";

/** 直接构造环：a.shape.slots.self.value === a（与 evaluator 产出同构） */
function cyclicObjAbs(): Abs {
  const slots: Record<string, { value: Abs }> = {};
  const a = makeAbs({ k: "obj", slots }, undefined, undefined, "exact");
  slots.self = { value: a };
  return a;
}

function cyclicTupleAbs(): Abs {
  const elements: Abs[] = [];
  const a = makeAbs({ k: "tuple", elements }, undefined, undefined, "exact");
  elements.push(a);
  return a;
}

function cyclicArrAbs(): Abs {
  const a = makeAbs({ k: "arr", element: num() }, undefined, undefined, "exact");
  (a.shape as { element: Abs }).element = a;
  return a;
}

/** n 层嵌套 obj（无环） */
function deepObjAbs(depth: number): Abs {
  let a: Abs = num();
  for (let i = 0; i < depth; i++) {
    a = makeAbs({ k: "obj", slots: { v: { value: a } } }, undefined, undefined, "exact");
  }
  return a;
}

/** 同一子树挂在两个兄弟槽（DAG 共享，非环） */
function sharedSiblingAbs(): Abs {
  const shared = makeAbs({ k: "obj", slots: { n: { value: num() } } }, undefined, undefined, "exact");
  return makeAbs(
    { k: "obj", slots: { a: { value: shared }, b: { value: shared } } },
    undefined,
    undefined,
    "exact",
  );
}

describe("ProjectionBudget semantics", () => {
  it("path-based: sibling reuse is not a cycle, ancestor repetition is", () => {
    const b = new ProjectionBudget();
    const shared: object = {};
    expect(b.enter(shared)).toBeNull();
    b.exit();
    // 兄弟复用：不在当前路径上 → 不是环
    expect(b.enter(shared)).toBeNull();
    b.exit();
    // 祖先重复 → cycle
    expect(b.enter(shared)).toBeNull();
    expect(b.enter(shared)).toBe("cycle");
    b.exit();
    expect(b.truncated).toBe("cycle");
  });

  it("maxDepth caps the path length", () => {
    const b = new ProjectionBudget(2);
    expect(b.enter({})).toBeNull();
    expect(b.enter({})).toBeNull();
    expect(b.enter({})).toBe("depth");
    b.exit();
    b.exit();
    // 离开后路径恢复，可再次进入
    expect(b.enter({})).toBeNull();
    expect(b.truncated).toBe("depth");
  });

  it("PROJECTION_MAX_DEPTH is 64 (2× the case-arg parse cap 32, BUG-014)", () => {
    expect(PROJECTION_MAX_DEPTH).toBe(64);
  });
});

describe("formatShape: cyclic / deep Abs (DESIGN-001)", () => {
  it("cyclic obj renders an explicit cycle marker instead of RangeError", () => {
    const out = formatShape(cyclicObjAbs());
    expect(out).toBe("{ self: …cycle }");
  });

  it("cyclic tuple / arr do not crash", () => {
    expect(typeof formatShape(cyclicTupleAbs())).toBe("string");
    expect(typeof formatShape(cyclicArrAbs())).toBe("string");
  });

  it("deep-but-acyclic (200 levels) truncates with an explicit marker", () => {
    const out = formatShape(deepObjAbs(200));
    expect(out).toContain("…");
    // 深度截断标记与环标记可区分
    expect(out).not.toContain("…cycle");
    // 输出有界：截断后不再展开剩余 130+ 层
    expect(out.length).toBeLessThan(600);
  });

  it("depth below the budget renders fully (64 levels inside the cap)", () => {
    const out = formatShape(deepObjAbs(60));
    expect(out).not.toContain("…");
    expect(out).toContain("number");
  });

  it("DAG-shared subtree renders in both siblings (no false cycle)", () => {
    const out = formatShape(sharedSiblingAbs());
    expect(out).toBe("{ a: { n: number }, b: { n: number } }");
  });
});

describe("absToString / shapeToString: cyclic Abs (DESIGN-001)", () => {
  it("cyclic obj renders truncation marker", () => {
    const out = absToString(cyclicObjAbs());
    expect(out).toContain("…cycle");
  });

  it("cyclic arr shape truncates at the shape level", () => {
    const out = shapeToString(cyclicArrAbs().shape);
    expect(out).toContain("…");
  });
});

describe("denoteGuard: cyclic / deep Abs (DESIGN-001)", () => {
  it("cyclic obj guard is valid JS with an explicit truncation comment", () => {
    const g = denoteGuard(cyclicObjAbs(), "data");
    expect(g).toContain("/* nudo:truncated:cycle */ true");
    expect(() => new Function("data", `return ${g};`)).not.toThrow();
  });

  it("deep-but-acyclic guard is valid JS with a depth comment", () => {
    const g = denoteGuard(deepObjAbs(200), "data");
    expect(g).toContain("/* nudo:truncated:depth */ true");
    expect(() => new Function("data", `return ${g};`)).not.toThrow();
  });

  it("truncated guard stays permissive (does not lie) for structurally-invalid values", () => {
    const g = denoteGuard(cyclicObjAbs(), "data");
    const check = new Function("data", `return ${g};`) as (d: unknown) => boolean;
    // typeof 检查仍在；被截断的 self 子树不再检查（保守 = 不撒谎）
    expect(check({ self: {} })).toBe(true);
    expect(check(42)).toBe(false);
  });
});

describe("absToConstraint: cyclic / deep Abs (DESIGN-001)", () => {
  it("cyclic obj returns undefined (not projectable), no crash", () => {
    expect(absToConstraint(cyclicObjAbs())).toBeUndefined();
  });

  it("deep-but-acyclic beyond the budget returns undefined, shallow still projects", () => {
    expect(absToConstraint(deepObjAbs(100))).toBeUndefined();
    expect(absToConstraint(deepObjAbs(8))).toBeDefined();
  });
});
