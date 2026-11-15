import { describe, it, expect } from "vitest";
import { checkWeb, ctorFlagOf, instanceSlotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 860 — web env 的浏览器构造器缺 `ctor: true`。
 *
 * 根因：`packages/env/src/web.ts` 把浏览器构造器建模成普通可调用 fn（`Response`
 * 甚至是 `objAbs`）⇒ `$new` 走「obj 非构造器 ⇒ 硬 TypeError」或「fn 无 ctor ⇒
 * 记 unknown-constructibility 假 may-throw」分支 ⇒ L2 门禁对**合法**浏览器代码
 * 报 error（假红）。
 *
 * 原生 oracle（node v26.10.0）：`new Request/Response/Headers/URLSearchParams/
 * EventTarget/Event/CustomEvent` 全部可构造，**不抛**。
 *
 * 反向钉：把 `ctor: true` 去掉（或把 Response 改回 objAbs）⇒ 本文件必挂。
 */
describe("Bug 860 — web browser constructors are constructible", () => {
  const CTORS = [
    "Request",
    "Response",
    "Headers",
    "URLSearchParams",
    "EventTarget",
    "Event",
    "CustomEvent",
  ] as const;

  it("new <ctor>() for every browser constructor yields 0 error diagnostics", () => {
    const out = checkWeb(`export function f() {
  const a = new Request("https://x.dev");
  const b = new Response();
  const c = new Headers();
  const d = new URLSearchParams("a=1");
  const e = new EventTarget();
  const g = new Event("x");
  const h = new CustomEvent("x");
  return [a, b, c, d, e, g, h];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("each browser constructor is declared as a fn carrying ctor: true", () => {
    for (const name of CTORS) {
      expect(ctorFlagOf(name), `${name} must be ctor: true`).toBe(true);
    }
  });

  it("Response is a constructible fn (was objAbs ⇒ 'not a constructor' TypeError)", () => {
    // 实例面仍挂在 returnType 上（bodySlots 对象）
    expect(instanceSlotOf("Response", "status")).toBeTruthy();
    expect(instanceSlotOf("Response", "ok")).toBeTruthy();
  });

  it("URL / AbortController (pre-existing correct samples) stay constructible", () => {
    expect(ctorFlagOf("URL")).toBe(true);
    expect(ctorFlagOf("AbortController")).toBe(true);
    const out = checkWeb(`export function f() {
  const u = new URL("https://x.dev");
  const a = new AbortController();
  return [u, a];
}`);
    expect(out.errorCodes).toEqual([]);
  });
});
