import { describe, it, expect } from "vitest";
import {
  $fork,
  abs,
  makeMapAbs,
  mapSetEntry,
  mapDeleteEntry,
  mapGetEntry,
  mapHasEntry,
  formatAbs,
  litValue,
  strLit,
  numLit,
  unknown,
} from "@nudojs/core";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" });
}

describe("P0 Map fork merge preserves maybeAbsent", () => {
  it("unknown-key delete on one arm → get/has stay non-exact after merge", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    const after = $fork(abstractBool(), () => {
      // k 抽象 → 可能删掉 a
      mapDeleteEntry(m, unknown);
      return m;
    }, () => m);
    const v = mapGetEntry(after, strLit("a"));
    const lv = litValue(v);
    // 真实域：1 | undefined — 不得折成精确 1
    expect(lv).not.toBe(1);
    expect(formatAbs(v)).toMatch(/undefined|unknown|\|/);
    const has = mapHasEntry(after, strLit("a"));
    expect(litValue(has)).not.toBe(true);
  });

  it("literal delete on one arm still marks maybeAbsent via key count", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    mapSetEntry(m, strLit("b"), numLit(2));
    const after = $fork(abstractBool(), () => {
      mapDeleteEntry(m, strLit("a"));
      return m;
    }, () => m);
    const v = mapGetEntry(after, strLit("a"));
    expect(litValue(v)).not.toBe(1);
  });
});
