/**
 * Bug 996 —— core 的 CJS 对象字面量收集器把 **getter / setter**（`ObjectMethod`
 * 的 `kind` 是 `get` / `set`）当成**导出函数** ⇒ `nudo check` **凭空造出**
 * `f() => unknown`（getter）/ `f(v: any) => unknown`（setter）+ **假的 L2
 * `nudo:entry-may-throw`**（假红，exit 1）⇒ 而 dts / health 面（service 普查）
 * 根本没有这个导出 ⇒ **两面矛盾**。
 *
 * 根因：`scan-top-functions.ts` 的 CJS 对象字面量收集段只看 `prop2.type`，**不看
 * `prop2.kind`** ⇒ getter / setter（不是可调用入口）进了普查。
 *
 * 修法：收集段排除 `kind === "get" / "set"`（与 service 侧 `analyzer-ast.ts`
 * 的 `module.exports = { … }` 分支同口径 —— 那边本来就判 `prop.kind !== "method"`）。
 */
import { describe, it, expect } from "vitest";
import { listTopFunctions } from "../scan.ts";
import { issuesOf } from "./nudo-constraints.ts";

const GETTER = `module.exports = {
  get f() {
    return 1;
  },
};
`;

const SETTER = `module.exports = {
  set f(v) {
    this._v = v;
  },
};
`;

const PLAIN_METHOD = `module.exports = {
  f() {
    return 1;
  },
};
`;

describe("Bug 996 — CJS getter / setter 不是可调用入口", () => {
  it("getter 不进普查", () => {
    expect(listTopFunctions(GETTER)).toEqual([]);
  });

  it("setter 不进普查", () => {
    expect(listTopFunctions(SETTER)).toEqual([]);
  });

  it("普通方法仍进普查（对照）", () => {
    expect(listTopFunctions(PLAIN_METHOD)).toEqual(["f"]);
  });

  it("getter ⇒ check 不造假的入口 may-throw（无 error）", () => {
    const r = issuesOf(GETTER, "/t/b996/getter.js");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.signatures.filter((s) => s.name === "f")).toEqual([]);
  });

  it("setter ⇒ check 不造假的入口 may-throw（无 error）", () => {
    const r = issuesOf(SETTER, "/t/b996/setter.js");
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.signatures.filter((s) => s.name === "f")).toEqual([]);
  });
});
