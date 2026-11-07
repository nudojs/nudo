import { describe, it, expect } from "vitest";
import { checkWeb, displayOf, instanceSlotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 887 — web env 的 `Request` **整份复制了 `Response` 的成员表**。
 *
 * 根因：`bodySlots` 同时被 `Response` 与 `Request` 用 `...` 展开 ⇒ Response
 * 专有的状态面（`ok` / `status` / `statusText` / `redirected` / `type`）被复制
 * 给了 `Request` ⇒ `r.status` 折成 **exact `number`**（原生恒为 `undefined`）
 * ⇒ 引擎给出**确定的错误类型**（错值），且会传播到 dts / zod / guard 产物面。
 *
 * 原生 oracle（node v26.10.0，undici `Request`）：
 *   new Request("https://example.com").status → undefined
 *   new Request("https://example.com").ok     → undefined
 *   new Request("https://example.com").method  → "GET"
 *   new Request("https://example.com").bodyUsed → false （**共有**成员）
 *
 * 反向钉：把状态面塞回 Request ⇒ 本文件必挂。
 */
describe("Bug 887 — Request has its own member table", () => {
  it("Request carries NO Response-only status members", () => {
    for (const name of ["status", "ok", "statusText", "redirected", "type"] as const) {
      expect(instanceSlotOf("Request", name), `Request.${name} must not exist`).toBeUndefined();
    }
  });

  it("Request keeps its own members", () => {
    for (const name of [
      "method",
      "body",
      "mode",
      "credentials",
      "cache",
      "redirect",
      "referrer",
      "integrity",
      "signal",
    ] as const) {
      expect(instanceSlotOf("Request", name), `Request.${name}`).toBeTruthy();
    }
  });

  it("bodyUsed is a shared member (Request.bodyUsed exists natively)", () => {
    expect(instanceSlotOf("Request", "bodyUsed")).toBeTruthy();
    expect(instanceSlotOf("Response", "bodyUsed")).toBeTruthy();
  });

  it("r.status reads as undefined (was exact number)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.status;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^undefined/);
  });

  it("r.ok reads as undefined (was exact boolean)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.ok;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^undefined/);
  });

  it("r.method still reads as string (Request's own member)", () => {
    const out = checkWeb(`export function f(){
  const r = new Request("https://example.com");
  return r.method;
}`);
    expect(out.errorCodes).toEqual([]);
    expect(displayOf(out)).toMatch(/^string/);
  });

  it("Response keeps its status members", () => {
    for (const name of ["status", "ok", "statusText", "redirected", "type"] as const) {
      expect(instanceSlotOf("Response", name), `Response.${name}`).toBeTruthy();
    }
  });
});
