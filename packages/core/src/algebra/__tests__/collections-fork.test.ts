import { describe, it, expect, afterEach } from "vitest";
import {
  makeMapAbs,
  makeSetAbs,
  mapSetEntry,
  mapGetEntry,
  mapHasEntry,
  mapSizeAbs,
  setAddEntry,
  setHasEntry,
  setSizeAbs,
  $lit,
  $fork,
  abs,
  formatAbs,
  litValue,
  strLit,
  numLit,
} from "@nudojs/core";
import { clearCollectionTables } from "@nudojs/core";

function abstractBool() {
  return abs({ k: "prim", type: "boolean" } as never, undefined, undefined, "path" as never);
}

afterEach(() => {
  clearCollectionTables();
});

describe("Map table fork isolation", () => {
  it("true-arm set does not pollute false-arm get after abstract if", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    const flag = abstractBool();
    $fork(
      flag,
      () => {
        mapSetEntry(m, strLit("b"), numLit(99));
        return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
      },
      () => abs({ k: "unknown" } as never, undefined, undefined, "exact" as never),
    );
    const got = mapGetEntry(m, strLit("b"));
    const s = formatAbs(got);
    // 应为 99|undefined（true 臂写入 + false 臂未写），不能是纯 99 也不能丢 99
    expect(s).not.toBe("99");
    expect(s.includes("undefined") || s.includes("unknown")).toBe(true);
    expect(s.includes("99")).toBe(true);
  });

  it("nested fork merge does not leak to outer sibling arm", () => {
    const m = makeMapAbs();
    const flag = abstractBool();
    $fork(
      flag,
      () => {
        // outer true arm: nested abstract if writes x
        $fork(
          flag,
          () => {
            mapSetEntry(m, strLit("x"), numLit(1));
            return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
          },
          () => {
            mapSetEntry(m, strLit("x"), numLit(2));
            return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
          },
        );
        return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
      },
      () => abs({ k: "unknown" } as never, undefined, undefined, "exact" as never),
    );
    // outer merge: x may be 1|2|undefined — 不能是 exact 且不能只有 undefined
    const got = mapGetEntry(m, strLit("x"));
    const s = formatAbs(got);
    expect(s.includes("undefined") || s.includes("unknown")).toBe(true);
  });

  it("map size after one-arm set is not exact", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    const flag = abstractBool();
    $fork(
      flag,
      () => {
        mapSetEntry(m, strLit("b"), numLit(2));
        return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
      },
      () => abs({ k: "unknown" } as never, undefined, undefined, "exact" as never),
    );
    const size = mapSizeAbs(m);
    expect(size.conf).not.toBe("exact");
  });

  it("map get with shadow key joins shadow values", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    // unknown key write → shadow
    mapSetEntry(m, abs({ k: "unknown" } as never, undefined, undefined, "path" as never), strLit("s"));
    const got = mapGetEntry(m, strLit("a"));
    const s = formatAbs(got);
    expect(s.includes("1")).toBe(true);
    expect(s.includes("s") || s.includes("string")).toBe(true);
  });

  it("map has exact false only when no shadow and key miss", () => {
    const m = makeMapAbs();
    mapSetEntry(m, strLit("a"), numLit(1));
    const hit = mapHasEntry(m, strLit("a"));
    expect(hit.conf).toBe("exact");
    expect(litValue(hit)).toBe(true);
    const miss = mapHasEntry(m, strLit("z"));
    expect(miss.conf).toBe("exact");
    expect(litValue(miss)).toBe(false);
  });
});

describe("Set fork soundness", () => {
  it("Set.has is partial when maybeAbsent after one-arm add", () => {
    const s = makeSetAbs();
    const flag = abstractBool();
    $fork(
      flag,
      () => {
        setAddEntry(s, numLit(1));
        return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
      },
      () => abs({ k: "unknown" } as never, undefined, undefined, "exact" as never),
    );
    const has = setHasEntry(s, numLit(1));
    expect(has.conf).not.toBe("exact");
  });

  it("Set size after fork is not exact", () => {
    const s = makeSetAbs();
    const flag = abstractBool();
    $fork(
      flag,
      () => {
        setAddEntry(s, numLit(1));
        return abs({ k: "unknown" } as never, undefined, undefined, "exact" as never);
      },
      () => abs({ k: "unknown" } as never, undefined, undefined, "exact" as never),
    );
    expect(setSizeAbs(s).conf).not.toBe("exact");
  });

  it("Set dedups literal elements", () => {
    const s = makeSetAbs();
    setAddEntry(s, numLit(1));
    setAddEntry(s, numLit(1));
    const size = setSizeAbs(s);
    expect(size.conf).toBe("exact");
    expect(litValue(size)).toBe(1);
    expect(setHasEntry(s, numLit(1)).conf).toBe("exact");
    expect(litValue(setHasEntry(s, numLit(1)))).toBe(true);
  });
});
