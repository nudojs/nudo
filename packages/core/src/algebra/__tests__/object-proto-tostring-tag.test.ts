/**
 * Object.prototype.toString 的**标签面**与接收者值域的一致性。
 *
 * 缺陷背景：`typeTagOf` 只覆盖 lit / prim / arr / tuple / fn / eff / brand /
 * obj，函数末尾对 sum / any / unknown / never 一律返回 "Object" ⇒ 调用侧
 * `strLit("[object " + tag + "]")` 把兜底当确切字面量发布：联合接收者
 * （number | string）折 `"[object Object]"`（原生只可能是 Number / String）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { formatShape, type Abs } from "../index.ts";
import { call, resetEngineCaches } from "./eval-helpers.ts";

const SRC = `export function f(v){ return Object.prototype.toString.call(v); }`;

function lit(kind: string, type?: string): Abs {
  return { shape: type ? { k: kind, type } : { k: kind }, conf: "exact" } as unknown as Abs;
}

function tagOf(arg: Abs): Abs {
  return call(SRC, "f", [arg]).result;
}

describe("Object.prototype.toString 标签面", () => {
  beforeEach(() => {
    resetEngineCaches();
  });

  it("BUG-197 联合接收者折标签联合，不得折单一 [object Object]", () => {
    const sum = {
      shape: { k: "sum", members: [lit("prim", "number"), lit("prim", "string")] },
      conf: "exact",
    } as unknown as Abs;
    expect(formatShape(tagOf(sum))).toBe('"[object Number]" | "[object String]"');
  });

  it("BUG-197 any / unknown 接收者退宽域 string（标签随运行时值而变）", () => {
    for (const k of ["any", "unknown"]) {
      const r = tagOf(lit(k));
      expect(formatShape(r)).toBe("string");
      expect(r.conf).not.toBe("exact");
    }
  });

  it("BUG-197 空域（never）不发布确切标签", () => {
    expect(formatShape(tagOf(lit("never")))).toBe("string");
  });

  it("具体形状仍折确切标签（字面量 / prim / 数组不受影响）", () => {
    expect(formatShape(tagOf(lit("prim", "number")))).toBe('"[object Number]"');
    expect(formatShape(tagOf(lit("prim", "bigint")))).toBe('"[object BigInt]"');
    const arr = {
      shape: { k: "tuple", elements: [lit("prim", "number")] },
      conf: "exact",
    } as unknown as Abs;
    expect(formatShape(tagOf(arr))).toBe('"[object Array]"');
  });
});
