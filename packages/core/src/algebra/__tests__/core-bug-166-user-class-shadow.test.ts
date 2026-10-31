/**
 * BUG-166：`$new` 先查内建派发表、从不查用户类注册表 ⇒ 用户同名类被内建
 * 构造器吞掉（`class URL {}` 的实例被判成 host URL）。修复：用户类优先。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export function shadowUrl() { class URL { constructor() { this.a = 1; } } return new URL(); }
export function shadowError() { class Error { constructor() { this.a = 1; } } return new Error(); }
export function shadowMap() { class Map { constructor() { this.a = 1; } } return new Map(); }
export function shadowDate() { class Date { constructor() { this.a = 1; } } return new Date(); }
export function shadowPromise() { class Promise { constructor() { this.a = 1; } } return new Promise(); }
`;

describe("BUG-166 user class shadows host global", () => {
  it("every same-named user class wins over the builtin dispatch table", () => {
    const r = checkSource("/t/bug-166.js", SRC, pTrue);
    expect(sigOf(r, "shadowUrl")).toBe("URL");
    expect(sigOf(r, "shadowError")).toBe("Error");
    expect(sigOf(r, "shadowMap")).toBe("Map");
    expect(sigOf(r, "shadowDate")).toBe("Date");
    expect(sigOf(r, "shadowPromise")).toBe("Promise");
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});
