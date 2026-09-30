/**
 * DEC-006 回归：空 sum 成员 join 无单位元——不得对可能空的 Abs 集合裸 reduce。
 *
 * 修复前：$idx / $objRest / $arrRest / $forInKeys / $get / $in / $delRes 的
 * sum 分发路径对 `members: []` 直接 `.reduce(...)`，抛宿主
 * `TypeError: Reduce of empty array with no initial value`（非 NudoThrow）。
 * $concat 的 sideEl（空 Set/Map/match-iter 展开）同样裸 reduce。
 */
import { describe, it, expect } from "vitest";
import { $idx, $objRest, $arrRest, $forInKeys, $get, $concat } from "../exec/runtime/containers.ts";
import { $in, $delRes } from "../exec/runtime/members.ts";
import { abs, numLit, strLit, type Abs } from "../abs.ts";

const emptySum: Abs = { shape: { k: "sum", members: [] }, conf: "exact" };

/** 无表 Set brand：setElementsAbs → []（expand 返回空数组） */
const emptySet: Abs = abs(
  { k: "brand", name: "Set", shape: abs({ k: "obj", slots: {} }, undefined, undefined, "exact") },
  undefined,
  undefined,
  "exact",
);

function expectNoHostThrow(fn: () => unknown): void {
  expect(fn).not.toThrow();
}

describe("empty sum: no bare reduce on members (DEC-006)", () => {
  it("$idx does not throw on empty sum", () => {
    expectNoHostThrow(() => $idx(emptySum, numLit(0)));
    expectNoHostThrow(() => $idx(emptySum, strLit("a")));
    expect($idx(emptySum, numLit(0)).shape.k).toBe("unknown");
  });

  it("$objRest does not throw on empty sum", () => {
    expectNoHostThrow(() => $objRest(emptySum, ["a"]));
    expect($objRest(emptySum, ["a"]).shape.k).toBe("unknown");
  });

  it("$arrRest does not throw on empty sum", () => {
    expectNoHostThrow(() => $arrRest(emptySum, 0));
    expect($arrRest(emptySum, 0).shape.k).toBe("unknown");
  });

  it("$forInKeys does not throw on empty sum", () => {
    expectNoHostThrow(() => $forInKeys(emptySum));
    expect($forInKeys(emptySum).shape.k).toBe("unknown");
  });

  it("$get does not throw on empty sum", () => {
    expectNoHostThrow(() => $get(emptySum, "a", { silent: true }));
    expect($get(emptySum, "a", { silent: true }).shape.k).toBe("unknown");
  });

  it("$in does not throw on empty sum", () => {
    expectNoHostThrow(() => $in(strLit("a"), emptySum));
    expect($in(strLit("a"), emptySum).shape.k).toBe("unknown");
  });

  it("$delRes does not throw on empty sum", () => {
    expectNoHostThrow(() => $delRes(emptySum, strLit("a")));
    expect($delRes(emptySum, strLit("a")).shape.k).toBe("unknown");
  });

  it("$concat sideEl does not throw on empty Set spread", () => {
    // 双侧皆非 tuple → sideEl(a, ae)/sideEl(b, expand(b))；
    // 空 Set expand() 返回 []，sideEl 不得裸 reduce
    expectNoHostThrow(() => $concat(emptySet, emptySet));
    const r = $concat(emptySet, emptySet);
    expect(r.shape.k).toBe("arr");
  });

  it("non-empty sum still joins members", () => {
    const sum: Abs = {
      shape: { k: "sum", members: [numLit(1), numLit(2)] },
      conf: "exact",
    };
    const r = $idx(sum, numLit(0));
    // 成员均为非容器 → unknown；join 后仍 Abs，不抛
    expect(r).toBeDefined();
    expect(typeof r.shape.k).toBe("string");
  });
});
