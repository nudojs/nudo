/**
 * Bug 269 —— **假阳性钉**（反向钉）：`String.prototype.search` / `match`
 * 传**显式 undefined** 模式时按 ES2023 `RegExpCreate` 语义折叠。
 *
 * 报告结论复核：`exec/class-regex.ts` 的 `stringRegexMethod` 里
 * `litTerm.value === undefined ? "" : String(litTerm.value)` —— 这**已是
 * Bug 179 的空模式修复**（修入 6ec8afc6）：ES2023 `RegExpCreate` 规定
 * pattern 为 undefined ⇒ P = ""（**不是** "undefined"）。报告引用的
 * 「`String(litTerm.value)` 把 undefined 变 "undefined"」在当前树**不成立**
 * ⇒ **不改实现**，只钉住「已修」的行为（本钉在 HEAD 只读副本上**必须通过**）。
 *
 * 原生：`"abc".search(undefined)` → 0（空模式在 0 处匹配）；
 * `"abc".match(undefined)` → [""]（长度 1、下标 0 是空串）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "../../abs.ts";
import { call } from "../../__tests__/eval-helpers.ts";

describe("Bug 269 (false positive): explicit undefined pattern is the empty pattern", () => {
  it("search(undefined) → 0（空模式在 0 处匹配）", () => {
    const r = call(`export function f() { return "abc".search(undefined); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("search(void 0) → 0", () => {
    const r = call(`export function f() { return "abc".search(void 0); }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
  });

  it("match(undefined)[0] → \"\"", () => {
    const r = call(`export function f() { return "abc".match(undefined)[0]; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: "" });
  });

  it("match(undefined).length → 1", () => {
    const r = call(`export function f() { return "abc".match(undefined).length; }`);
    expect(litValue(r.result)).toEqual({ ok: true, value: 1 });
  });
});
