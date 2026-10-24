/**
 * Bug 1070 —— L2 实例方法桥把**构造器**的 throws 归因到方法体 ⇒ 普通类即触发
 * error 级 `nudo:entry-may-throw`（CI 闸门假红）。
 *
 * 根因：check-may-throw.ts 的实例方法桥执行
 * `$new(clsAbs, ctorAnyArgs(file, clsName))` ⇒ 构造器实参**一律补 `any`**
 * ⇒ 构造器体内的任何强制转换（`x + 1` / `x > 0` / `"a" + x` / `x.toFixed()`）
 * 都产 TypeError ⇒ 那被算进**方法**的 throws 域。
 *
 * 三个错：
 * ① 归因错——TypeError 来自构造器，`Account.describe` 本身不抛；
 * ② 该 TypeError 是 `any` 实参的**假象**（真实调用点传 number 时构造器 total）；
 * ③ 该诊断是 error 级（CLAUDE.md：L2 entry may-throw 默认 error）⇒ 卡死用户 CI。
 *
 * 修法：构造器改在**独立 may-throw 会话**里跑（软效果与硬抛都不归因给方法），
 * 方法体自身的证据照常收集（闸门不整体关掉）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { stdOpts, l2Count, sigOf } from "./nudo-constraints.ts";
import { evalThrowsOutcome } from "../check-may-throw.ts";
import { parseSource } from "../parse-source.ts";
import { throwAbsToKinds } from "../may-throw.ts";

const acctSrc = `export class Account {
  constructor(balance) { this.balance = balance + 1; }
  describe() { return "acct"; }
}
`;

describe("Bug 1070：实例方法桥不得把构造器的 throws 归因到方法", () => {
  it("构造器做算术 ⇒ 方法入口不再报 nudo:entry-may-throw（改前：error 级 1 条）", () => {
    const r = checkSource("acct.js", acctSrc, pTrue, stdOpts);
    expect(l2Count(r, "Account.describe")).toBe(0);
    expect(r.issues.filter((i) => i.severity === "error")).toHaveLength(0);
    expect(sigOf(r, "Account.describe")).not.toContain("throws");
  });

  it("构造器做比较 / 字符串拼接 / 成员调用 ⇒ 同上（都只算构造器的账）", () => {
    const variants = [
      `export class A { constructor(x) { this.v = x > 0; } describe() { return "a"; } }`,
      `export class A { constructor(x) { this.v = "a" + x; } describe() { return "a"; } }`,
      `export class A { constructor(x) { this.v = x.toFixed(); } describe() { return "a"; } }`,
    ];
    for (const src of variants) {
      const r = checkSource("acct.js", src, pTrue, stdOpts);
      expect(l2Count(r, "A.describe")).toBe(0);
    }
  });

  it("构造器显式 throw ⇒ 也不归因给方法（那是 `new C()` 入口的事）", () => {
    const src = `export class A {
  constructor(x) { throw new TypeError("ctor"); }
  describe() { return "a"; }
}`;
    const r = checkSource("acct.js", src, pTrue, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(0);
  });

  it("方法体**自己**会抛 ⇒ 仍要报（闸门不整体关掉）", () => {
    const src = `export class A {
  constructor(x) { this.v = x; }
  describe() { throw new TypeError("m"); }
}`;
    const r = checkSource("acct.js", src, pTrue, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(1);
    const issue = r.issues.find(
      (i) => i.code === "nudo:entry-may-throw" && i.fn === "A.describe",
    );
    expect(issue?.severity).toBe("error");
    expect(sigOf(r, "A.describe")).toContain("throws TypeError");
  });

  it("方法体读构造器写入的字段（any）⇒ 成员调用仍报（构造器仍要跑）", () => {
    const src = `export class A {
  constructor(x) { this.v = x; }
  describe() { return this.v.toFixed(); }
}`;
    const r = checkSource("acct.js", src, pTrue, stdOpts);
    expect(l2Count(r, "A.describe")).toBe(1);
  });

  it("静态方法口径不变（静态桥不跑构造器 ⇒ 它自己的算术照报）", () => {
    const src = `export class A {
  constructor(x) { this.v = x + 1; }
  static make(y) { return y + 1; }
}`;
    const r = checkSource("acct.js", src, pTrue, stdOpts);
    expect(l2Count(r, "A.make")).toBe(1);
  });

  it("单元层：实例方法的 throws 域不含构造器的 TypeError", () => {
    const file = parseSource(acctSrc);
    const out = evalThrowsOutcome(acctSrc, "Account.describe", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") return;
    expect(throwAbsToKinds(out.result.throws)).toEqual([]);
  });

  it("单元层：方法体自己的 throw 仍在 throws 域里", () => {
    const src = `export class A {
  constructor(x) { this.v = x + 1; }
  describe() { throw new TypeError("m"); }
}`;
    const file = parseSource(src);
    const out = evalThrowsOutcome(src, "A.describe", [], {}, pTrue, file);
    expect(out.kind).toBe("analyzed");
    if (out.kind !== "analyzed") return;
    expect(throwAbsToKinds(out.result.throws)).toEqual(["TypeError"]);
  });
});
