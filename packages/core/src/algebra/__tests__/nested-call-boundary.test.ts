import { describe, it, expect } from "vitest";
import {
  runTranspiled,
  callTranspiledExportFull,
  formatAbs,
  abs,
  litValue,
} from "@nudojs/core";

const pathNum = () =>
  abs({ k: "prim", type: "number" } as never, undefined, undefined, "path" as never);

const tupleAbs = () =>
  abs(
    {
      k: "tuple",
      elements: [
        abs({ k: "prim", type: "number" } as never, { op: "lit", value: 1 } as never, undefined as never, "exact" as never),
        abs({ k: "prim", type: "number" } as never, { op: "lit", value: 4 } as never, undefined as never, "exact" as never),
      ],
    } as never,
    undefined,
    undefined,
    "exact" as never,
  );

function callOuter(src: string, args: unknown[] = []) {
  const exports = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(
    exports,
    "outer",
    args.map((a) => (a && typeof a === "object" && "shape" in a ? a : abs({ k: "unknown" } as never, { op: "lit", value: a as never } as never, undefined as never, "exact" as never))),
  );
}

describe("B-path nested call NudoReturn boundary", () => {
  it("nested arrow loop early-return is callee result, not outer result", () => {
    const src = `
export function outer(arr) {
  const inner = (y) => {
    for (const v of y) {
      if (v > 2) return 100;
    }
    return -1;
  };
  return inner(arr) + 10;
}
`;
    const r = callOuter(src, [tupleAbs()]);
    const s = formatAbs(r.result);
    // 100+10 或 -1+10；绝不是裸 100（callee return 冒泡）
    expect(s).not.toBe("100");
    expect(litValue(r.result) === 110 || litValue(r.result) === 9 || s.includes("110") || s.includes("9")).toBe(true);
  });

  it("nested function declaration does not emit export (B-path can run)", () => {
    const src = `
export function outer(arr) {
  function inner(y) {
    for (const v of y) {
      if (v > 2) return 100;
    }
    return -1;
  }
  return inner(arr) + 10;
}
`;
    const r = callOuter(src, [tupleAbs()]);
    expect(formatAbs(r.result)).not.toBe("100");
  });

  it("top-level early-return still folds (regression)", () => {
    const src = `
export function outer(arr) {
  for (const v of arr) {
    if (v > 2) return v;
  }
  return -1;
}
`;
    const r = callOuter(src, [tupleAbs()]);
    expect(litValue(r.result)).toBe(4);
  });
});

describe("sort positional precision", () => {
  it("after sort, index read is not false-exact old slot", () => {
    const src = `
export function outer() {
  const a = [3, 1, 2];
  a.sort();
  return a[0];
}
`;
    const r = callOuter(src, []);
    const s = formatAbs(r.result);
    expect(s).not.toBe("3");
  });
});

describe("closed-shape $idx literal miss", () => {
  it("known-missing key projects undefined only", () => {
    const src = `
export function outer() {
  return { a: 1, b: "x" }["c"];
}
`;
    const r = callOuter(src, []);
    const s = formatAbs(r.result);
    expect(s.startsWith("undefined")).toBe(true);
    expect(s).not.toContain("1");
    expect(s).not.toContain("\"x\"");
  });
});
