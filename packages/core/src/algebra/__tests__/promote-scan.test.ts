/**
 * 提升前置化静态扫描器单测：与求值期挂载点同口径——
 * receiver-arr / for-of / direct-call-fn / callback-fn（map/filter/reduce）、
 * 到达优先、refine 形状拒绝、内联箭头体参与、嵌套函数声明体不参与。
 * 期望经 generalizeFromAst 的运行时行为手工核对（见 hof-p2-generalize 等套件）。
 */
import { describe, it, expect } from "vitest";
import { parseSource } from "../parse-source.ts";
import { scanPromotions } from "../promote-scan.ts";
import { abs } from "../abs.ts";

function scan(src: string, fnName = "f") {
  const file = parseSource(src);
  const decl = (file.program.body as Array<{ type: string; id?: { name: string } | null; body: never }>).find(
    (s) => s.type === "FunctionDeclaration" && s.id?.name === fnName,
  );
  if (!decl) throw new Error(`fn ${fnName} not found`);
  const params = (decl as unknown as { params: Array<{ name?: string }> }).params.map(
    (p, i) => p.name ?? `p${i}`,
  );
  const initial = new Map(
    params.map((p, i) => [p, abs({ k: "any" }, undefined, undefined, "path") as never]),
  );
  return scanPromotions(decl.body, params, params.map((_, i) => `A${i + 1}`), initial);
}

describe("promote-scan: receiver arr promotion (挂载点①)", () => {
  it("map/filter/reduce/flatMap promote the any receiver param", () => {
    const r = scan(`function f(items) { return items.map(x => x); }`);
    expect([...r.entryShapes.keys()]).toEqual(["items"]);
    expect(r.promotedShapes.get("items")?.k).toBe("arr");
    expect(r.sites).toEqual([]); // arr 不是应用点
  });

  it("non-HOF method names do not promote", () => {
    const r = scan(`function f(items) { return items.join(','); }`);
    expect(r.entryShapes.size).toBe(0);
    expect(r.promotedShapes.size).toBe(0);
  });

  it("member receiver that is not a param does not promote", () => {
    const r = scan(`function f(items) { return makeArr().map(x => x); }`);
    expect(r.entryShapes.size).toBe(0);
  });
});

describe("promote-scan: for-of iteratee", () => {
  it("for-of over any param promotes to arr", () => {
    const r = scan(`function f(items) { let s = 0; for (const x of items) s += x; return s; }`);
    expect(r.promotedShapes.get("items")?.k).toBe("arr");
  });
});

describe("promote-scan: direct call (挂载点②)", () => {
  it("p(x) promotes param to fn with site", () => {
    const r = scan(`function f(p, x) { return p(x); }`);
    const fn = r.fnRels.get("p")?.abs;
    expect(fn?.shape.k).toBe("fn");
    expect((fn!.shape as { paramTypes?: unknown[] }).paramTypes?.length).toBe(1);
    expect(r.sites.length).toBe(1);
    expect(r.sites[0]!.param).toBe("p");
    expect(r.sites[0]!.argTerms[0]!.op).toBe("var"); // x → 其 typeParam α
  });

  it("literal arg gets fresh alpha term", () => {
    const r = scan(`function f(p) { return p(5); }`);
    expect(r.sites[0]!.argTerms[0]!.op).toBe("lit");
  });

  it("direct call on existing fn shape only records site", () => {
    const r = scan(`function f(p, x) { p(1); p(2); }`);
    expect(r.fnRels.size).toBe(1);
    expect(r.sites.length).toBe(2);
  });
});

describe("promote-scan: HOF callback (挂载点③)", () => {
  it("map callback param promotes to fn([α], B:cb)", () => {
    const r = scan(`function f(items, cb) { return items.map(cb); }`);
    const fn = r.fnRels.get("cb")?.abs;
    expect(fn?.shape.k).toBe("fn");
    const s = fn!.shape as { returnType?: { term?: { id?: string } } };
    expect(s.returnType?.term?.id).toBe("B:cb");
  });

  it("filter callback returnType is boolean", () => {
    const r = scan(`function f(items, cb) { return items.filter(cb); }`);
    const s = r.fnRels.get("cb")!.abs.shape as { returnType?: { shape?: { k: string } } };
    expect(s.returnType?.shape?.k).toBe("prim");
  });

  it("non-param callback does not promote", () => {
    const r = scan(`function f(items) { const g = x => x; return items.map(g); }`);
    expect(r.fnRels.size).toBe(0);
  });
});

describe("promote-scan: arrival-first and boundaries", () => {
  it("first promotion wins (direct-call then arr usage refuses)", () => {
    const r = scan(`function f(p, x) { p(x); return p.map(y => y); }`);
    expect(r.fnRels.has("p")).toBe(true);
    expect(r.entryShapes.has("p")).toBe(false);
  });

  it("refine-shaped param refuses promotion", () => {
    const file = parseSource(`function f(items) { return items.map(x => x); }`);
    const decl = (file.program.body as Array<{ type: string; id?: { name: string } | null; body: never }>).find(
      (s) => s.type === "FunctionDeclaration" && s.id?.name === "f",
    )!;
    const initial = new Map([
      ["items", abs({ k: "tuple", elements: [] }, undefined, undefined, "exact") as never],
    ]);
    const r = scanPromotions(decl.body, ["items"], ["A1"], initial);
    expect(r.promotedShapes.size).toBe(0);
    expect(r.entryShapes.size).toBe(0);
  });

  it("inline arrow body participates; nested function declaration does not", () => {
    const r = scan(`function f(items) {
      const r = items.map(x => x.length);
      function helper(a) { return a.map(y => y); }
      return r;
    }`);
    expect(r.entryShapes.has("items")).toBe(true);
    expect(r.entryShapes.has("a")).toBe(false);
  });
});
