import { describe, it, expect } from "vitest";
import {
  abs,
  absFunction,
  anyVar,
  bool,
  confJoin,
  formatShape,
  getFnImpl,
  instantiateReturn,
  isRelFn,
  litValue,
  num,
  numLit,
  numVar,
  relationFn,
  relationFingerprint,
  shapeOnlyFn,
  str,
  substAbs,
  v,
  joinAbs,
  runTranspiled,
  callTranspiledExportFull,
  type Abs,
} from "../index.ts";
import { gt } from "../pred.ts";

/** B 路径驱动：runTranspiled + 导出调用（取代 analyzeFn 的求值面） */
function analyzeExport(src: string, fnName: string, args: Abs[]): Abs {
  const run = runTranspiled(src, { mode: "analyze" });
  return callTranspiledExportFull(run, fnName, args).result;
}

const a1 = anyVar("A1");
const b1 = abs({ k: "any" }, v("B1"), undefined, "path");

describe("P1a: relationFn dual-write + conf", () => {
  it("writes both shape.paramTypes/returnType and impl.relation", () => {
    const f = relationFn([a1], b1);
    const s = f.shape;
    expect(s.k).toBe("fn");
    if (s.k !== "fn") return;
    expect(s.paramTypes).toBeDefined();
    expect(s.returnType).toBeDefined();
    expect(s.paramTypes![0]!.term).toEqual(v("A1"));
    expect(s.returnType!.term).toEqual(v("B1"));
    const impl = getFnImpl(f)!;
    expect(impl.relation).toBeDefined();
    expect(impl.relation!.paramTypes).toBe(s.paramTypes);
    expect(impl.relation!.returnType).toBe(s.returnType);
    expect(impl.body).toBeUndefined();
  });

  it("defaults conf to path, not exact", () => {
    const f = relationFn([a1], b1);
    expect(f.conf).toBe("path");
    // format 含 term 展示属 P1b；P1a 用 shape 字段断言
    const s = f.shape;
    if (s.k === "fn") {
      expect(s.paramTypes![0]!.term).toEqual(v("A1"));
      expect(s.returnType!.term).toEqual(v("B1"));
    }
  });

  it("shapeOnlyFn has no impl (E path)", () => {
    const f = shapeOnlyFn([a1], b1);
    expect(getFnImpl(f)).toBeUndefined();
    expect(isRelFn(f)).toBe(true);
  });
});

describe("P1a: isRelFn", () => {
  it("accepts aligned shape-only relation", () => {
    expect(isRelFn(shapeOnlyFn([a1], b1))).toBe(true);
  });

  it("rejects when paramTypes arity mismatches params", () => {
    const half: Abs = {
      shape: { k: "fn", params: ["x", "y"], paramTypes: [a1], returnType: b1 },
      conf: "path",
    };
    expect(isRelFn(half)).toBe(false);
  });

  it("rejects when returnType missing", () => {
    const bare: Abs = {
      shape: { k: "fn", params: ["x"], paramTypes: [a1] },
      conf: "path",
    };
    expect(isRelFn(bare)).toBe(false);
  });

  it("rejects when impl present (D path owns it)", () => {
    const f = relationFn([a1], b1);
    expect(isRelFn(f)).toBe(false);
  });

  it("rejects non-fn and null", () => {
    expect(isRelFn(num())).toBe(false);
    expect(isRelFn(undefined)).toBe(false);
    expect(isRelFn(null)).toBe(false);
  });

  it("accepts zero-arg with returnType and no paramTypes", () => {
    const f: Abs = {
      shape: { k: "fn", params: [], returnType: b1 },
      conf: "path",
    };
    expect(isRelFn(f)).toBe(true);
  });
});

