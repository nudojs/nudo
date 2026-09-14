import { describe, it, expect } from "vitest";
import {
  abs,
  analyzeFn,
  anyVar,
  bool,
  instantiateReturn,
  isRelFn,
  joinAbs,
  num,
  numLit,
  relationFn,
  shapeOnlyFn,
  str,
  unknown,
  v,
  type Abs,
} from "../index.ts";
import { $call } from "../exec/call.ts";

const a1 = anyVar("A1");
const b1 = abs({ k: "any" }, v("B1"), undefined, "path");
const arrA1 = abs({ k: "arr", element: a1 }, undefined, undefined, "path");

describe("P1c: filter/reduce/flatMap relation", () => {
  it("filter preserves arr shape with relation callback", () => {
    const src = `
      function keep(xs, pred) {
        return xs.filter(pred);
      }
    `;
    const pred = relationFn([a1], bool());
    const r = analyzeFn(src, "keep", [arrA1, pred]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("A1"));
  });

  it("reduce relation-only joins init once (no fixed-point)", () => {
    const src = `
      function fold(xs, reducer, init) {
        return xs.reduce(reducer, init);
      }
    `;
    const reducer = relationFn([num(), a1], abs({ k: "prim", type: "number" }, v("B1"), undefined, "path"));
    const r = analyzeFn(src, "fold", [arrA1, reducer, numLit(0)]);
    // join(0, B1) → sum-ish; at least not unknown-only crash
    expect(r.shape.k).toBeDefined();
    // 一次 join：init number ⊔ B1
    const expected = joinAbs(numLit(0), abs({ k: "prim", type: "number" }, v("B1"), undefined, "path"));
    expect(r.shape).toEqual(expected.shape);
  });

  it("flatMap relation returning arr(γ) → element=γ", () => {
    const src = `
      function fanout(xs, f) {
        return xs.flatMap(f);
      }
    `;
    const gamma = abs({ k: "prim", type: "string" }, v("G1"), undefined, "path");
    const f = relationFn([a1], abs({ k: "arr", element: gamma }, undefined, undefined, "path"));
    const r = analyzeFn(src, "fanout", [arrA1, f]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("G1"));
  });

  it("flatMap relation returning non-arr → unknown", () => {
    const src = `
      function fanout(xs, f) {
        return xs.flatMap(f);
      }
    `;
    const f = relationFn([a1], num());
    const r = analyzeFn(src, "fanout", [arrA1, f]);
    expect(r.shape.k).toBe("unknown");
  });

  it("forEach with relation → undefined", () => {
    const src = `
      function walk(xs, f) {
        xs.forEach(f);
      }
    `;
    const f = relationFn([a1], b1);
    const r = analyzeFn(src, "walk", [arrA1, f]);
    // no return → undefined-ish
    expect(r.term?.op === "lit" && r.term.value === undefined).toBe(true);
  });

  it("some/every with relation → boolean", () => {
    const srcAny = `
      function anyPos(xs, pred) {
        return xs.some(pred);
      }
    `;
    const pred = relationFn([a1], bool());
    const r = analyzeFn(srcAny, "anyPos", [arrA1, pred]);
    expect(r.shape).toEqual({ k: "prim", type: "boolean" });
  });
});

describe("P1c: $call dual-path consistency", () => {
  it("$call applies relationFn (D path)", () => {
    const f = relationFn([a1], b1);
    const out = $call(f, [num()]);
    expect(out.term).toEqual(v("B1"));
  });

  it("$call applies shapeOnlyFn (E path)", () => {
    const f = shapeOnlyFn([a1], b1);
    const out = $call(f, [num()]);
    expect(out.term).toEqual(v("B1"));
  });

  it("ast-eval map and $call agree on D path", () => {
    const src = `
      function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const cb = relationFn([a1], b1);
    const viaAst = analyzeFn(src, "mapAll", [arrA1, cb]);
    // $call 对回调本身：instantiateReturn
    const viaCall = $call(cb, [a1]);
    expect(viaAst.shape.k).toBe("arr");
    if (viaAst.shape.k !== "arr") return;
    expect(viaAst.shape.element.term).toEqual(viaCall.term);
  });

  it("ast-eval map and $call agree on E path", () => {
    const src = `
      function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const cb = shapeOnlyFn([a1], b1);
    const viaAst = analyzeFn(src, "mapAll", [arrA1, cb]);
    const viaCall = $call(cb, [a1]);
    expect(viaAst.shape.k).toBe("arr");
    if (viaAst.shape.k !== "arr") return;
    expect(viaAst.shape.element.term).toEqual(viaCall.term);
  });

  it("function union: $call joins member results", () => {
    const f1 = relationFn([a1], num());
    const f2 = relationFn([a1], str());
    const sum: Abs = { shape: { k: "sum", members: [f1, f2] }, conf: "path" };
    const out = $call(sum, [a1]);
    // join(number, string) → sum
    expect(out.shape.k === "sum" || out.shape.k === "unknown").toBe(true);
  });

  it("function union on map: analyzeFn does not crash", () => {
    const src = `
      function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const f1 = relationFn([a1], num());
    const f2 = relationFn([a1], str());
    const sum: Abs = { shape: { k: "sum", members: [f1, f2] }, conf: "path" };
    const r = analyzeFn(src, "mapAll", [arrA1, sum]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    // sum 回调 → join(number, string)
    expect(r.shape.element.shape.k === "sum" || r.shape.element.shape.k === "unknown").toBe(true);
  });
});

describe("P1c: processItems full filter+map fixture", () => {
  it("arr(α) + fRel + gRel → arr(β)", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const transform = relationFn([a1], b1);
    const filter = relationFn([a1], bool());
    const r = analyzeFn(src, "processItems", [arrA1, transform, filter]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("B1"));
  });
});

describe("P1c: dual-path flatMap consistency", () => {
  it("ast-eval flatMap on tuple returns arr (not tuple), element = join", () => {
    const src = `
      function fanout(xs, f) {
        return xs.flatMap(f);
      }
    `;
    const tup = abs(
      {
        k: "tuple",
        elements: [
          abs({ k: "prim", type: "number" }, v("n1"), undefined, "path"),
          abs({ k: "prim", type: "string" }, v("s1"), undefined, "path"),
        ],
      },
      undefined,
      undefined,
      "path",
    );
    const f = relationFn(
      [a1],
      abs({ k: "arr", element: abs({ k: "prim", type: "number" }, v("G1"), undefined, "path") }, undefined, undefined, "path"),
    );
    const r = analyzeFn(src, "fanout", [tup, f]);
    // JS flatMap 永远返回 Array；双路径共用 projectFlatMapResult
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("G1"));
  });

  it("$call map callback and ast-eval map agree on returnType slot fallback shape kind", () => {
    // 双路径 map：relation 回调结果元素 term 一致
    const cb = relationFn([a1], abs({ k: "prim", type: "string" }, v("R1"), undefined, "path"));
    const src = `
      function mapAll(xs, t) {
        return xs.map(t);
      }
    `;
    const viaAst = analyzeFn(src, "mapAll", [arrA1, cb]);
    const viaCall = $call(cb, [a1]);
    expect(viaAst.shape.k).toBe("arr");
    if (viaAst.shape.k !== "arr") return;
    expect(viaAst.shape.element.term).toEqual(viaCall.term);
    expect(viaAst.shape.element.shape).toEqual({ k: "prim", type: "string" });
  });
});
