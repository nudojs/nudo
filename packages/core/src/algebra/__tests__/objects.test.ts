import { describe, it, expect } from "vitest";
import {
  analyzeFn,
  objOf,
  spread,
  joinAbs,
  joinObjects,
  collapseToOptional,
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

  it("collapseToOptional is explicit loss and #widened", () => {
    const a = objOf({ port: { value: numLit(3000) }, debug: { value: boolLit(true) } });
    const b = objOf({ host: { value: strLit("x") } });
    const sum = joinAbs(a, b);
    expect(sum.shape.k).toBe("sum");
    const collapsed = collapseToOptional(sum);
    expect(collapsed.conf).toBe("widened");
    expect(collapsed.shape.k).toBe("obj");
    if (collapsed.shape.k !== "obj") return;
    expect(collapsed.shape.slots.port!.optional).toBe(true);
    expect(collapsed.shape.slots.host!.optional).toBe(true);
    expect(collapsed.shape.slots.debug!.optional).toBe(true);
  });

  it("join(NaN, NaN) keeps the NaN literal (Object.is, not ===)", () => {
    const nan = numLit(NaN);
    const r = joinAbs(nan, nan);
    expect(r.term?.op).toBe("lit");
    if (r.term?.op === "lit") expect(r.term.value).toBeNaN();
    expect(r.conf).toBe("exact");
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
