/**
 * 函数 expando 的 join / 去重 / 快照回归。
 *
 * 修复前：
 * - `joinFunctions` 对同名同参直接返回 `a`，忽略 expando `slots` /
 *   optionalParams / ctor ⇒ 分支两侧不同的 `g.x` 折成单个 exact 值；
 * - `absShapeKey` 的 fn 分支同样忽略这些字段 ⇒ `flattenSum` 去重会把
 *   两个不同的函数值塌缩成一个；
 * - `$copy` 对 fn 形状直接返回原 Abs（fork 两臂共享同一槽面）⇒ 兄弟臂的
 *   `g.x = …` 互相覆盖（`if (cond) { g.x = 1 } else { g.x = 2 }` → 2 #exact）。
 * - `flattenSum` 按结构键去重，而 fn 结构键不含**实现身份** ⇒ 两个不同
 *   函数体（匿名箭头 / 同名同参函数）被塌缩成一个
 *   （`cond ? (() => 1) : (() => 2)` 调用折 1 #exact）。makeSum 去重键
 *   现附加 per-process impl 身份（WeakMap id）；`joinFunctions` 的同名
 *   同参早退同样要求 impl 相同。
 */
import { describe, it, expect } from "vitest";
import { abs, litValue, numLit, strLit, unknown, type Abs } from "../abs.ts";
import { absFunction, absOnly, getFnImpl } from "../abs-fn.ts";
import { absShapeKey, joinAbs, makeSum } from "../objects.ts";
import { $copy } from "../exec/runtime/containers/obj.ts";
import { $get, $set } from "../exec/runtime/containers/member.ts";
import { call } from "./eval-helpers.ts";

/** 结果里的字面量成员（sum 逐成员；非字面量记 "<nonlit>"） */
function litMembers(r: Abs): unknown[] {
  const members = r.shape.k === "sum" ? r.shape.members : [r];
  return members.map((m) => {
    const v = litValue(m);
    return v.ok ? v.value : "<nonlit>";
  });
}

