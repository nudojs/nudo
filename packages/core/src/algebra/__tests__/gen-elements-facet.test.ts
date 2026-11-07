/**
 * 「第三种」· core 侧回归钉：静态元素域 `AbsFacets.genElements`。
 *
 * 纪律（与 A2/A8/A10/A11 槽位同口径）：
 * - 真值来源是 `$gen` 的**完整 yield 序列**（`makeGenObject` 的 `full`），
 *   不是 `$arr(ys.els)` 之后可能被 widen 的 shape 数字下标槽（Bug 53）。
 * - 数字槽**仍然并存**（消费点 / 族 01 口径依赖它），本槽位不替换 shape。
 * - 数组做浅拷贝、Abs 元素按引用共享；`snapshotAbs` / `substAbs` /
 *   `renameAbs` / `join` 都经 `cloneAbsFacets`，副本不得共享同一数组。
 * - `facetKey` 必须逐项编 `absKey`，否则不同元素域的生成器共享 memo。
 * - 缺省（手工构造 / 静态收割 / 旧 Abs）⇒ 消费面严格 fallback。
 */
import { describe, it, expect } from "vitest";
import { abs, cloneAbsFacets, numLit, strLit, type Abs } from "../abs.ts";
import { snapshotAbs } from "../hof.ts";
import { absKey } from "../key/abs-key.ts";
import { joinAbs } from "../objects.ts";
import { call } from "./eval-helpers.ts";

/** 求值得到真实生成器对象 Abs（makeGenObject 生产路径，不是手工夹具）。 */
function realGen(): Abs {
  return call(
    `export function* g() { yield 1; yield "s"; }
export function f() { return g(); }`,
    "f",
  ).result as Abs;
}

function withElems(values: Abs[]): Abs {
  const a = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
  a.facets = { brand: "Generator", genElements: values };
  return a;
}

describe("AbsFacets.genElements — 生产路径与搬运", () => {
  it("$gen 挂的是完整 yield 序列，且 shape 数字槽仍并存", () => {
    const g = realGen();
    expect(g.facets?.genElements).toHaveLength(2);
    expect(g.facets?.genElements?.[0]?.term).toMatchObject({ op: "lit", value: 1 });
    expect(g.facets?.genElements?.[1]?.term).toMatchObject({ op: "lit", value: "s" });
    const slots = (g.shape as { k: "obj"; slots: Record<string, unknown> }).slots;
    expect(slots["0"]).toBeDefined();
  });

  it("snapshotAbs 副本带元素域：数组引用独立、Abs 元素按引用共享", () => {
    const g = realGen();
    const copy = snapshotAbs(g);
    expect(copy.facets?.genElements).toHaveLength(2);
    expect(copy.facets?.genElements).not.toBe(g.facets?.genElements);
    expect(copy.facets?.genElements?.[0]).toBe(g.facets?.genElements?.[0]);
  });

  it("cloneAbsFacets 拷贝数组：副本 push 不串回原对象", () => {
    const src = { brand: "Generator", genElements: [numLit(1)] };
    const copy = cloneAbsFacets(src)!;
    copy.genElements!.push(numLit(2));
    expect(src.genElements).toHaveLength(1);
    expect(copy.genElements).toHaveLength(2);
  });

  it("cloneAbsFacets 对无 genElements 的旧容器逐字不变", () => {
    const src = { brand: "Generator", genReturn: numLit(9) };
    const copy = cloneAbsFacets(src)!;
    expect(copy).toEqual(src);
    expect(copy.genElements).toBeUndefined();
  });
});

describe("AbsFacets.genElements — 缓存键与 join 保守性", () => {
  it("元素域不同 ⇒ absKey 不同（ge: 段逐项编结构键）", () => {
    const a = withElems([numLit(1)]);
    const b = withElems([numLit(2)]);
    expect(absKey(a)).toContain("ge:");
    expect(absKey(a)).not.toBe(absKey(b));
  });

  it("缺省 genElements 的旧键不含 ge: 段", () => {
    const a = abs({ k: "obj", slots: {} }, undefined, undefined, "exact");
    a.facets = { brand: "Generator" };
    expect(absKey(a)).not.toContain("ge:");
  });

  it("join 两侧元素域不同 ⇒ 不臆造统一的 facets（保守丢弃）", () => {
    const joined = joinAbs(withElems([numLit(1)]), withElems([strLit("s")]));
    expect(joined.facets?.genElements).toBeUndefined();
  });
});
