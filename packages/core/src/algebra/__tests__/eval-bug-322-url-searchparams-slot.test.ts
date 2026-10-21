/**
 * Bug 322 回归：`new URL(...)` 的实例模型补 `searchParams` 槽。
 *
 * ES 语义（node 实测）：`new URL(u).searchParams` **恒**是 URLSearchParams
 * 实例——原生 URL 的组件槽表里 `searchParams` 与 href/origin/protocol/…
 * 平级，读面**不是 undefined**。
 *
 * 修复前：core 的 URL 组件槽表只列了 10 个 URL 组件，**独缺 searchParams**
 * ⇒ 读它落「槽缺失 ⇒ undefined」⇒ `.get(...)` 在 undefined 上调用 ⇒
 * **确定 TypeError** ⇒ 返回值折 `never`（**错的确定值**；原生返回 "1"）
 * ⇒ 对完全合法、确定性的代码报 `nudo:entry-may-throw` **假红**（L2/L5）。
 *
 * 修法（`exec/class/declare.ts` 的构造面）：`$new` 的宿主构造器分支给
 * URL brand 的内层 obj 补一个 `searchParams` 槽，值 = URLSearchParams
 * brand（`makeUrlSearchParamsAbs`）。
 *
 * 精度口径（**不得**折假精确）：URLSearchParams 的**条目表不建模**（仓内
 * 既有精度债——builtin-coverage-registry 登记 "URLSearchParams.proto.get：
 * 条目表不建模，接受 unknown"）⇒ `searchParams.get(k)` 折 **unknown**
 * （原生给具体字符串）。本条修的是**假抛 / never**（确定的错），不是把
 * unknown 升级成具体值（那要建模条目表——非本分片地盘，见报告越界诉求）。
 *
 * 负控制钉住：URL 其它组件槽不变、非法 URL 仍确定抛 TypeError、
 * `new URLSearchParams(...)` 的 get 口径不变（仍是 unknown）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 322 — new URL(...).searchParams 不再是「读 undefined → 确定抛」", () => {
  it("new URL(u).searchParams.get(\"a\")：不再是 never（改前确定抛 TypeError ⇒ 折 never）", () => {
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.get("a");`),
      "f",
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("new URL(u).searchParams.get(\"a\")：值口径精确 \"1\"（条目表已建模——原生同值）", () => {
    // 口径演进：条目表此前**不建模**（值域 unknown，保守但不准）⇒ 引擎自
    // 己的「不折假精确」纪律。Bug 322 收口时条目表已按 WHATWG 查询串
    // 解析建模（URL brand 的 search 组件 → 宿主 URLSearchParams 解析）⇒
    // 值域**精确**且与原生一致（node v26：get("a") === "1"）。
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.get("a");`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
  });

  it("typeof new URL(u).searchParams === \"object\"（原生同款；改前是 \"undefined\"）", () => {
    const r = call(wrap(`return typeof new URL("https://example.com/?a=1").searchParams;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "object" });
  });

  it("new URL(u).searchParams.has(\"a\")：不再是 never（同款假抛）", () => {
    const r = call(
      wrap(`return new URL("https://example.com/?a=1").searchParams.has("a");`),
      "f",
    );
    expect(isNever(r.result)).toBe(false);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 322 — 负控制（URL 构造面的邻近形态不回归）", () => {
  it("URL 其它组件槽不变：href / protocol / search / toString", () => {
    expect(litValue(call(wrap(`return new URL("https://x/").href;`), "f").result)).toEqual({
      ok: true,
      value: "https://x/",
    });
    expect(litValue(call(wrap(`return new URL("https://x/").protocol;`), "f").result)).toEqual({
      ok: true,
      value: "https:",
    });
    expect(litValue(call(wrap(`return new URL("https://x/?a=1").search;`), "f").result)).toEqual({
      ok: true,
      value: "?a=1",
    });
  });

  it("非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）", () => {
    const r = call(wrap(`return new URL("not a url").href;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("new URLSearchParams(\"a=1\").get(\"a\")：条目表已建模 ⇒ 精确 \"1\"（原生同值）", () => {
    // 同上：字符串 init 按 WHATWG 查询串解析建模 ⇒ 精确值（原生 "1"）。
    const r = call(wrap(`return new URLSearchParams("a=1").get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("new URLSearchParams(\"a=1\").get 是函数（品牌方法名集仍生效）", () => {
    const r = call(wrap(`return typeof new URLSearchParams("a=1").get;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "function" });
  });
});
