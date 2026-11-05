import { describe, it, expect } from "vitest";
import { checkWeb, webEnvGlobals } from "./env-bug-s1-helpers.ts";

/**
 * 族 29 Bug 870 — env web 的浏览器全局清单缺项 ⇒ **定抛 ReferenceError**（假红）。
 *
 * 根因：env 的 `globals` 表未收录这些浏览器全局 ⇒ 未声明的名字在引擎里是
 * **未绑定** ⇒ 读它 = ReferenceError ⇒ L2 门禁对合法浏览器代码报 error，
 * 且诊断文案指向完全无关的方向（「re-export `export { x } from` 不是局部绑定」）。
 *
 * 原生 oracle（浏览器）：`alert` / `screen` / `DOMParser` / `XMLHttpRequest` /
 * `Worker` / `FileReader` 全部存在；扩围 5 个（`matchMedia` /
 * `IntersectionObserver` / `getComputedStyle` / `indexedDB` / `caches`）同样存在。
 * node v26 宿主里这些名字**不存在**（实测 `typeof globalThis.alert === "undefined"`）
 * ⇒ 引擎必须靠 env 声明才能解析。
 *
 * 反向钉：从 `web.ts` 的 globals 表删掉任一个 ⇒ 本文件必挂。
 */
describe("Bug 870 — web browser globals are declared", () => {
  const GLOBALS = [
    "alert",
    "screen",
    "DOMParser",
    "XMLHttpRequest",
    "Worker",
    "FileReader",
    // 扩围（Bug 865 段）：另 5 个真实存在的浏览器全局
    "matchMedia",
    "IntersectionObserver",
    "getComputedStyle",
    "indexedDB",
    "caches",
  ] as const;

  it("every browser global is present in the env globals table", () => {
    const globals = webEnvGlobals();
    for (const name of GLOBALS) {
      expect(globals[name], `global "${name}" missing`).toBeTruthy();
    }
  });

  it("using them yields no ReferenceError (and no error-level diagnostic)", () => {
    const out = checkWeb(`export function f() {
  alert("hi");
  const w = screen.width;
  const p = new DOMParser();
  const x = new XMLHttpRequest();
  const wk = new Worker("/w.js");
  const fr = new FileReader();
  const mq = matchMedia("(min-width: 100px)");
  const io = new IntersectionObserver(function () {});
  const cs = getComputedStyle(document.body);
  const db = indexedDB.open("db");
  const cc = caches.open("c");
  return [w, p, x, wk, fr, mq, io, cs, db, cc];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.issues.filter((i) => /ReferenceError/.test(i.message))).toEqual([]);
  });

  it("screen exposes the Screen interface members", () => {
    for (const name of [
      "width",
      "height",
      "availWidth",
      "availHeight",
      "colorDepth",
      "pixelDepth",
      "orientation",
    ] as const) {
      const globals = webEnvGlobals();
      const slots = globals["screen"]?.shape.k === "obj" ? globals["screen"].shape.slots : undefined;
      expect(slots?.[name], `screen.${name}`).toBeTruthy();
    }
  });

  it("DOMParser / XMLHttpRequest / Worker / FileReader / IntersectionObserver are constructible", () => {
    const out = checkWeb(`export function f() {
  const p = new DOMParser();
  const x = new XMLHttpRequest();
  const wk = new Worker("/w.js");
  const fr = new FileReader();
  const io = new IntersectionObserver(function () {});
  return [p, x, wk, fr, io];
}`);
    expect(out.errorCodes).toEqual([]);
    expect(out.throwBrands).toEqual([]);
  });

  it("indexedDB / caches expose their documented members", () => {
    const globals = webEnvGlobals();
    const idb = globals["indexedDB"]?.shape.k === "obj" ? globals["indexedDB"].shape.slots : undefined;
    for (const name of ["open", "deleteDatabase", "databases", "cmp"] as const) {
      expect(idb?.[name], `indexedDB.${name}`).toBeTruthy();
    }
    const caches = globals["caches"]?.shape.k === "obj" ? globals["caches"].shape.slots : undefined;
    for (const name of ["open", "has", "delete", "match", "keys"] as const) {
      expect(caches?.[name], `caches.${name}`).toBeTruthy();
    }
  });
});
