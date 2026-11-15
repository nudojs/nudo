/**
 * Bug 365 —— `@nudo:throws Error` / `package.json#nudo.check.ignoreThrows =
 * ["Error"]` **盖不住用户自定义的 Error 子类** ⇒ L2 门禁**假红**（文档承诺
 * 「与 instanceof 语义一致 / 覆盖全部子类」）。
 *
 * 根因：`throwsKindCovered` 用**静态内建名集合** `ERROR_FAMILY` 判覆盖 ⇒
 * `class MyError extends Error {}` 不在集合内 ⇒ 「Error 盖整族」的承诺落空。
 *
 * 修法（core/algebra/may-throw.ts + core/algebra/exec/class-registry.ts）：
 * 沿**运行时继承链**判定（注册表 `superName` 链：`MyError.superName ===
 * "Error"`）⇒ 内建错误名 + 用户自定义 Error 子类都算 Error 家族。
 * 新判定函数**不**进三个公共入口 ⇒ 冻结面零变更。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { l2Count } from "./nudo-constraints.ts";

const MY_ERROR = `
class MyError extends Error {}
export function boom() { throw new MyError("x"); }
`;

const NOT_ERROR = `
class PlainProblem {}
export function boom() { throw new PlainProblem("x"); }
`;

const DEEP_ERROR = `
class BaseErr extends Error {}
class MidErr extends BaseErr {}
class LeafErr extends MidErr {}
export function boom() { throw new LeafErr("x"); }
`;

describe("Bug 365：Error 家族覆盖用户自定义 Error 子类", () => {
  it("@nudo:throws Error 盖住用户自定义 Error 子类", () => {
    const r = checkSource(
      "my-err.js",
      `
class MyError extends Error {}
/**
 * @nudo:throws Error
 */
export function boom() { throw new MyError("x"); }
`,
      pTrue,
    );
    expect(l2Count(r)).toBe(0);
  });

  it("ignoreThrows: ['Error'] 盖住用户自定义 Error 子类", () => {
    const r = checkSource("my-err.js", MY_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
  });

  it("多级继承（LeafErr → MidErr → BaseErr → Error）同样被盖住", () => {
    const r = checkSource("deep-err.js", DEEP_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(0);
  });

  it("非 Error 的用户类**不被** Error 盖住（不得过度覆盖）", () => {
    const r = checkSource("not-err.js", NOT_ERROR, pTrue, { ignoreThrows: ["Error"] });
    expect(l2Count(r)).toBe(1);
  });

  it("按类名精确申报仍生效（@nudo:throws MyError）", () => {
    const r = checkSource(
      "own-err.js",
      `
class MyError extends Error {}
/**
 * @nudo:throws MyError
 */
export function boom() { throw new MyError("x"); }
`,
      pTrue,
    );
    expect(l2Count(r)).toBe(0);
  });

  it("未申报也未忽略时仍报 L2（不得漏报）", () => {
    const r = checkSource("my-err.js", MY_ERROR, pTrue);
    expect(l2Count(r)).toBe(1);
  });
});