describe("branch-dependent function expando", () => {
  it("if/else 两臂各写不同 expando → 结果包含 1 和 2（不是 2 #exact）", () => {
    const r = call(
      `export function f(cond) {
        const g = () => 1;
        if (cond) { g.x = 1; } else { g.x = 2; }
        return g.x;
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
    // 不得折成单值
    expect(lits.length).toBeGreaterThan(1);
  });

  it("分支产生不同函数值（同名同参、不同槽）→ join 后包含 1 和 2", () => {
    const r = call(
      `export function f(cond) {
        const mk = (v) => { const g = () => 1; g.x = v; return g; };
        return (cond ? mk(1) : mk(2)).x;
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
    expect(lits.length).toBeGreaterThan(1);
  });

  it("两个匿名箭头（不同函数体、同 shape）经条件选择 → 调用结果 1 | 2", () => {
    const r = call(
      `export function f(cond) {
        const a = () => 1;
        const b = () => 2;
        const g = cond ? a : b;
        return g();
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
    expect(lits.length).toBeGreaterThan(1);
  });

  it("两个匿名函数表达式经条件选择 → 调用结果 1 | 2", () => {
    const r = call(
      `export function f(cond) {
        const a = function () { return 1; };
        const b = function () { return 2; };
        const g = cond ? a : b;
        return g();
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
  });

  it("条件表达式内联两个箭头 → 调用结果 1 | 2", () => {
    const r = call(
      `export function f(cond) {
        const g = cond ? (() => 1) : (() => 2);
        return g();
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
  });

  it("嵌套 expando 槽里的不同函数体（命名箭头）→ 1 | 2", () => {
    const r = call(
      `export function f(cond) {
        const g = () => 1;
        if (cond) { g.x = () => 1; } else { g.x = () => 2; }
        return g.x();
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
    expect(lits.length).toBeGreaterThan(1);
  });

  it("嵌套 expando 槽里的不同函数体（匿名函数表达式）→ 1 | 2", () => {
    const r = call(
      `export function f(cond) {
        const g = () => 1;
        if (cond) { g.x = function () { return 1; }; } else { g.x = function () { return 2; }; }
        return g.x();
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
  });

  it("已写过的 expando 在 fork 臂内继续可写（副本槽面所有权迁移）", () => {
    const r = call(
      `export function f(cond) {
        const g = () => 1;
        g.x = 0;
        if (cond) { g.x = 1; } else { g.x = 2; }
        return g.x;
      }`,
      "f",
      [unknown],
    );
    const lits = litMembers(r.result);
    expect(lits).toContain(1);
    expect(lits).toContain(2);
    expect(lits).not.toContain(0);
  });
});

describe("joinFunctions 元数据感知", () => {
  const fn = (slots?: Record<string, { value: Abs; optional?: boolean; readonly?: boolean }>): Abs =>
    abs(
      { k: "fn", params: ["a"], name: "g", ...(slots ? { slots } : {}) },
      undefined,
      undefined,
      "exact",
    );

  it("同名同参同槽 → 折叠为同一值（a）", () => {
    const a = fn({ x: { value: numLit(1) } });
    const b = fn({ x: { value: numLit(1) } });
    expect(joinAbs(a, b)).toBe(a);
  });

  it("同名同参不同槽 → sum（保留两个成员）", () => {
    const a = fn({ x: { value: numLit(1) } });
    const b = fn({ x: { value: numLit(2) } });
    const j = joinAbs(a, b);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") expect(j.shape.members).toHaveLength(2);
  });

  it("槽存在性不同（一边有 expando）→ sum", () => {
    const a = fn({ x: { value: numLit(1) } });
    const b = fn();
    expect(joinAbs(a, b).shape.k).toBe("sum");
  });

  it("optionalParams / ctor 不同 → sum", () => {
    const a = abs(
      { k: "fn", params: ["a"], name: "g", optionalParams: [true], ctor: false },
      undefined,
      undefined,
      "exact",
    );
    const b = abs(
      { k: "fn", params: ["a"], name: "g", optionalParams: [false], ctor: false },
      undefined,
      undefined,
      "exact",
    );
    const c = abs(
      { k: "fn", params: ["a"], name: "g", optionalParams: [true], ctor: true },
      undefined,
      undefined,
      "exact",
    );
    expect(joinAbs(a, b).shape.k).toBe("sum");
    expect(joinAbs(a, c).shape.k).toBe("sum");
  });

  it("同名同参但函数体不同（impl 不同）→ sum（不是 a）", () => {
    const a = absFunction([], { apply: () => numLit(1) }, { name: "g" });
    const b = absFunction([], { apply: () => numLit(2) }, { name: "g" });
    const j = joinAbs(a, b);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") expect(j.shape.members).toHaveLength(2);
  });

  it("同名同参且同一 impl（$copy 副本）→ 折叠为 a", () => {
    const a = absFunction([], { apply: () => numLit(1) }, { name: "g" });
    const c = $copy(a);
    expect(joinAbs(a, c)).toBe(a);
  });
});

describe("absShapeKey / flattenSum 去重保留函数元数据", () => {
  const named = (extra: Record<string, unknown>): Abs =>
    abs({ k: "fn", params: ["a"], name: "g", ...extra } as never, undefined, undefined, "exact");

  it("同名同参但 slots 不同 → key 不同（去重不得塌缩）", () => {
    const a = named({ slots: { x: { value: numLit(1) } } });
    const b = named({ slots: { x: { value: numLit(2) } } });
    expect(absShapeKey(a)).not.toBe(absShapeKey(b));
    const s = makeSum(a, b);
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);
  });

  it("slots 一致 → key 一致（仍可去重）", () => {
    expect(absShapeKey(named({ slots: { x: { value: numLit(1) } } }))).toBe(
      absShapeKey(named({ slots: { x: { value: numLit(1) } } })),
    );
  });

  it("optionalParams / ctor 进 key", () => {
    expect(absShapeKey(named({ optionalParams: [true] }))).not.toBe(
      absShapeKey(named({ optionalParams: [false] })),
    );
    expect(absShapeKey(named({ ctor: true }))).not.toBe(absShapeKey(named({ ctor: false })));
  });

  it("不同函数体（impl）→ makeSum 不得去重；$copy 副本（同 impl）→ 可去重", () => {
    const a = absFunction([], { apply: () => numLit(1) });
    const b = absFunction([], { apply: () => numLit(2) });
    // absShapeKey 保持纯结构契约（env-loader 的声明去重依赖）；去重键在
    // makeSum 内部额外带实现身份。
    const s = makeSum(a, b);
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);
    // 同一 impl 的快照副本代表同一函数值 → 去重为单成员
    const copy = makeSum(a, $copy(a));
    expect(copy).toBe(a);

    const n1 = absFunction([], { apply: () => numLit(1) }, { name: "g" });
    const n2 = absFunction([], { apply: () => numLit(2) }, { name: "g" });
    expect(joinAbs(n1, n2).shape.k).toBe("sum");
    const ns = makeSum(n1, n2);
    if (ns.shape.k === "sum") expect(ns.shape.members).toHaveLength(2);
  });

  it("嵌套 fn 槽 / paramTypes / returnType 的实现身份递归进去重键", () => {
    const nested = (body: number): Abs =>
      abs(
        { k: "fn", params: [], slots: { x: { value: absFunction([], { apply: () => numLit(body) }) } } },
        undefined,
        undefined,
        "exact",
      );
    const s = makeSum(nested(1), nested(2));
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);

    // paramTypes / returnType 内的函数值同样要区分
    const withParam = (body: number): Abs =>
      abs(
        {
          k: "fn",
          params: ["cb"],
          paramTypes: [absFunction([], { apply: () => numLit(body) })],
        },
        undefined,
        undefined,
        "exact",
      );
    const p = makeSum(withParam(1), withParam(2));
    expect(p.shape.k).toBe("sum");
    if (p.shape.k === "sum") expect(p.shape.members).toHaveLength(2);
  });

  it("同结构不同 conf → makeSum 不去重", () => {
    const mk = (conf: "exact" | "path"): Abs =>
      abs({ k: "obj", slots: { x: { value: numLit(1) } } }, undefined, undefined, conf);
    const s = makeSum(mk("exact"), mk("path"));
    expect(s.shape.k).toBe("sum");
    if (s.shape.k === "sum") expect(s.shape.members).toHaveLength(2);
  });
});

describe("$copy 函数快照", () => {
  it("fn Abs 副本身份/形状/槽面独立（term/pred/conf 随迁）", () => {
    const term = { op: "lit", value: 1 } as const;
    const paramObj = abs(
      { k: "obj", slots: { n: { value: numLit(1) } } },
      undefined,
      undefined,
      "exact",
    );
    const f = abs(
      {
        k: "fn",
        params: ["a"],
        name: "g",
        paramTypes: [paramObj],
        returnType: strLit("x"),
        optionalParams: [true],
        ctor: false,
        slots: { x: { value: numLit(1) }, y: { value: numLit(2), readonly: true } },
      },
      term,
      undefined,
      "path",
    );
    const c = $copy(f);
    expect(c).not.toBe(f);
    expect(c.shape).not.toBe(f.shape);
    expect(c.term).toBe(term);
    expect(c.pred).toBe(f.pred);
    expect(c.conf).toBe("path");
    if (c.shape.k !== "fn") throw new Error("expected fn");
    expect(c.shape.name).toBe("g");
    expect(c.shape.optionalParams).toEqual([true]);
    expect(c.shape.ctor).toBe(false);
    // 容器形 Abs 深拷（prim 本身不可变、可共享）
    expect(c.shape.paramTypes?.[0]).not.toBe(paramObj);
    expect(litValue(c.shape.returnType!)).toEqual({ ok: true, value: "x" });
    expect(c.shape.slots).not.toBe((f.shape as { slots: object }).slots);
    expect(c.shape.slots?.y?.readonly).toBe(true);
  });

  it("impl 随副本迁移（副本仍可调用）", () => {
    const f = absFunction([], { apply: () => numLit(7) });
    const c = $copy(f);
    expect(getFnImpl(c)?.apply).toBeTypeOf("function");
    const r = getFnImpl(c)!.apply!([], undefined);
    expect(litValue(absOnly(r))).toEqual({ ok: true, value: 7 });
  });

  it("expando 槽面副本可继续写，且与源隔离", () => {
    const f = abs({ k: "fn", params: [] }, undefined, undefined, "exact");
    $set(f, "x", numLit(1)); // 建槽（userFnSlots 标记）
    const c = $copy(f);
    $set(c, "x", numLit(2));
    expect(litValue($get(c, "x"))).toEqual({ ok: true, value: 2 });
    expect(litValue($get(f, "x"))).toEqual({ ok: true, value: 1 });
  });
});
