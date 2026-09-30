/**
 * 结构扫描忽略字符串字面量 — 同类回归。
 * splitTopLevelArgs / findTopLevelColon / extractBalancedParens 只跟踪
 * 括号深度，不进字符串状态：引号内的逗号/冒号/括号被当结构切开。
 * 同类：findReplaceSeparator 已是 string-aware，此处是漏网同型点。
 */
import { describe, it, expect } from "vitest";
import { parse } from "../parse.ts";
import { extractDirectives } from "../directives.ts";
import { litValue } from "@nudojs/core";

function firstCase(source: string) {
  const results = extractDirectives(parse(source));
  const d = results[0]?.directives[0];
  if (!d || d.kind !== "case") throw new Error("expected case directive");
  return d;
}

describe("directive scanners must respect string literals", () => {
  it("comma inside string does not split args", () => {
    const d = firstCase(`
/**
 * @nudo:case "split" (["a,b", 1])
 */
function split(xs) { return xs; }
`);
    expect(d.argsAbs).toHaveLength(1);
    const tuple = d.argsAbs[0]!;
    expect(tuple.shape.k).toBe("tuple");
    if (tuple.shape.k !== "tuple") throw new Error("expected tuple");
    expect(tuple.shape.elements).toHaveLength(2);
    expect(litValue(tuple.shape.elements[0]!)).toEqual({ ok: true, value: "a,b" });
    expect(litValue(tuple.shape.elements[1]!)).toEqual({ ok: true, value: 1 });
  });

  it("paren inside string arg is kept as one string literal", () => {
    const d = firstCase(`
/**
 * @nudo:case "f" (")")
 */
function f(x) { return x; }
`);
    expect(d.argsAbs).toHaveLength(1);
    expect(litValue(d.argsAbs[0]!)).toEqual({ ok: true, value: ")" });
  });

  it("colon inside object key string is not a key separator", () => {
    const d = firstCase(`
/**
 * @nudo:case "obj" ({"a:b": 1})
 */
function f(o) { return o; }
`);
    const obj = d.argsAbs[0]!;
    expect(obj.shape.k).toBe("obj");
    if (obj.shape.k !== "obj") throw new Error("expected obj");
    expect(Object.keys(obj.shape.slots)).toEqual(["a:b"]);
    expect(litValue(obj.shape.slots["a:b"]!.value)).toEqual({ ok: true, value: 1 });
  });

  it("comma inside quoted string arg does not split", () => {
    const d = firstCase(`
/**
 * @nudo:case "csv" ("a,b", 2)
 */
function f(a, b) { return a; }
`);
    expect(d.argsAbs).toHaveLength(2);
    expect(litValue(d.argsAbs[0]!)).toEqual({ ok: true, value: "a,b" });
    expect(litValue(d.argsAbs[1]!)).toEqual({ ok: true, value: 2 });
  });
});
