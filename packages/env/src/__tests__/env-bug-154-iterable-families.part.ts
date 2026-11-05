import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { checkWeb } from "./env-bug-s1-helpers.ts";
import { checkNode, slotOfAbs, instanceFaceOf } from "./env-bug-1044-1049-helpers.ts";

/**
 * 族 15 · BUG-154 — `Headers` / `FormData` 的 `keys` / `values` / `entries`
 * 在 WHATWG 规范里返回**迭代器**，不是数组。
 *
 * - node 面声明成 `arrOf(...)` ⇒ `Array.isArray(h.keys())` 折 **true**
 *   （宿主 false）、`k.length` 折 `number`（宿主 undefined）⇒ 自信的错值；
 * - web 面声明成 `unknown` ⇒ 可迭代性分类落 "may" ⇒ `[...h.keys()]` 记
 *   may-throw TypeError ⇒ **假红**（挡住合法的 `for…of` / 展开）。
 *
 * 修法：两面统一为**迭代器面**（带 `@@iterator` 槽的 obj ⇒ core 判 total）。
 *
 * 反向钉：把 keys 改回 `arrOf(...)` ⇒ `Array.isArray` 断言的 false 会挂。
 */
function host(script: string): string {
  return execFileSync(process.execPath, ["-e", script], { encoding: "utf-8" }).trim();
}

describe("Bug 154 — Headers/FormData iterators are not arrays (both envs)", () => {
  it("host oracle: keys() is an Iterator, not an Array", () => {
    const out = host(`
      const h = new Headers({ a: "b" });
      const k = h.keys();
      console.log(JSON.stringify({
        isArray: Array.isArray(k),
        length: typeof k.length,
        ctor: k.constructor.name,
        first: [...k][0],
      }));
    `);
    expect(JSON.parse(out)).toEqual({
      isArray: false,
      length: "undefined",
      ctor: "Iterator",
      first: "a",
    });
  });

  it("node: Array.isArray(headers.keys()) folds to false (was true)", () => {
    const out = checkNode(`export function f(){
  const h = new Headers({ a: "b" });
  return Array.isArray(h.keys());
}`);
    expect(out.signatures[0]!.display).toBe("false");
  });

  it("node: keys() has no array length / index (was number / string)", () => {
    const out = checkNode(`export function f(){
  const h = new Headers({ a: "b" });
  const k = h.keys();
  return [k.length, k[0]];
}`);
    const d = out.signatures[0]!.display;
    expect(d).not.toContain("number");
    expect(d).not.toContain("string");
  });

  it("node: the declared face is an iterator object (has @@iterator), not arr", () => {
    const keys = slotOfAbs(instanceFaceOf("Headers"), "keys");
    const ret = (keys!.shape as { returnType?: { shape: { k: string; slots?: Record<string, unknown> } } }).returnType;
    expect(ret?.shape.k).toBe("obj");
    expect(Object.keys(ret!.shape.slots ?? {})).toContain("@@iterator");
  });

  it("web: spreading headers.keys() is legal (was may-throw TypeError)", () => {
    const out = checkWeb(`export function f(){
  const h = new Headers({ a: "b" });
  return [...h.keys()].length;
}`);
    expect(out.signatures[0]!.display).toBe("number");
    expect(out.throwBrands).toEqual([]);
  });

  it("FormData entries are iterators too (both envs)", () => {
    const node = checkNode(`export function f(){
  const d = new FormData();
  return Array.isArray(d.entries());
}`);
    expect(node.signatures[0]!.display).toBe("false");
    const web = checkWeb(`export function f(){
  const d = new FormData();
  d.append("a", "b");
  return [...d.entries()].length;
}`);
    expect(web.throwBrands).toEqual([]);
    expect(slotOfAbs(instanceFaceOf("FormData"), "entries")).toBeTruthy();
  });
});
