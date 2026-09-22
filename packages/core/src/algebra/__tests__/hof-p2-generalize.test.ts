import { describe, it, expect } from "vitest";
import {
  anyVar,
  formatShape,
  generalizeFromAst,
  numLit,
  relationFn,
  bool,
  abs,
  v,
  runTranspiled,
  callTranspiledExportFull,
  type Abs,
} from "../index.ts";

describe("P2: generalize use-driven promotion", () => {
  it("processItems: items→arr(A1), transform→fn(A1)=>B1, filter→fn(A1)=>bool", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    expect(g).toBeDefined();
    if (!g) return;

    // entryShapes: items → arr(A1)
    expect(g.entryShapes?.has("items")).toBe(true);
    const itemsShape = g.entryShapes!.get("items")!.abs;
    expect(itemsShape.shape.k).toBe("arr");
    expect(g.entryShapes!.get("items")!.source).toBe("promote");

    // fnRels: transform / filter
    expect(g.fnRels?.has("transform")).toBe(true);
    expect(g.fnRels?.has("filter")).toBe(true);
    const transform = g.fnRels!.get("transform")!.abs;
    const filter = g.fnRels!.get("filter")!.abs;
    expect(transform.shape.k).toBe("fn");
    expect(filter.shape.k).toBe("fn");
    if (transform.shape.k === "fn") {
      expect(transform.shape.paramTypes).toBeDefined();
      expect(transform.shape.returnType!.term).toEqual(v("B:transform"));
    }
    if (filter.shape.k === "fn") {
      expect(filter.shape.returnType!.shape).toEqual({ k: "prim", type: "boolean" });
    }

    // display 含提升快照
    expect(g.display).toContain("items");
    expect(g.display).toContain("arr(");
    expect(g.display).toContain("B:transform");
    // 钉死：items 槽位无外层 α 噪音（arr(A1)，不是 arr(A1) = A1）
    expect(g.display).toContain("items: arr(A1)");
    expect(g.display).not.toContain("arr(A1) = A1");
  });

  it("withRetry: p() direct call → fn() => B1", () => {
    const src = `
      function withRetry(fn) {
        return fn();
      }
    `;
    const g = generalizeFromAst("withRetry", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.fnRels?.has("fn")).toBe(true);
    const rel = g.fnRels!.get("fn")!.abs;
    expect(rel.shape.k).toBe("fn");
    if (rel.shape.k === "fn") {
      expect(rel.shape.paramTypes).toEqual([]);
      expect(rel.shape.returnType!.term).toEqual(v("B:fn"));
    }
    // symbolic 返回 term = B:fn
    expect(g.symbolic.term).toEqual(v("B:fn"));
  });

  it("unused param: no fnRels / no entryShapes", () => {
    const src = `
      function id(f) {
        return f;
      }
    `;
    const g = generalizeFromAst("id", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.fnRels?.has("f") ?? false).toBe(false);
    expect(g.entryShapes?.has("f") ?? false).toBe(false);
  });

  it("property access only: no promotion", () => {
    const src = `
      function getLen(f) {
        return f.length;
      }
    `;
    const g = generalizeFromAst("getLen", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.fnRels?.has("f") ?? false).toBe(false);
  });

  it("local array + callback: paramTypes is fresh α, not literal", () => {
    const src = `
      function scaleFirst(transform) {
        const xs = [1, 2, 3];
        return xs.map(transform)[0];
      }
    `;
    const g = generalizeFromAst("scaleFirst", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.fnRels?.has("transform")).toBe(true);
    const rel = g.fnRels!.get("transform")!.abs;
    if (rel.shape.k === "fn" && rel.shape.paramTypes?.[0]) {
      const pt = rel.shape.paramTypes[0]!;
      // 必须是 fresh α（T1），不是字面量 1
      expect(pt.term?.op === "var" || pt.term === undefined).toBe(true);
      if (pt.term?.op === "var") {
        expect(pt.term.id.startsWith("T")).toBe(true);
      }
    }
  });

  it("arrival-first: filter then direct call keeps filter shape", () => {
    const src = `
      function mixed(items, pred) {
        const kept = items.filter(pred);
        return pred(kept);
      }
    `;
    const g = generalizeFromAst("mixed", src);
    expect(g).toBeDefined();
    if (!g) return;
    // filter 先到：fn([A1], bool)；后到 p(x) 拒绝改写
    expect(g.fnRels?.has("pred")).toBe(true);
    const rel = g.fnRels!.get("pred")!.abs;
    if (rel.shape.k === "fn") {
      expect(rel.shape.returnType!.shape).toEqual({ k: "prim", type: "boolean" });
    }
  });

  it("nested: processItems call site gets arr(β)", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
      export function caller(items) {
        return processItems(items, (x) => x * 2, (x) => x > 0);
      }
    `;
    const run = runTranspiled(src, { mode: "analyze" });
    const r = callTranspiledExportFull(run, "caller", [
      abs({ k: "arr", element: numLit(1) }, undefined, undefined, "exact"),
    ]).result;
    expect(r.shape.k).toBe("arr");
    if (r.shape.k !== "arr") return;
    // x*2 on number element → number
    expect(r.shape.element.shape).toEqual({ k: "prim", type: "number" });
  });

  it("hofSites recorded for processItems", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    expect(g?.hofSites?.length ?? 0).toBeGreaterThan(0);
  });

  it("mount③ alone: local arr receiver (no method-miss) still promotes callback param", () => {
    // receiver 不是形参 → 挂载点①不触发；map(transform) 靠③提升 transform
    const src = `
      function doubleLocal(transform) {
        const xs = [1, 2, 3];
        return xs.map(transform);
      }
    `;
    const g = generalizeFromAst("doubleLocal", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.fnRels?.has("transform")).toBe(true);
    // 不应把局部 xs 记进 entryShapes
    expect(g.entryShapes?.has("xs") ?? false).toBe(false);
    const rel = g.fnRels!.get("transform")!.abs;
    expect(rel.shape.k).toBe("fn");
    if (rel.shape.k === "fn") {
      expect(rel.shape.returnType!.term).toEqual(v("B:transform"));
    }
  });

  it("hofSites: arr promotion is not an application site", () => {
    const src = `
      function walk(items) {
        return items.map((x) => x);
      }
    `;
    const g = generalizeFromAst("walk", src);
    if (!g?.hofSites) return;
    // 不应把 items 的 arr 提升记成 HofSite
    for (const s of g.hofSites) {
      expect(s.param).not.toBe("items");
      expect(s.result.shape.k).not.toBe("arr");
    }
  });

  it("snapshot is not same reference as env item", () => {
    const src = `
      function processItems(items, transform, filter) {
        return items.filter(filter).map(transform);
      }
    `;
    const g = generalizeFromAst("processItems", src);
    const snap = g?.entryShapes?.get("items")?.abs;
    expect(snap).toBeDefined();
    const itemsIdx = g!.params.indexOf("items");
    const tp = g!.typeParams[itemsIdx >= 0 ? itemsIdx : 0]!;
    // typeParams 保持原 any(α)，未被 mutate
    expect(tp.value.shape.k).toBe("any");
    expect(tp.value.term).toEqual(v("A1"));
    // 快照 ≠ typeParams 同一引用；shape 也是新对象
    expect(snap).not.toBe(tp.value);
    expect(snap!.shape).not.toBe(tp.value.shape);
    expect(snap!.shape.k).toBe("arr");
    // display 走 entryShapes，不读 typeParams
    expect(g!.display).toContain("arr(");
  });

  it("applyEach: for-of promotes items + direct call promotes fn", () => {
    const src = `
      function applyEach(items, fn) {
        for (const x of items) fn(x);
      }
    `;
    const g = generalizeFromAst("applyEach", src);
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.entryShapes?.has("items")).toBe(true);
    expect(g.entryShapes!.get("items")!.abs.shape.k).toBe("arr");
    expect(g.entryShapes!.get("items")!.source).toBe("promote");
    expect(g.fnRels?.has("fn")).toBe(true);
    const rel = g.fnRels!.get("fn")!.abs;
    expect(rel.shape.k).toBe("fn");
    if (rel.shape.k === "fn") {
      expect(rel.shape.returnType!.term).toEqual(v("B:fn"));
      // 元素来自 items 提升后的 A1，不是 fresh T*
      expect(rel.shape.paramTypes?.[0]?.term).toEqual(v("A1"));
    }
  });
});
