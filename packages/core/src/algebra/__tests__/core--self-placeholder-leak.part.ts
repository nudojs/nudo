/**
 * Bug 337 —— `length()` 用内部占位符 `__nudo_self__`（`SELF`）表达长度界，
 * 而 `substTerm` 只替换 `var` 与 `app("get", …)` 两种形态，**不递归
 * `app("length", […])` 的实参** ⇒ 占位符原样进入实例化谓词与产品 `expected`
 * 文本（内部实现细节泄漏进用户可见输出）。
 *
 * 修法（core/algebra/constraint.ts）：占位符替换递归进应用项实参
 * （`substSelf`），谓词替换递归进 `and` / `or` / `not` 分支。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import {
  SELF,
  instantiateConstraint,
  instantiateOnTerm,
  string,
  union,
} from "../constraint.ts";
import { predToString } from "../pred.ts";
import { v } from "../term.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

describe("Bug 337：__nudo_self__ 占位符不得泄漏进实例化谓词 / 产品文本", () => {
  it("string().min(2) 实例化不含内部占位符", () => {
    const p = predToString(instantiateConstraint(string().min(2), "s"));
    expect(p).not.toContain(SELF);
    expect(p).toContain("length(s) ≥ 2");
  });

  it("string().length(3) 实例化不含内部占位符", () => {
    const p = predToString(instantiateConstraint(string().length(3), "s"));
    expect(p).not.toContain(SELF);
  });

  it("instantiateOnTerm（项级实例化）同样替换占位符", () => {
    const p = predToString(instantiateOnTerm(string().min(2), v("u")));
    expect(p).not.toContain(SELF);
  });

  it("union 成员里的长度界也替换掉占位符（or 分支递归）", () => {
    const p = predToString(
      instantiateConstraint(union(string().min(2), string().max(5)), "s"),
    );
    expect(p).not.toContain(SELF);
  });

  it("产品面：expected 文本不含内部占位符", () => {
    const r = checkSource(
      "/t/f.js",
      `/// @nudo:import { shortStr } from "./std.nudo.js"
/** @nudo:contract s shortStr */
function needsShort(s) { return s; }
needsShort("abcd");
`,
      pTrue,
      sidecarOpts("std.nudo.js", `export const shortStr = string().max(3);`),
    );
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.code === "nudo:constraint-violated",
    );
    expect(errs.length).toBeGreaterThan(0);
    for (const e of errs) {
      expect(e.expected ?? "").not.toContain(SELF);
      expect(e.message).not.toContain(SELF);
    }
  });
});
