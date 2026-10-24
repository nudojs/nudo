import { describe, it, expect } from "vitest";
import { checkWeb, slotOf } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 862 — web env 的 `document` / `performance` 成员表不完整。
 *
 * 根因：env 的成员表是**手写白名单**；漏掉的成员在引擎里不是「不知道」，而是
 * 「**确定是 undefined**」（闭 obj 缺槽机制）⇒ 调用即「确定抛 TypeError」⇒
 * L2 门禁假红（浏览器里这些成员全部存在、全部不抛）。
 *
 * 原生 oracle：浏览器 `document.getElementsByTagName("div")` 返回
 * `HTMLCollection`（不抛）；`performance.getEntries()` 返回
 * `PerformanceEntry[]`（不抛）。
 *
 * 反向钉：把补的槽从 `web.ts` 删掉 ⇒ 本文件必挂。
 */
describe("Bug 862 — document / performance member tables are complete", () => {
  it("document collection lookups are callable (no definite TypeError)", () => {
    const out = checkWeb(`export function f() {
  const a = document.getElementsByTagName("div");
  const b = document.getElementsByClassName("cls");
  const c = document.getElementsByName("nm");
  return [a, b, c];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("document.getElementsByTagName returns an array-shaped value", () => {
    expect(slotOf("document", "getElementsByTagName")).toBeTruthy();
    const out = checkWeb(`export function f(){ return document.getElementsByTagName("div"); }`);
    expect(out.errorCodes).toEqual([]);
  });

  it("document.forms / links / images / scripts are declared", () => {
    for (const name of ["forms", "links", "images", "scripts"] as const) {
      expect(slotOf("document", name), `document.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){ return document.forms.length; }`);
    expect(out.errorCodes).toEqual([]);
  });

  it("document.write / open / close are declared and callable", () => {
    for (const name of ["write", "open", "close"] as const) {
      expect(slotOf("document", name), `document.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){
  document.write("x");
  document.open();
  document.close();
  return 1;
}`);
    expect(out.errorCodes).toEqual([]);
  });

  it("performance.getEntries / clearResourceTimings / toJSON are declared and callable", () => {
    for (const name of ["getEntries", "clearResourceTimings", "toJSON"] as const) {
      expect(slotOf("performance", name), `performance.${name}`).toBeTruthy();
    }
    const out = checkWeb(`export function f(){
  performance.clearResourceTimings();
  return performance.getEntries();
}`);
    expect(out.errorCodes).toEqual([]);
  });

  it("performance.navigation / serverTiming are declared", () => {
    for (const name of ["navigation", "serverTiming"] as const) {
      expect(slotOf("performance", name), `performance.${name}`).toBeTruthy();
    }
  });
});
