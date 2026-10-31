/**
 * BUG-177：派生构造器 `return {obj}` 时，ES 返回值语义应先于「必须调用
 * super()」门 ⇒ 合法代码被误报必抛。修复：按 ES [[Construct]] 顺序。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export class BaseB { constructor(){ this.p = 1; } }
export class DerivedB extends BaseB {
  constructor(){ return { q: 1 }; }
}
export function derivedReturnObj() { return new DerivedB(); }
`;

describe("BUG-177 derived constructor returning an object", () => {
  it("returns the explicit object instead of may-throw", () => {
    const r = checkSource("/t/bug-177.js", SRC, pTrue);
    expect(sigOf(r, "derivedReturnObj")).toBe("{ q: 1 }");
    expect(sigOf(r, "DerivedB")).toBe("DerivedB");
    expect(sigOf(r, "BaseB")).toBe("BaseB");
    expect(r.issues.filter((i) => i.code === "nudo:entry-may-throw")).toHaveLength(0);
  });
});
