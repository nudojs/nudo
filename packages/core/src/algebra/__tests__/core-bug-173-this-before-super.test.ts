/**
 * BUG-173：派生构造器在 `super()` 之前访问 `this` ⇒ 原生必抛 ReferenceError，
 * 但门只在 return 路径上 ⇒ 漏判。修复：`this` 可达性由 pending-super 标记
 * 在每次成员读/写/调用时断言（`$get`/`$set`/`$invoke` 包装）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { sigOf } from "./nudo-constraints.ts";

const SRC = `
export class BaseX { constructor(){ this.p = 1; } }
export class DerivedX extends BaseX {
  constructor(){ this.q = 2; super(); }
}
export function derivedThisBeforeSuper(){ return new DerivedX(); }
`;

describe("BUG-173 this before super()", () => {
  it("derived constructor and its call site may throw ReferenceError", () => {
    const r = checkSource("/t/bug-173.js", SRC, pTrue);
    expect(sigOf(r, "derivedThisBeforeSuper")).toBe("never throws ReferenceError");
    expect(sigOf(r, "DerivedX")).toBe("DerivedX throws ReferenceError");
    expect(sigOf(r, "BaseX")).toBe("BaseX");
  });

  it("normal derived constructors stay total", () => {
    const ok = checkSource(
      "/t/bug-173-ok.js",
      `
export class A { constructor(){ this.a = 1; } }
export class B extends A { constructor(){ super(); this.b = 2; } }
export function mkB(){ return new B(); }
`,
      pTrue,
    );
    expect(sigOf(ok, "mkB")).toBe("B");
  });
});
