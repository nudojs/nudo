/**
 * absShapeKey 哨兵键：lit(null) / lit(undefined) / 真 unknown 必须可区分。
 * 回归背景：unknown 形状分支只特判 lit(undefined)，lit(null) 与无 term 的
 * 真 unknown 同键 "unknown"，flattenSum 去重把 `null | unknown` 塌成 `null`，
 * 且 join 顺序改变结论（join(null, unknown) vs join(unknown, null)）。
 */
import { describe, it, expect } from "vitest";
import {
  abs,
  absShapeKey,
  joinAbs,
  joinValues,
  lit,
  makeSum,
  unknown,
  numLit,
} from "../index.ts";

function nullLit() {
  return abs({ k: "unknown" }, lit(null), undefined, "exact");
}
function undefLit() {
  return abs({ k: "unknown" }, lit(undefined), undefined, "exact");
}

describe("absShapeKey: null / undefined / true unknown", () => {
  it("lit(null) does not collide with true unknown", () => {
    expect(absShapeKey(nullLit())).not.toBe(absShapeKey(unknown));
  });

  it("lit(undefined) does not collide with true unknown", () => {
    expect(absShapeKey(undefLit())).not.toBe(absShapeKey(unknown));
  });

  it("lit(null) does not collide with lit(undefined)", () => {
    expect(absShapeKey(nullLit())).not.toBe(absShapeKey(undefLit()));
  });

  it("null | undefined | unknown keys are pairwise distinct", () => {
    const keys = [absShapeKey(nullLit()), absShapeKey(undefLit()), absShapeKey(unknown)];
    expect(new Set(keys).size).toBe(3);
  });

  it("identical lits still share a key (dedup preserved)", () => {
    expect(absShapeKey(nullLit())).toBe(absShapeKey(nullLit()));
    expect(absShapeKey(undefLit())).toBe(absShapeKey(undefLit()));
  });
});

describe("joinValues / makeSum: null vs unknown", () => {
  it("join(null, unknown) stays a sum, not lit(null)", () => {
    const j = joinValues(nullLit(), unknown);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      const members = j.shape.members;
      expect(members).toHaveLength(2);
      expect(members.some((m) => m.term?.op === "lit" && m.term.value === null)).toBe(true);
      expect(members.some((m) => !m.term)).toBe(true);
    }
  });

  it("join(unknown, null) is also a sum (order-stable)", () => {
    const j = joinValues(unknown, nullLit());
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      expect(j.shape.members).toHaveLength(2);
    }
  });

  it("join(null, undefined) stays a sum", () => {
    const j = joinValues(nullLit(), undefLit());
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      expect(j.shape.members).toHaveLength(2);
    }
  });

  it("null | undefined | unknown keeps three members", () => {
    const j = makeSum(makeSum(nullLit(), undefLit()), unknown);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      expect(j.shape.members).toHaveLength(3);
    }
  });

  it("joinAbs (control-flow path) does not collapse null into unknown", () => {
    const j = joinAbs(nullLit(), unknown);
    expect(j.shape.k).toBe("sum");
    expect(joinAbs(unknown, nullLit()).shape.k).toBe("sum");
    expect(joinAbs(nullLit(), undefLit()).shape.k).toBe("sum");
  });

  it("join(null, null) still folds to a single lit(null)", () => {
    const j = joinValues(nullLit(), nullLit());
    expect(j.shape.k).toBe("unknown");
    expect(j.term?.op === "lit" && j.term.value === null).toBe(true);
  });

  it("join(unknown, unknown) still folds to bare unknown", () => {
    const j = joinValues(unknown, unknown);
    expect(j.shape.k).toBe("unknown");
    expect(j.term).toBeUndefined();
  });

  it("join(null, numLit) is a sum (cross-kind)", () => {
    const j = joinValues(nullLit(), numLit(1));
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      expect(j.shape.members).toHaveLength(2);
    }
  });
});

describe("absShapeKey: non-lit term on unknown shape", () => {
  it("unknown with var term does not collide with true unknown", () => {
    const withTerm = abs({ k: "unknown" }, { op: "var", id: "A1" }, undefined, "path");
    expect(absShapeKey(withTerm)).not.toBe(absShapeKey(unknown));
  });

  it("unknown with different app terms do not collapse in makeSum", () => {
    const t1 = abs(
      { k: "unknown" },
      { op: "app", fn: "+", args: [{ op: "var", id: "A1" }, lit(1)] },
      undefined,
      "partial",
    );
    const t2 = abs(
      { k: "unknown" },
      { op: "app", fn: "*", args: [{ op: "var", id: "B2" }, lit(2)] },
      undefined,
      "partial",
    );
    expect(absShapeKey(t1)).not.toBe(absShapeKey(t2));
    const j = makeSum(t1, t2);
    expect(j.shape.k).toBe("sum");
    if (j.shape.k === "sum") {
      expect(j.shape.members).toHaveLength(2);
    }
  });
});
