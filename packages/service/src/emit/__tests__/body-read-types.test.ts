/**
 * body-read 字段类型推断：用法 → constraint builder（草稿 / quickfix 自动填）。
 */
import { describe, it, expect } from "vitest";
import {
  collectParamBodyReadTypes,
  collectParamContracts,
  contractDslOf,
  shapeDslFromFields,
} from "../body-read-types.ts";

describe("collectParamBodyReadTypes", () => {
  it("compare string lit → string(); bare return field → any()", () => {
    const map = collectParamBodyReadTypes(`
export function staticName(node) {
  return node.type === "Identifier" ? node.name : "";
}
`);
    const fields = map.get("staticName")?.get("node");
    expect(fields?.find((f) => f.field === "type")?.type).toBe("string()");
    // name 仅作返回值、无用法证据 → any()（不得武断 string()）
    expect(fields?.find((f) => f.field === "name")?.type).toBe("any()");
  });

  it("arith → number(); string method → string()", () => {
    const map = collectParamBodyReadTypes(`
export function f(o) {
  const a = o.count + 1;
  const b = o.label.toLowerCase();
  return a + b;
}
`);
    const fields = map.get("f")?.get("o");
    expect(fields?.find((f) => f.field === "count")?.type).toBe("number()");
    expect(fields?.find((f) => f.field === "label")?.type).toBe("string()");
  });

  it("typeof === 'number' → number()", () => {
    const map = collectParamBodyReadTypes(`
export function g(x) {
  if (typeof x.value === "number") return x.value;
  return 0;
}
`);
    const fields = map.get("g")?.get("x");
    expect(fields?.find((f) => f.field === "value")?.type).toBe("number()");
  });

  it("no type evidence → any()", () => {
    const map = collectParamBodyReadTypes(`
export function h(node) {
  return node.type;
}
`);
    const fields = map.get("h")?.get("node");
    expect(fields?.find((f) => f.field === "type")?.type).toBe("any()");
  });

  it(".length → union(string, array); .size → any()（不武断 string）", () => {
    const map = collectParamBodyReadTypes(`
export function k(o) {
  if (o.name.length > 0) return o.tags.size;
  return 0;
}
`);
    const fields = map.get("k")?.get("o");
    expect(fields?.find((f) => f.field === "name")?.type).toBe("union(string(), array(any()))");
    expect(fields?.find((f) => f.field === "tags")?.type).toBe("any()");
  });

  it("Array.isArray(param.field) → array(any())", () => {
    const map = collectParamBodyReadTypes(`
export function a(o) {
  return Array.isArray(o.items) ? o.items.length : 0;
}
`);
    const fields = map.get("a")?.get("o");
    expect(fields?.find((f) => f.field === "items")?.type).toBe("array(any())");
  });

  it("shapeDslFromFields fills types", () => {
    const dsl = shapeDslFromFields([
      { field: "type", type: "string()", via: "compare string lit" },
      { field: "id", type: "number()", via: "arith +" },
    ]);
    expect(dsl).toBe("shape({ type: string(), id: number() })");
  });

  // #76：嵌套成员路径 → 中间环生成为嵌套 shape（不得写 any()——
  // any 值上的成员读取仍记 may-throw，动作自废）
  it("nested member chain → intermediate fields are nested shapes", () => {
    const map = collectParamBodyReadTypes(`
export function locLine(node) {
  return node.loc.start.line;
}
`);
    const fields = map.get("locLine")?.get("node");
    const loc = fields?.find((f) => f.field === "loc");
    // 中间环：嵌套 shape 占位 + 子字段
    expect(loc?.type).toBe("shape({ … })");
    expect(loc?.fields?.find((f) => f.field === "start")?.type).toBe("shape({ … })");
    expect(
      loc?.fields?.find((f) => f.field === "start")?.fields?.find(
        (f) => f.field === "line",
      )?.type,
    ).toBe("any()");
    expect(shapeDslFromFields(fields ?? [])).toBe(
      "shape({ loc: shape({ start: shape({ line: any() }) }) })",
    );
  });

  it("method access on nested field types the leaf, chain stops there", () => {
    // node.a.b.toLowerCase()：b 是叶子（string()），a 是中间环
    const map = collectParamBodyReadTypes(`
export function lower(node) {
  return node.a.b.toLowerCase();
}
`);
    const fields = map.get("lower")?.get("node");
    const a = fields?.find((f) => f.field === "a");
    expect(a?.type).toBe("shape({ … })");
    expect(a?.fields?.find((f) => f.field === "b")?.type).toBe("string()");
    expect(shapeDslFromFields(fields ?? [])).toBe(
      "shape({ a: shape({ b: string() }) })",
    );
  });

  it("method access on first-level field stays flat (no phantom path)", () => {
    // node.label.toLowerCase()：label 直接是 string()，不生成
    // shape({ toLowerCase: … }) 幽灵路径
    const map = collectParamBodyReadTypes(`
export function f(o) {
  return o.label.toLowerCase();
}
`);
    const fields = map.get("f")?.get("o");
    expect(fields?.length).toBe(1);
    expect(fields?.[0]?.field).toBe("label");
    expect(fields?.[0]?.type).toBe("string()");
  });

  it("typeof on nested chain types the whole path", () => {
    const map = collectParamBodyReadTypes(`
export function g(node) {
  if (typeof node.a.b === "string") return node.a.b;
  return "";
}
`);
    const fields = map.get("g")?.get("node");
    const a = fields?.find((f) => f.field === "a");
    expect(a?.type).toBe("shape({ … })");
    expect(a?.fields?.find((f) => f.field === "b")?.type).toBe("string()");
  });

  it("standalone read + dereference of same field: nested shape wins", () => {
    const map = collectParamBodyReadTypes(`
export function f(node) {
  const tag = node.a;
  return node.a.b;
}
`);
    const fields = map.get("f")?.get("node");
    const a = fields?.find((f) => f.field === "a");
    expect(a?.type).toBe("shape({ … })");
    expect(a?.fields?.find((f) => f.field === "b")?.type).toBe("any()");
  });

  it("optional chain collects the same path", () => {
    const map = collectParamBodyReadTypes(`
export function opt(node) {
  return node?.loc?.start?.line;
}
`);
    const fields = map.get("opt")?.get("node");
    expect(
      fields?.find((f) => f.field === "loc")?.fields?.find(
        (f) => f.field === "start",
      )?.fields?.find((f) => f.field === "line")?.type,
    ).toBe("any()");
  });
});

