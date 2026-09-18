import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  $lit,
  litValue,
  formatAbs,
  transpile,
} from "@nudojs/core";

describe("B-path switch", () => {
  it("selects matching case by concrete disc", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
      return "one";
    case 2:
      return "two";
    default:
      return "other";
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toBe("one");
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(2)]).result)).toBe("two");
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(9)]).result)).toBe("other");
  });

  it("handles fall-through", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
    case 2:
      return "small";
    case 3:
      return "three";
    default:
      return "big";
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(1)]).result)).toBe("small");
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(2)]).result)).toBe("small");
    expect(litValue(callTranspiledExportFull(exports, "go", [$lit(3)]).result)).toBe("three");
  });

  it("abstract disc joins branches", () => {
    const src = `
export function go(n) {
  switch (n) {
    case 1:
      return 10;
    default:
      return 20;
  }
}
`;
    const exports = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(exports, "go", [
      { shape: { k: "prim", type: "number" }, conf: "exact" },
    ]);
    // 抽象 number → join(10, 20) → 枚举 10 | 20
    const fmt = formatAbs(r.result);
    expect(fmt).toContain("10");
    expect(fmt).toContain("20");
  });

  it("transpiles switch to $switch", () => {
    const out = transpile(`export function f(n) { switch (n) { case 1: return 1; default: return 0; } }`);
    expect(out).toContain("$switch(");
  });
});
