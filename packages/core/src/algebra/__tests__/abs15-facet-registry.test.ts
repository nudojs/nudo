/**
 * ABS-15：`AbsFacets` 槽位登记表（`key/facet-specs.ts`）的漂移门禁。
 *
 * 钉住三件事（缺任何一条都会退化成「靠人记」）：
 * 1. `FACET_SPECS` 覆盖 `AbsFacets` **全部**槽位，声明序 = `facetKey` 片段序；
 *    `satisfies Record<keyof AbsFacets, FacetSpec>` 让漏登记在编译期红，
 *    本文件另用 `SAMPLE` 的 `-?` 映射类型做第二道编译期覆盖检查。
 * 2. 键编码逐字节稳定：前缀 / 分隔符 / JSON 引号 / 缺省不出现。
 *    改序或改前缀 = 缓存键漂移，必须在这里显式改并说明。
 * 3. 等价副本按 `kind` 执行：标量与只读投影面共享，容器深/浅拷贝。
 */
import { describe, it, expect } from "vitest";
import { abs, cloneAbsFacets, numLit, strLit, type Abs, type AbsFacets } from "../abs.ts";
import { absKey, facetKey } from "../key/abs-key.ts";
import { FACET_SPECS, facetKeys } from "../key/facet-specs.ts";

const base = (): Abs => abs({ k: "prim", type: "number" }, undefined, undefined, "exact");

function withFacets(f: AbsFacets): Abs {
  const a = base();
  a.facets = f;
  return a;
}

/**
 * 每个槽位的代表值。`-?` 映射类型 = 编译期全覆盖检查：新增槽位不补这里
 * 直接 tsc 红（与 `FACET_SPECS` 的 `satisfies` 互为独立的两道门）。
 */
const SAMPLE: { [K in keyof AbsFacets]-?: AbsFacets[K] } = {
  callable: false,
  protoOwnKeys: { strings: ["constructor"], symbols: ["Symbol.iterator"] },
  brand: "Generator",
  genReturn: numLit(9),
  genNext: strLit("v"),
  genElements: [numLit(1)],
};

describe("ABS-15 · 登记表覆盖与声明序", () => {
  it("覆盖全部槽位（编译期 satisfies + 运行期键集）", () => {
    expect([...facetKeys()].sort()).toEqual(Object.keys(SAMPLE).sort());
    for (const key of facetKeys()) expect(FACET_SPECS[key]).toBeDefined();
  });

  it("声明序固定（= facetKey 片段序；改序即缓存键漂移）", () => {
    expect([...facetKeys()]).toEqual([
      "callable",
      "protoOwnKeys",
      "brand",
      "genReturn",
      "genNext",
      "genElements",
    ]);
  });

  it("kind 词汇表固定（新增 kind 须同时实现 facetKey / cloneFacets 两端）", () => {
    const kinds = [...new Set(Object.values(FACET_SPECS).map((s) => s.kind))].sort();
    expect(kinds).toEqual(["abs-list", "abs-ref", "flag", "string", "string-array-record"]);
  });
});

describe("ABS-15 · facetKey 编码逐字节稳定", () => {
  it("标量 / 键集槽位：前缀 + JSON 引号自定界", () => {
    expect(facetKey({ callable: true })).toBe("c:1");
    expect(facetKey({ callable: false })).toBe("c:0");
    expect(facetKey({ protoOwnKeys: { strings: ["a", "b"] } })).toBe('k:["a","b"]:[]');
    expect(
      facetKey({ protoOwnKeys: { strings: ["constructor"], symbols: ["Symbol.iterator"] } }),
    ).toBe('k:["constructor"]:["Symbol.iterator"]');
    expect(facetKey({ brand: "Generator" })).toBe('b:"Generator"');
  });

  it("组合槽位：顺序与分隔符（声明序，不依赖对象属性插入序）", () => {
    expect(
      facetKey({
        brand: "B",
        protoOwnKeys: { strings: ["a"], symbols: ["s"] },
        callable: false,
      }),
    ).toBe('c:0,k:["a"]:["s"],b:"B"');
  });

  it("Abs 槽位逐项编结构键（同值同键、异值异键）", () => {
    const one = numLit(1);
    const two = numLit(2);
    expect(facetKey({ genReturn: one })).toBe(`gr:${absKey(one)}`);
    expect(facetKey({ genNext: one })).toBe(`gn:${absKey(one)}`);
    expect(facetKey({ genElements: [one, two] })).toBe(`ge:${absKey(one)}|${absKey(two)}`);
    expect(absKey(withFacets({ genReturn: one }))).not.toBe(absKey(withFacets({ genReturn: two })));
    expect(absKey(withFacets({ genElements: [one] }))).not.toBe(
      absKey(withFacets({ genElements: [two] })),
    );
  });

  it("每个槽位单独启用都改变 absKey（漏登记 = 不同值共享 memo）", () => {
    const bare = absKey(base());
    for (const key of facetKeys()) {
      const a = withFacets({ [key]: SAMPLE[key] } as AbsFacets);
      expect(absKey(a), key).not.toBe(bare);
    }
  });

  it("空容器 ≡ 缺省（旧键逐字节不变）", () => {
    expect(facetKey({})).toBe("");
    expect(absKey(withFacets({}))).toBe(absKey(base()));
    expect(cloneAbsFacets({})).toEqual({});
  });
});

describe("ABS-15 · 等价副本按 kind 搬运", () => {
  it("标量槽位按值搬运", () => {
    expect(cloneAbsFacets({ callable: true, brand: "G" })).toEqual({
      callable: true,
      brand: "G",
    });
  });

  it("string-array-record 深拷贝容器；symbols 缺省保持缺省", () => {
    const src: AbsFacets = { protoOwnKeys: { strings: ["a"] } };
    const copy = cloneAbsFacets(src)!;
    copy.protoOwnKeys!.strings.push("b");
    expect(src.protoOwnKeys!.strings).toEqual(["a"]);
    expect("symbols" in copy.protoOwnKeys!).toBe(false);

    const withSyms: AbsFacets = { protoOwnKeys: { strings: [], symbols: ["s"] } };
    const copy2 = cloneAbsFacets(withSyms)!;
    copy2.protoOwnKeys!.symbols!.push("t");
    expect(withSyms.protoOwnKeys!.symbols).toEqual(["s"]);
  });

  it("abs-ref 只读投影面按引用共享", () => {
    const src: AbsFacets = { genReturn: numLit(9), genNext: strLit("v") };
    const copy = cloneAbsFacets(src)!;
    expect(copy.genReturn).toBe(src.genReturn);
    expect(copy.genNext).toBe(src.genNext);
  });

  it("abs-list 浅拷贝数组、元素按引用共享", () => {
    const src: AbsFacets = { genElements: [numLit(1), strLit("s")] };
    const copy = cloneAbsFacets(src)!;
    copy.genElements!.push(numLit(2));
    expect(src.genElements).toHaveLength(2);
    expect(copy.genElements![0]).toBe(src.genElements![0]);
  });

  it("全槽位容器：六项全在且顺序 = 声明序", () => {
    const copy = cloneAbsFacets(SAMPLE)!;
    expect(Object.keys(copy)).toEqual([...facetKeys()]);
    expect(copy).toEqual(SAMPLE);
  });

  it("缺省返回 undefined", () => {
    expect(cloneAbsFacets(undefined)).toBeUndefined();
  });
});
