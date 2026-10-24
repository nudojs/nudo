/**
 * Bug 309 回归：URL brand 的 `searchParams` 组件槽。
 *
 * 原生依据（node v26.10.0 实测，取证命令见文件末尾「取证」段）：
 *   new URL("https://x/?a=1").searchParams           → URLSearchParams 实例
 *                                                       （constructor.name
 *                                                        === "URLSearchParams"；
 *                                                        instanceof URLSearchParams）
 *   new URL("https://x/?a=1").searchParams.get("a")  → "1"
 *   new URL("https://x/?a=1").href                   → "https://x/?a=1"
 *   new URL("https://x/?a=1").search                 → "?a=1"
 *   typeof new URL("https://x/?a=1").searchParams    → "object"
 *
 * 修前：URL 组件槽表**独缺 searchParams** ⇒ 读它落「槽缺失 ⇒ undefined」
 * ⇒ `.get(...)` 在 undefined 上调用 ⇒ **确定 TypeError** ⇒ 返回值折 never
 * （**自信的错值**：原生返回 "1"）⇒ 对完全合法、确定性的代码报
 * `nudo:entry-may-throw` **假红**（L2/L5）。
 *
 * 取证（原生 oracle）：
 *   node -e 'const u=new URL("https://x/?a=1");
 *     console.log(u.searchParams.constructor.name, u.searchParams.get("a"),
 *       u.href, u.search, typeof u.searchParams)'
 */
import { describe, it, expect } from "vitest";
import { formatShape, litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 309 — URL brand 的 searchParams 组件槽", () => {
  it("new URL(u).searchParams.get(\"a\") → 精确 \"1\"（修前：确定抛 TypeError ⇒ 折 never）", () => {
    const r = call(wrap(`return new URL("https://x/?a=1").searchParams.get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect(isNever(r.result)).toBe(false);
  });

  it("new URL(u).searchParams 是 URLSearchParams 品牌（不再是 undefined）", () => {
    const r = call(wrap(`return new URL("https://x/?a=1").searchParams;`), "f");
    expect(formatShape(r.result)).toBe("URLSearchParams");
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("typeof new URL(u).searchParams → \"object\"（原生同款；修前是 \"undefined\"）", () => {
    const r = call(wrap(`return typeof new URL("https://x/?a=1").searchParams;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });
});

describe("Bug 309 — 负控制（URL 其它组件槽不变 + 非法 URL 仍确定抛）", () => {
  it("new URL(u).href → \"https://x/?a=1\"", () => {
    const r = call(wrap(`return new URL("https://x/?a=1").href;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "https://x/?a=1" });
  });

  it("new URL(u).search → \"?a=1\"", () => {
    const r = call(wrap(`return new URL("https://x/?a=1").search;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "?a=1" });
  });

  it("new URL(u).origin → \"https://x\"（相邻组件槽不回归）", () => {
    const r = call(wrap(`return new URL("https://x/?a=1").origin;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "https://x" });
  });

  it("非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）", () => {
    const r = call(wrap(`return new URL("not a url").href;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });
});
