/**
 * Bug 377 —— `nudo check --json` 的 `signatures[].detail` **串号**：共享同一
 * `never` Abs（模块级单例）的第 2、3 个函数显示的是**第一个函数的名字** ⇒
 * JSON 信封**字段间自相矛盾**（`name` 与 `detail` 对不上）。
 *
 * 根因：`sigFormatCache`（`WeakMap<Abs, {display, detail}>`）按 **Abs 对象
 * 身份**缓存，但缓存值 `detail` **内嵌函数名**（`formatAbsMultiline(abs,
 * name)`）⇒ 缓存键必须覆盖值的全部依赖。
 *
 * 修法（core/algebra/check-signatures.ts）：缓存键改为 **(Abs 身份, 函数名)**
 * （WeakMap<Abs, Map<name, entry>>）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

const SRC = `
export function a() { throw new Error("x"); }
export function b() { throw new Error("y"); }
export function c() { throw new Error("z"); }
`;

describe("Bug 377：签名 detail 不得串号（共享 never Abs 的第 2/3 个函数）", () => {
  it("三个函数的 detail 各自带自己的名字", () => {
    const r = checkSource("/t/bug377.js", SRC, pTrue);
    const sigs = r.signatures.filter((s) => ["a", "b", "c"].includes(s.name));
    expect(sigs.length).toBe(3);
    for (const s of sigs) {
      expect(s.detail.split("\n")[0]).toBe(s.name);
    }
  });

  it("detail 的首行与 name 一致（JSON 信封字段间不矛盾）", () => {
    const r = checkSource("/t/bug377.js", SRC, pTrue);
    const json = JSON.parse(
      JSON.stringify(r.signatures.map((s) => ({ name: s.name, detail: s.detail }))),
    ) as Array<{ name: string; detail: string }>;
    for (const s of json) {
      expect(s.detail.startsWith(`${s.name}\n`)).toBe(true);
    }
  });
});