describe("P1a: substAbs term discipline", () => {
  it("keeps free α term B1 after substituting A1", () => {
    const ret = abs({ k: "any" }, v("B1"), undefined, "path");
    const f = relationFn([a1], ret);
    const out = instantiateReturn(f, [num()]);
    expect(out.term).toEqual(v("B1"));
    expect(out.shape.k).toBe("any");
  });

  it("replaces mapped var with whole Abs", () => {
    const map = new Map<string, Abs>([["A1", numLit(5)]]);
    const out = substAbs(a1, map);
    expect(out.term).toEqual({ op: "lit", value: 5 });
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("keeps unmapped var as-is", () => {
    const map = new Map<string, Abs>([["A1", num()]]);
    const out = substAbs(b1, map);
    expect(out.term).toEqual(v("B1"));
  });

  it("recurses into arr element", () => {
    const arr = abs({ k: "arr", element: a1 }, undefined, undefined, "path");
    const map = new Map<string, Abs>([["A1", num()]]);
    const out = substAbs(arr, map);
    expect(out.shape.k).toBe("arr");
    if (out.shape.k !== "arr") return;
    expect(out.shape.element.shape).toEqual({ k: "prim", type: "number" });
  });

  it("substitutes both sides of a shared (DAG) node", () => {
    // 同一 Abs 对象被引用两次：第二次不得因「访问过」而跳过替换
    const inner = abs({ k: "arr", element: anyVar("A1") }, undefined, undefined, "path");
    const shared = abs({ k: "tuple", elements: [inner, inner] }, undefined, undefined, "path");
    const out = substAbs(shared, new Map<string, Abs>([["A1", num()]]));
    expect(out.shape.k).toBe("tuple");
    if (out.shape.k !== "tuple") return;
    for (const el of out.shape.elements) {
      expect(el.shape.k).toBe("arr");
      if (el.shape.k === "arr") {
        expect(el.shape.element.shape).toEqual({ k: "prim", type: "number" });
      }
    }
  });
});

describe("P1a: substAbs pred three rules", () => {
  it("keeps free-α pred (B1 > 0) when only A1 is mapped", () => {
    const pred = gt(v("B1"), { op: "lit", value: 0 });
    const ret = abs({ k: "prim", type: "number" }, v("B1"), pred, "path");
    const map = new Map<string, Abs>([["A1", num()]]);
    const out = substAbs(ret, map);
    expect(out.pred).toEqual(pred);
    expect(out.term).toEqual(v("B1"));
  });

  it("folds mapped var pred when arg has lit term", () => {
    const pred = gt(v("A1"), { op: "lit", value: 0 });
    const ret = abs({ k: "prim", type: "number" }, v("B1"), pred, "path");
    const map = new Map<string, Abs>([["A1", numLit(5)]]);
    const out = substAbs(ret, map);
    // A1:=5, 5>0 → true → pred stripped
    expect(out.pred === undefined || out.pred.op === "true").toBe(true);
  });

  it("drops pred and degrades conf when mapped arg is shape-only", () => {
    // term 不是被映射的 var，pred 引用 A1；A1:=num()（无 term）
    const pred = gt(v("A1"), { op: "lit", value: 0 });
    const ret = abs({ k: "prim", type: "number" }, v("B1"), pred, "exact");
    const map = new Map<string, Abs>([["A1", num()]]);
    const out = substAbs(ret, map);
    expect(out.pred === undefined || out.pred.op === "true").toBe(true);
    expect(out.conf).toBe(confJoin("exact", "partial"));
    expect(out.term).toEqual(v("B1"));
  });

  it("residual pred keeps when mapped arg has non-lit term", () => {
    const pred = gt(v("A1"), { op: "lit", value: 0 });
    const ret = abs({ k: "prim", type: "number" }, v("B1"), pred, "path");
    const map = new Map<string, Abs>([["A1", numVar("n1")]]);
    const out = substAbs(ret, map);
    expect(out.pred).toEqual(gt(v("n1"), { op: "lit", value: 0 }));
    expect(out.term).toEqual(v("B1"));
  });
});

describe("P1a: instantiateReturn", () => {
  it("first-binding wins for duplicate α", () => {
    const dup = relationFn([a1, anyVar("A1")], a1);
    const out = instantiateReturn(dup, [num(), str()]);
    expect(out.shape).toEqual({ k: "prim", type: "number" });
  });

  it("uses impl.relation preferentially over shape", () => {
    const f = relationFn([a1], abs({ k: "prim", type: "string" }, v("B1"), undefined, "path"));
    const out = instantiateReturn(f, [num()]);
    expect(out.shape).toEqual({ k: "prim", type: "string" });
  });

  it("non-var paramTypes are not bound", () => {
    const f = relationFn([num()], a1);
    const out = instantiateReturn(f, [str()]);
    // A1 not in map → stays any(A1)
    expect(out.term).toEqual(v("A1"));
  });

  it("missing args → unknown binding", () => {
    const f = relationFn([a1], abs({ k: "arr", element: a1 }, undefined, undefined, "path"));
    const out = instantiateReturn(f, []);
    expect(out.shape.k).toBe("arr");
    if (out.shape.k !== "arr") return;
    expect(out.shape.element.shape.k).toBe("unknown");
  });

  it("deep α: T[] param binds T from number[] arg (lodash-style)", () => {
    const T = abs({ k: "any" }, v("T"), undefined, "path");
    const tArr = abs({ k: "arr", element: T }, undefined, undefined, "path");
    // uniq<T>(array: T[] | null | undefined): T[]
    const f = relationFn(
      [absUnionForTest([tArr, abs({ k: "unknown" }, undefined, undefined, "path")])],
      tArr,
    );
    const numArr = abs(
      { k: "arr", element: abs({ k: "prim", type: "number" }, undefined, undefined, "exact") },
      undefined,
      undefined,
      "exact",
    );
    const out = instantiateReturn(f, [numArr]);
    expect(out.shape.k).toBe("arr");
    if (out.shape.k !== "arr") return;
    expect(out.shape.element.shape).toEqual({ k: "prim", type: "number" });
  });
});

function absUnionForTest(members: Abs[]): Abs {
  return members.reduce((acc, m) => joinAbs(acc, m));
}

describe("P1a: fingerprint budget identity", () => {
  it("different relationFn with same returnType still get distinct fingerprints only via paramTypes", () => {
    const f1 = relationFn([a1], b1);
    const f2 = relationFn([anyVar("A2")], b1);
    const impl1 = getFnImpl(f1)!;
    const impl2 = getFnImpl(f2)!;
    expect(impl1.fingerprint).toBeDefined();
    expect(impl2.fingerprint).toBeDefined();
    expect(impl1.fingerprint).not.toBe(impl2.fingerprint);
  });

  it("same signature shares fingerprint (known limitation)", () => {
    const f1 = relationFn([a1], b1);
    const f2 = relationFn([a1], b1);
    expect(getFnImpl(f1)!.fingerprint).toBe(getFnImpl(f2)!.fingerprint);
  });

  it("explicit fingerprint overrides auto", () => {
    const f = relationFn([a1], b1, { fingerprint: "custom-fp" });
    expect(getFnImpl(f)!.fingerprint).toBe("custom-fp");
  });

  it("relationFingerprint is stable across object identity", () => {
    const a = relationFingerprint([anyVar("A1")], anyVar("B1"));
    const b = relationFingerprint([anyVar("A1")], anyVar("B1"));
    expect(a).toBe(b);
  });
});

// --- P1b: map 接线 + format ---

describe("P1b: formatShape relation slots", () => {
  it("prints paramTypes and returnType with terms", () => {
    const f = relationFn([a1], b1);
    expect(formatShape(f)).toBe("(A1) => B1");
  });

  it("prints concrete monomorphic relation", () => {
    const f = relationFn([num()], str());
    expect(formatShape(f)).toBe("(number) => string");
  });

  it("keeps bare fn without paramTypes as (x) => ?", () => {
    const bare: Abs = {
      shape: { k: "fn", params: ["x"] },
      conf: "path",
    };
    expect(formatShape(bare)).toBe("(x) => ?");
  });

  it("zero-arg relation prints () => B1", () => {
    const f = relationFn([], b1);
    expect(formatShape(f)).toBe("() => B1");
  });
});

describe("P1b: map recognizes relation callbacks", () => {
  it("map with relationFn callback (D path) on arr", () => {
    const src = `
      export function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const arr = abs({ k: "arr", element: anyVar("A1") }, undefined, undefined, "path");
    const cb = relationFn([a1], b1);
    const r = analyzeExport(src, "mapAll", [arr, cb]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("B1"));
  });

  it("map with shape-only callback (E path) on arr", () => {
    const src = `
      export function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const arr = abs({ k: "arr", element: anyVar("A1") }, undefined, undefined, "path");
    const cb = shapeOnlyFn([a1], b1);
    const r = analyzeExport(src, "mapAll", [arr, cb]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("B1"));
  });

  it("map body wins over relation when both present", () => {
    // body 实现：x => x * 2；relation 写 string
    const src = `
      export function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const arr = abs({ k: "arr", element: numLit(3) }, undefined, undefined, "exact");
    const cb = absFunction(["x"], {
      body: {
        type: "BinaryExpression",
        operator: "*",
        left: { type: "Identifier", name: "x" },
        right: { type: "NumericLiteral", value: 2 },
      } as never,
    });
    // 手挂 relation（与 body 共存）→ body 胜出
    const s = cb.shape;
    if (s.k === "fn") {
      s.paramTypes = [num()];
      s.returnType = str();
    }
    const impl = getFnImpl(cb)!;
    impl.relation = { paramTypes: [num()], returnType: str() };

    const r = analyzeExport(src, "mapAll", [arr, cb]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    // body: 3*2 = 6，不是 string
    expect(litValue(r.shape.element)).toBe(6);
  });

  it("map on tuple keeps precision with inline arrow", () => {
    const src = `
      export function doubleAll(xs) {
        return xs.map((x) => x * 2);
      }
    `;
    const tup = abs(
      { k: "tuple", elements: [numLit(1), numLit(2)] },
      undefined,
      undefined,
      "exact",
    );
    const r = analyzeExport(src, "doubleAll", [tup]);
    expect(r.shape.k).toBe("tuple");
    if (r.shape.k !== "tuple") return;
    expect(litValue(r.shape.elements[0]!)).toBe(2);
    expect(litValue(r.shape.elements[1]!)).toBe(4);
  });

  it("map bare fn without returnType stays unknown", () => {
    const src = `
      export function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const arr = abs({ k: "arr", element: a1 }, undefined, undefined, "path");
    const bare: Abs = { shape: { k: "fn", params: ["x"] }, conf: "path" };
    const r = analyzeExport(src, "mapAll", [arr, bare]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.shape.k).toBe("unknown");
  });

  it("map with function union callback joins member results", () => {
    const src = `
      export function mapAll(xs, transform) {
        return xs.map(transform);
      }
    `;
    const arr = abs({ k: "arr", element: a1 }, undefined, undefined, "path");
    const f1 = relationFn([a1], abs({ k: "prim", type: "number" }, v("B1"), undefined, "path"));
    const f2 = relationFn([a1], abs({ k: "prim", type: "string" }, v("C1"), undefined, "path"));
    const sum = abs({ k: "sum", members: [f1, f2] }, undefined, undefined, "path");
    const r = analyzeExport(src, "mapAll", [arr, sum]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    // applyCallbackAbs 对 sum：join(number, string)
    expect(r.shape.element.shape.k === "sum" || r.shape.element.shape.k === "unknown").toBe(true);
  });

  it("direct call of relation-only param p(x) returns β", () => {
    const src = `
      export function applyFn(p, x) {
        return p(x);
      }
    `;
    const cb = relationFn([a1], b1);
    const r = analyzeExport(src, "applyFn", [cb, numLit(1)]);
    expect(r.term).toEqual(v("B1"));
  });

  it("direct call of shape-only param p(x) returns β", () => {
    const src = `
      export function applyFn(p, x) {
        return p(x);
      }
    `;
    const cb = shapeOnlyFn([a1], b1);
    const r = analyzeExport(src, "applyFn", [cb, numLit(1)]);
    expect(r.term).toEqual(v("B1"));
  });
});

describe("P1b: processItems hand-crafted fixture", () => {
  it("filter (identity) + map with relation callbacks → arr(β)", () => {
    const src = `
      export function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const items = abs({ k: "arr", element: a1 }, undefined, undefined, "path");
    const transform = relationFn([a1], b1);
    const filter = relationFn([a1], bool());
    const r = analyzeExport(src, "processItems", [items, transform, filter]);
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    expect(r.shape.element.term).toEqual(v("B1"));
  });
});

