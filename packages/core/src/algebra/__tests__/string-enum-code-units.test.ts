/**
 * 字符串对象枚举必须按 UTF-16 code unit，不是 code point。
 * 回归背景：`{...str}` / Object.values / Object.entries 走 Array.from / for-of
 * （code point），而 Object.keys / Object.assign / for-in 用 length + [i]
 * （code unit）。astral 字符上键数量和取值分叉，引擎内部自相矛盾。
 * 真实 JS：String exotic own keys 是 code unit 下标。
 */
import { describe, it, expect } from "vitest";
import { runTranspiled, callTranspiledExportFull, litValue, formatShape } from "../index.ts";

function run(body: string) {
  const exports = runTranspiled(`export function __run() {\n${body}\n}`, { mode: "exec" });
  return callTranspiledExportFull(exports, "__run", []).result;
}

describe("string object enumeration uses code units", () => {
  it("{...str} on astral char has two keys (code units)", () => {
    const r = run(`return Object.keys({..."😀"});`);
    expect(formatShape(r)).toBe(`["0", "1"]`);
  });

  it("{...str} values are surrogate halves", () => {
    const r = run(`const o = {..."😀"}; return [o[0], o[1]];`);
    const els = (r as { shape: { elements: Array<{ term?: { value?: string } }> } }).shape.elements;
    expect(els.map((e) => e.term?.value)).toEqual(["\uD83D", "\uDE00"]);
  });

  it('Object.values("😀") is two code units', () => {
    const r = run(`return Object.values("😀");`);
    const els = (r as { shape: { elements: Array<{ term?: { value?: string } }> } }).shape.elements;
    expect(els.length).toBe(2);
    expect(els.map((e) => e.term?.value)).toEqual(["\uD83D", "\uDE00"]);
  });

  it('Object.entries("😀x") has three code-unit rows', () => {
    const r = run(`return Object.entries("😀x").map(e => e[0]);`);
    const els = (r as { shape: { elements: Array<{ term?: { value?: string } }> } }).shape.elements;
    expect(els.map((e) => e.term?.value)).toEqual(["0", "1", "2"]);
  });

  it("Object.keys and Object.values agree on length", () => {
    const k = run(`return Object.keys("😀").length;`);
    const v = run(`return Object.values("😀").length;`);
    expect(litValue(k)).toEqual({ ok: true, value: 2 });
    expect(litValue(v)).toEqual({ ok: true, value: 2 });
  });

  it("BMP string is unchanged (one key per char)", () => {
    const r = run(`return Object.keys({..."ab"});`);
    expect(formatShape(r)).toBe(`["0", "1"]`);
  });
});
