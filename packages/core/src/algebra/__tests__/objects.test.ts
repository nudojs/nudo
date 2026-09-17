import { describe, it, expect } from "vitest";
import {
  analyzeFn,
  objOf,
  spread,
  joinAbs,
  joinObjects,
  abs,
  type Abs,
  numLit,
  strLit,
  boolLit,
  numVar,
  gtNum,
  v,
  lit,
  litValue,
  formatAbs,
  formatShape,
  isObj,
} from "../index.ts";

describe("objects: spread", () => {
  it("defaults ⊕ {port:3000} keeps host and overwrites port", () => {
    const defaults = objOf({
      host: { value: strLit("localhost") },
      port: { value: numLit(8080) },
      debug: { value: boolLit(false) },
    });
    const over = objOf({
      port: { value: numLit(3000) },
      debug: { value: boolLit(true) },
    });
    const r = spread(defaults, over);
    expect(isObj(r)).toBe(true);
    if (!isObj(r)) return;
    expect(litValue(r.shape.slots.host!.value)).toBe("localhost");
    expect(litValue(r.shape.slots.port!.value)).toBe(3000);
    expect(litValue(r.shape.slots.debug!.value)).toBe(true);
  });

  it("createConfig from source keeps literal results per call site", () => {
    const src = `
      function createConfig(options) {
        return {
          host: "localhost",
          port: 8080,
          debug: false,
          ...options,
        };
      }
    `;
    const r1 = analyzeFn(src, "createConfig", [
      objOf({ port: { value: numLit(3000) }, debug: { value: boolLit(true) } }),
    ]);
    expect(isObj(r1)).toBe(true);
    if (!isObj(r1)) return;
    expect(litValue(r1.shape.slots.host!.value)).toBe("localhost");
    expect(litValue(r1.shape.slots.port!.value)).toBe(3000);
    expect(litValue(r1.shape.slots.debug!.value)).toBe(true);

    const r2 = analyzeFn(src, "createConfig", [objOf({})]);
    if (!isObj(r2)) return;
    expect(litValue(r2.shape.slots.port!.value)).toBe(8080);
  });
});

describe("objects: join", () => {
  it("same keys, different literal values → join drops term, keeps prim", () => {
    const a = objOf({ a: { value: numLit(1) } });
    const b = objOf({ a: { value: numLit(2) } });
    const r = joinObjects(a, b);
    expect(isObj(r)).toBe(true);
    if (!isObj(r)) return;
    expect(r.shape.slots.a!.value.shape).toEqual({ k: "prim", type: "number" });
    expect(r.shape.slots.a!.value.term).toBeUndefined();
  });

  it("different key sets → sum, NOT optional collapse", () => {
    const a = objOf({ port: { value: numLit(3000) } });
    const b = objOf({});
    const r = joinAbs(a, b);
    // 应是 sum 而不是 { port?: number }
    expect(r.shape.k).toBe("sum");
  });
  it("join(NaN, NaN) keeps the NaN literal (Object.is, not ===)", () => {
    const nan = numLit(NaN);
    const r = joinAbs(nan, nan);
    expect(r.term?.op).toBe("lit");
    if (r.term?.op === "lit") expect(r.term.value).toBeNaN();
    expect(r.conf).toBe("exact");
  });

  it("join of two array types is a sum, not a collapsed single array", () => {
    const numArr = abs({ k: "arr", element: numLit(1) }, undefined, undefined, "path");
    const strArr = abs({ k: "arr", element: strLit("a") }, undefined, undefined, "path");
    const r = joinAbs(numArr, strArr);
    expect(r.shape.k).toBe("sum");
    if (r.shape.k === "sum") expect(r.shape.members.length).toBe(2);
  });

  it("join of same-arity function overloads keeps both signatures", () => {
    const f1: Abs = {
      shape: {
        k: "fn",
        params: ["a", "b"],
        name: "f",
        paramTypes: [numLit(1), strLit("x")],
        returnType: strLit("r"),
      },
      conf: "path",
    };
    const f2: Abs = {
      shape: {
        k: "fn",
        params: ["c", "d"],
        name: "g",
        paramTypes: [strLit("y"), numLit(2)],
        returnType: numLit(3),
      },
      conf: "path",
    };
    const r = joinAbs(f1, f2);
    expect(r.shape.k).toBe("sum");
    if (r.shape.k === "sum") expect(r.shape.members.length).toBe(2);
  });
});

describe("format", () => {
  it("formats literal number", () => {
    expect(formatShape(numLit(4))).toBe("4");
  });
  it("formats with term and pred", () => {
    const phi = gtNum(v("x"), 0);
    const src = `
      const add = (a, b) => a + b;
      function scale(x) { return add(x, 1); }
    `;
    const r = analyzeFn(src, "scale", [numVar("x", gtNum(v("x"), 0))], phi);
    const s = formatAbs(r);
    expect(s).toContain("number");
    expect(s).toContain("(x + 1)");
    expect(s).toContain(">");
  });
});
