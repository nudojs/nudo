/**
 * Bug 252 —— `String.prototype.search` / `match` 的**无效字符串模式**必须
 * 进 throws 面（确定 SyntaxError）。
 *
 * 根因：`exec/class-regex.ts` 的 `stringRegexMethod` 把模式编译失败
 * `catch { return undefined }` ——「编译失败」与「本臂不接管」混成同一
 * 哨兵 ⇒ 回落抽象臂（search → numPrim / match → matchResultDomain）
 * ⇒ **throws 域折 never**（假 no-throw，L2 门禁假绿）。
 *
 * 原生：`"abc".search("(")` / `.match("(")` / `.match("*")` 全部抛
 * **SyntaxError**（RegExpCreate 步 2：编译非法模式）。
 *
 * 修法：
 * - `class-regex.ts`：编译失败 → `throw new NudoThrow(errorTypeAbs("SyntaxError"))`
 *   （模式在此恒为**字面量** ⇒ 编译结果运行时同款 ⇒ 定抛，可被 try/catch 吸收）。
 * - `algebra/methods.ts`：抽象接收者路径（`stringRegexMethod` 在其 sv 检查
 *   处提前 return，够不到编译点）补 `literalPatternString` +
 *   `regexPatternCompiles` 判定 ⇒ 同样定抛。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call, throwsError } from "../../__tests__/eval-helpers.ts";

describe("Bug 252: invalid string pattern is a definite SyntaxError", () => {
  it("search(\"(\") → SyntaxError（此前 throws 域折 never）", () => {
    const r = call(`export function f() { return "abc".search("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("match(\"(\") → SyntaxError", () => {
    const r = call(`export function f() { return "abc".match("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("match(\"*\") → SyntaxError（非法量词）", () => {
    const r = call(`export function f() { return "abc".match("*"); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("matchAll(\"(\") → SyntaxError", () => {
    const r = call(`export function f() { return [..."abc".matchAll("(")].length; }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("抽象接收者路径同样进 throws 面", () => {
    const r = call(`export function f() { return String("abc").search("("); }`);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("合法模式不受影响（对照组）", () => {
    const r = call(`export function f() { return "abc".search("b"); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
    expect(r.throws === undefined || r.throws.shape.k === "never").toBe(true);
  });

  it("try/catch 可吸收（原生同款）", () => {
    const r = call(`export function f() {
      try { return "abc".search("("); } catch (e) { return e.constructor.name; }
    }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "SyntaxError" });
  });
});
