import { describe, it, expect, afterEach } from "vitest";
import {
  makeMapAbs,
  mapSetEntry,
  mapGetEntry,
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
    // 模拟 transpile：$fork 两臂，仅 true 臂 set
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
    // 应为 99|undefined（或 path 数字∪undefined），不能是纯 99 也不能丢 undefined
    expect(s).not.toBe("99");
    expect(s.includes("undefined") || s.includes("unknown")).toBe(true);
  });
});
