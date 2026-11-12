/**
 * `$copy` 快照语义（2026-11-13 叶子快路径）。
 *
 * `copyWithMemo` 现在**先判叶子形状**（prim / never / any / unknown）再查 memo：
 * 叶子不可变、从不 `memo.set`，因此二者等价，但省掉 71% 调用的 WeakMap 查询；
 * obj / fn 的槽循环也改为「叶子槽直接复用、非叶子才递归」并去掉
 * `Object.entries` 的数组分配（ABS-17 夹具 N=800：8523.79 → 3297ms）。
 *
 * 本文件钉住该优化依赖的三条不变量：
 * 1. 叶子共享：副本里的叶子槽与原件是**同一对象**（不可变，安全）；
 * 2. 非叶子独立：obj / fn / sum 等副本必须是新对象、新槽表（臂内写不污染原件）；
 * 3. 别名保持：同一次 `$copy` 里共享子图映射到同一个副本（memo 语义）。
 */
import { describe, it, expect } from "vitest";
import { $copy } from "../exec/runtime/containers/obj.ts";
import { abs, type Abs } from "../abs.ts";
import { objOf, setSlot, getSlot, type Slot } from "../objects.ts";

const num = (): Abs => abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
const str = (): Abs => abs({ k: "prim", type: "string" }, undefined, undefined, "exact");

function objAbs(slots: Record<string, Slot>): Abs {
  return objOf(slots);
}

describe("$copy 叶子共享与深度复制", () => {
  it("叶子形状原样返回（不可变、不进 memo）", () => {
    for (const shape of [
      { k: "prim", type: "number" },
      { k: "any" },
      { k: "unknown" },
      { k: "never" },
    ] as const) {
      const leaf = abs(shape, undefined, undefined, "exact");
      expect($copy(leaf)).toBe(leaf);
    }
  });

  it("obj 副本是新对象、新槽表，但叶子槽值共享", () => {
    const nx = num();
    const sy = str();
    const src = objAbs({ x: { value: nx }, y: { value: sy, optional: true } });
    const copied = $copy(src);

    expect(copied).not.toBe(src);
    expect(copied.shape).not.toBe(src.shape);
    const srcSlots = (src.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    const dstSlots = (copied.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    expect(dstSlots).not.toBe(srcSlots);

    // 叶子不可变 ⇒ 共享同一对象（优化点本身）
    expect(dstSlots.x!.value).toBe(nx);
    expect(dstSlots.y!.value).toBe(sy);
    // 槽标志随副本迁移
    expect(dstSlots.y!.optional).toBe(true);
    expect(dstSlots.x!.optional).toBeUndefined();
  });

  it("副本槽表可独立改写，不污染原件", () => {
    const nx = num();
    const src = objAbs({ x: { value: nx } });
    const copied = $copy(src);
    const dstSlots = (copied.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    setSlot(dstSlots, "x", { value: str() });
    setSlot(dstSlots, "added", { value: num() });

    const srcSlots = (src.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    expect(getSlot(srcSlots, "x")!.value).toBe(nx);
    expect(getSlot(srcSlots, "added")).toBeUndefined();
  });

  it("非叶子子图是新对象（臂内写不串味）", () => {
    const inner = objAbs({ v: { value: num() } });
    const src = objAbs({ child: { value: inner } });
    const copied = $copy(src);
    const dstSlots = (copied.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    expect(dstSlots.child!.value).not.toBe(inner);
    expect(
      (dstSlots.child!.value.shape as Extract<Abs["shape"], { k: "obj" }>).slots.v!.value,
    ).toBe((inner.shape as Extract<Abs["shape"], { k: "obj" }>).slots.v!.value);
  });

  it("同一次 $copy 内共享子图映射到同一副本（别名保持）", () => {
    const shared = objAbs({ v: { value: num() } });
    const src = objAbs({ a: { value: shared }, b: { value: shared } });
    const copied = $copy(src);
    const dstSlots = (copied.shape as Extract<Abs["shape"], { k: "obj" }>).slots;
    expect(dstSlots.a!.value).toBe(dstSlots.b!.value);
    expect(dstSlots.a!.value).not.toBe(shared);
  });

  it("非 Abs 宿主值原样返回（fail-closed）", () => {
    const host = { not: "an abs" };
    expect($copy(host as unknown as Abs)).toBe(host);
  });
});