// —— 数组方法接收者读（quickfix 数组形态证据面）——
// `items.reduce(…)` 是方法读不是字段读：进 shape 字段清单会发射
// `shape({ reduce: any() })`，写盘后 L2 永远证不出（fix-12）。
describe("array receiver evidence", () => {
  it("array method receiver read never becomes a shape field", () => {
    const map = collectParamBodyReadTypes(`
export function subtotal(items, tax) {
  return items.reduce((s, i) => s + i.price * i.qty, 0) * (1 + tax);
}
`);
    // items 无字段读（reduce 不是字段）；tax 无成员读 → 整函数无字段条目
    expect(map.get("subtotal")).toBeUndefined();
  });

  it("reduce receiver → array(shape(…)) from callback element param + scalar tax", () => {
    const contracts = collectParamContracts(`
export function subtotal(items, tax) {
  return items.reduce((s, i) => s + i.price * i.qty, 0) * (1 + tax);
}
`);
    const ev = contracts.get("subtotal");
    // reduce 元素位是第 2 形参（第 1 位是累加器 s，不进元素 shape）
    expect(contractDslOf(ev?.get("items")!)).toBe(
      "array(shape({ price: number(), qty: number() }))",
    );
    // tax 参与算术 → number()（多参逐位收窄：单写 items 消不掉 L2）
    expect(contractDslOf(ev?.get("tax")!)).toBe("number()");
    // 声明序：items 先于 tax
    expect([...ev!.keys()]).toEqual(["items", "tax"]);
  });

  it("map/filter callbacks merge element fields; nested deref stays nested shape", () => {
    const contracts = collectParamContracts(`
export function adultTags(users) {
  return users.filter((u) => u.age >= 18).map((u) => u.meta.tag).join(",");
}
`);
    const ev = contracts.get("adultTags")?.get("users");
    expect(contractDslOf(ev!)).toBe(
      "array(shape({ age: number(), meta: shape({ tag: any() }) }))",
    );
  });

  it("receiver without callback evidence → array(any())", () => {
    const contracts = collectParamContracts(`
export function joiner(items) {
  return items.join(", ");
}
`);
    expect(contractDslOf(contracts.get("joiner")?.get("items")!)).toBe(
      "array(any())",
    );
  });

  it("sort comparator: both callback params feed the element shape", () => {
    const contracts = collectParamContracts(`
export function sortBy(rows) {
  return rows.slice().sort((a, b) => a.n - b.n);
}
`);
    expect(contractDslOf(contracts.get("sortBy")?.get("rows")!)).toBe(
      "array(shape({ n: number() }))",
    );
  });

  it("nested array element: matrix.map(row => row.map(…)) → array(array(…))", () => {
    const contracts = collectParamContracts(`
export function flatPrices(matrix) {
  return matrix.map((row) => row.map((x) => x.p * 2)).flat();
}
`);
    expect(contractDslOf(contracts.get("flatPrices")?.get("matrix")!)).toBe(
      "array(array(shape({ p: number() })))",
    );
  });

  it("plain object field read stays shape (non-array unchanged)", () => {
    const contracts = collectParamContracts(`
export function getName(u) {
  return u.name;
}
`);
    expect(contractDslOf(contracts.get("getName")?.get("u")!)).toBe(
      "shape({ name: any() })",
    );
  });

  it("bare receiver reference (not called) is not array evidence", () => {
    // `items.reduce` 未在调用位：无数组证据，退化为普通字段读
    const contracts = collectParamContracts(`
export function ref(items) {
  const m = items.reduce;
  return typeof m;
}
`);
    const ev = contracts.get("ref")?.get("items");
    expect(ev?.kind).toBe("shape");
  });
});
