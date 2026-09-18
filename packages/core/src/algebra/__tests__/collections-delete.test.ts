import { describe, it, expect } from "vitest";
import { makeMapAbs, makeSetAbs, mapSetEntry, mapGetEntry, mapHasEntry, mapDeleteEntry, mapClearEntries, setAddEntry, setHasEntry, setDeleteEntry, setClearEntries, mapSizeAbs, setSizeAbs, $lit, $fork, abs, formatAbs, litValue, strLit, numLit } from "@nudojs/core";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" } as never, undefined, undefined, "path" as never);
}

function unk() {
  return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
}

describe("Map/Set delete/clear unit (collections API)", () => {
  it("mapDeleteEntry lit key removes entry; get is undefined", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("k"), numLit(1));
    mapDeleteEntry(m, strLit("k"));
    const s = formatAbs(mapGetEntry(m, strLit("k")));
    expect(s).toContain("undefined");
    expect(s).not.toContain("1");
  });

  it("mapClearEntries empties size", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    mapClearEntries(m);
    expect(litValue(mapSizeAbs(m))).toBe(0);
  });

  it("setDeleteEntry lit removes membership exactly", () => {
    const s = makeSetAbs();
    setAddEntry(s, numLit(1));
    setDeleteEntry(s, numLit(1));
    expect(litValue(setHasEntry(s, numLit(1)))).toBe(false);
  });

  it("setClearEntries empties set", () => {
    const s = makeSetAbs();
    setAddEntry(s, numLit(2));
    setClearEntries(s);
    expect(litValue(setHasEntry(s, numLit(2)))).toBe(false);
  });

  it("abstract if + map.delete: get joins value|undefined", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("k"), numLit(99));
    $fork(abstractBool(), () => {
      mapDeleteEntry(m, strLit("k"));
      return unk();
    }, () => unk());
    const s = formatAbs(mapGetEntry(m, strLit("k")));
    expect(s).toContain("undefined");
    // true 臂删除后 false 臂仍可能有值：join 应含 99
    expect(s).toContain("99");
  });

  it("abstract if + map.clear: size not exact", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    $fork(abstractBool(), () => {
      mapClearEntries(m);
      return unk();
    }, () => unk());
    expect(mapSizeAbs(m).conf).not.toBe("exact");
  });

  it("abstract if + set.delete: has not exact true", () => {
    const s = makeSetAbs();
    setAddEntry(s, numLit(1));
    $fork(abstractBool(), () => {
      setDeleteEntry(s, numLit(1));
      return unk();
    }, () => unk());
    const has = setHasEntry(s, numLit(1));
    expect(has.conf).not.toBe("exact");
  });

  it("nested fork map write is visible to inner read from outer arm", () => {
    const m = makeMapAbs();
    $fork(abstractBool(), () => {
      // outer true arm writes x
      mapSetEntry(m, strLit("x"), numLit(1));
      // nested fork read of outer-arm write
      const seen = $fork(abstractBool(), () => {
        return mapGetEntry(m, strLit("x"));
      }, () => mapGetEntry(m, strLit("x")));
      const s = formatAbs(seen);
      expect(s).toContain("1");
      return unk();
    }, () => unk());
  });
});
