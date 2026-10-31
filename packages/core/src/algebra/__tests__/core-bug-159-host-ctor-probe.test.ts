/**
 * BUG-159：`new Storage()` 被引擎判成 brand `Storage`（自信的错值），
 * 与 `new globalThis.Storage()` 的诚实结论自相矛盾。修复：宿主全局构造器
 * 走宿主可构造性探针 ⇒ 不再把未建模宿主全局当确定类值。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export function s1() { return new Storage(); }
export function s2() { return new globalThis.Storage(); }
`;

describe("BUG-159 host global constructor probe", () => {
  it("bare host ctor is not reported as a confident brand", () => {
    const r = checkSource("/t/bug-159.js", SRC, pTrue);
    expect(sigOf(r, "s1")).not.toBe("Storage");
    expect(sigOf(r, "s2")).not.toBe("Storage");
  });
});
