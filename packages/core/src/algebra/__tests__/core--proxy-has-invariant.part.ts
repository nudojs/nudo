/**
 * Bug 218：Proxy `has` 陷阱缺 **ES 规范不变式** ⇒ 漏判必抛 TypeError ⇒ 假绿，
 * 并印出宿主不可能产出的值 `false`。
 *
 * ES2023 `[[HasProperty]]` 第 8 步：陷阱结果为 falsy 时取靶的
 * `[[GetOwnProperty]](P)`——存在且 `[[Configurable]]` 为 false ⇒ 定抛
 * `TypeError: 'has' on proxy: trap returned falsish for property 'x' which
 * exists in the proxy target as non-configurable`。
 *
 * 改前 `$in` 的 has 陷阱分支**只取返回值**就 `boolLit(truth)`（无不变式检查）
 * ⇒ `"x" in p` 判 `false` 且不抛：`nudo check` exit 0 假绿，值面还污染
 * `if (k in p)` 的控制流。同族不变式（get 的非配置+不可写、ownKeys 的重复项/
 * 漏键、deleteProperty 的非配置门）引擎都已实现——has 是唯一缺口。
 */
import { describe, it, expect } from "vitest";
import { call, throwsError, val } from "./eval-helpers.ts";

const hasSrc = (targetSetup: string, trapBody: string): string => `export function f(){
  const t = {};
  ${targetSetup}
  const p = new Proxy(t, { has() { return ${trapBody}; } });
  return "x" in p;
}`;

describe("Bug 218：Proxy has 陷阱的规范不变式", () => {
  it("靶上不可配置自有属性 + 陷阱返 false ⇒ 定抛 TypeError（改前：false，不抛）", () => {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: false, enumerable: true });`, "false"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("负控：同一陷阱 + 靶上该键**可配置** ⇒ 不抛，值 false（缺口只在这一格）", () => {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: true, enumerable: true });`, "false"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(val(hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: true });`, "false"))).toEqual({
      ok: true,
      value: false,
    });
  });

  it("负控：靶上**没有**该键 + 陷阱返 false ⇒ 不抛，值 false", () => {
    expect(throwsError(call(hasSrc("", "false")).throws, "TypeError")).toBe(false);
    expect(val(hasSrc("", "false"))).toEqual({ ok: true, value: false });
  });

  it("负控：陷阱返 true ⇒ 不触发不变式（该门只对 falsy 生效）", () => {
    const r = call(
      hasSrc(`Object.defineProperty(t, "x", { value: 1, configurable: false });`, "true"),
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});
