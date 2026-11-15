/**
 * BUG-165：符号成员（@@matchAll / @@iterator …）读面说「有」，调用面查的是
 * 另两张表 ⇒ 判「确定不存在」⇒ hard throw TypeError（对永不抛的代码报假红）。
 * 修复：读面说存在的符号成员，调用面不得声称缺失（brand 接收者折 unknown /
 * 迭代器面）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export function sMatchAllType() { return typeof /a/g[Symbol.matchAll]; }
export function sMatchAll() { return /a/g[Symbol.matchAll]("a"); }
export function sMatch() { return /a/g[Symbol.match]("a"); }
export function sSearch() { return /a/g[Symbol.search]("a"); }
export function sReplace() { return /a/g[Symbol.replace]("a", "b"); }
export function sSplit() { return /a/g[Symbol.split]("a"); }
export function sDatePrim() { return new Date(0)[Symbol.toPrimitive]("number"); }
export function sUspIter() { return new URLSearchParams("a=1")[Symbol.iterator](); }
export function sTaIter() { return new Uint8Array(2)[Symbol.iterator](); }
export function sMapIter() { return new Map()[Symbol.iterator](); }
`;

describe("BUG-165 symbol member call face", () => {
  it("no hard TypeError for registered symbol members", () => {
    const r = checkSource("/t/bug-165.js", SRC, pTrue);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(0);
  });

  it("iterator member calls yield an iterator face (not undefined)", () => {
    const r = checkSource("/t/bug-165.js", SRC, pTrue);
    expect(sigOf(r, "sUspIter")).toContain("next");
    expect(sigOf(r, "sTaIter")).toContain("next");
    expect(sigOf(r, "sMapIter")).toContain("next");
    expect(sigOf(r, "sMatchAllType")).toBe('"function"');
  });
});
