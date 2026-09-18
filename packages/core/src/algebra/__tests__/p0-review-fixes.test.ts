import { describe, it, expect } from "vitest";
import { $orDefault, makeSetAbs, setAddEntry, setDeleteEntry, setHasEntry, $fork, abs, joinAbs, numLit, undefAbs, formatAbs } from "@nudojs/core";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" } as never, undefined, undefined, "path" as never);
}

function n(v: number) {
  return numLit(v);
}

describe("P0 soundness pins", () => {
  it("Set cross-arm delete different keys → has not exact", () => {
    const s = makeSetAbs();
    setAddEntry(s, n(1));
    setAddEntry(s, n(2));
    $fork(abstractBool(), () => {
      setDeleteEntry(s, n(1));
      return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
    }, () => {
      setDeleteEntry(s, n(2));
      return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
    });
    expect(setHasEntry(s, n(1)).conf).not.toBe("exact");
    expect(setHasEntry(s, n(2)).conf).not.toBe("exact");
  });

  it("$orDefault on undefined|5 joins default into domain", () => {
    const sum = joinAbs(undefAbs(), n(5));
    const got = $orDefault(sum, () => n(10));
    const s = formatAbs(got);
    expect(s).toContain("10");
    expect(s).toContain("5");
    expect(s.includes("undefined")).toBe(false);
  });
});
