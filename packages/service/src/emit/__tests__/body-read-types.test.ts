/**
 * body-read 字段类型推断：用法 → constraint builder（草稿 / quickfix 自动填）。
 */
import { describe, it, expect } from "vitest";
import {
  collectParamBodyReadTypes,
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
});
