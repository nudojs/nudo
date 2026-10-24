/**
 * Bug 322 回归：**URLSearchParams 条目表**（[[name, value]] 对的序列）建模与
 * 品牌方法派发。
 *
 * 本文件钉的是**主 agent 刚完成的接线**：
 * - `packages/core/src/algebra/builtins/error/web.ts`：新增内部槽
 *   `URL_SEARCH_PARAMS_ENTRIES_SLOT`（`"@@entries"`）、`urlSearchParamsEntriesOf(a)`
 *   （读表）、`urlSearchParamsSetEntries(a, entries)`（写表）；
 *   `urlBrandAbs(u)` 给 URL brand 补 `searchParams` 槽（**宿主 URL** ⇒ 条目表
 *   由 `u.search` 按 WHATWG 查询串解析**精确**推出；**抽象 URL** ⇒ 条目表不可知）；
 *   `makeUrlSearchParamsAbs(init)`：init 缺席/nullish ⇒ 空表；字符串/数字/布尔/
 *   bigint **字面量** ⇒ 按查询串解析；**二元组 tuple** ⇒ 元素两侧均为字符串
 *   字面量时逐条精确；**record obj** ⇒ 槽值均为字符串字面量时精确；否则表不可知。
 * - `packages/core/src/algebra/builtins/error/dispatch.ts`：
 *   `evalBuiltinInstanceMethod` 新增 `URLSearchParams` 派发臂 → `evalUrlSearchParamsMethod`
 *   （get / getAll / has / size / toString / set / append / delete / sort / keys /
 *   values / entries）。
 * - `packages/core/src/algebra/exec/runtime/containers/member.ts`：`size` 读取
 *   分派新增 `URLSearchParams`（原生 `size` 是 **getter**，不是方法）。
 *
 * 原生语义要点（node v26.10.0 实测）：
 * - `get(name)` 无匹配返 **null**（不是 undefined）；`delete(name)` 返
 *   **undefined**（不是 boolean）；`set` / `append` 返 undefined；`size` 是条目数；
 * - `append` **追加**一条（同键不去重）⇒ `new URLSearchParams("a=1&b=2")` 后
 *   `append("b","2")` ⇒ `toString()` === `"a=1&b=2&b=2"`；
 * - `set(name, value)` **替换**全部同键条目 ⇒ `getAll("a")` === `["9"]`。
 *
 * 原生依据（node v26.10.0 实测）：
 * - `new URL("http://x/?a=1&b=2").searchParams.get("a")` === `"1"`
 * - `new URL("http://x/?a=1&b=2").searchParams.get("z")` === `null`
 * - `new URL("http://x/?a=1&a=2").searchParams.getAll("a")` === `["1","2"]`
 * - `new URL("http://x/?a=1&b=2").searchParams.has("a")` === `true`
 * - `new URL("http://x/?a=1&b=2").searchParams.has("z")` === `false`
 * - `new URL("http://x/?a=1&b=2").searchParams.size` === `2`
 * - `new URL("http://x/?a=1&b=2").searchParams.toString()` === `"a=1&b=2"`
 * - `new URLSearchParams("a=1&b=2").get("b")` === `"2"`
 * - `new URLSearchParams().size` === `0`
 * - `new URLSearchParams([["a","1"]]).get("a")` === `"1"`
 * - `new URLSearchParams({a:"1"}).get("a")` === `"1"`（record init）
 * - `new URLSearchParams(5).toString()` === `"5="`（数字字面量 init）
 */
import { describe, it, expect } from "vitest";
import { litValue, abs } from "../abs.ts";
import { call, throwsError, tupleEls } from "./eval-helpers.ts";

const wrap = (body: string) => `export function f() { ${body} }`;

/** 抽象（不可知）实参——init 不可知时的口径 */
const unknownAbs = abs({ k: "unknown" }, undefined, undefined, "partial");

describe("Bug 322 — URL brand 的 searchParams 条目表（精确取值）", () => {
  it("get(name) 命中 → 精确值（原生 \"1\"）", () => {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("get(name) 未命中 → null（原生 null，**不是** undefined）", () => {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.get("z");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: null });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("getAll(name) → 全部匹配值（原生 [\"1\",\"2\"]）", () => {
    const r = call(
      wrap(`return new URL("http://x/?a=1&a=2").searchParams.getAll("a");`),
      "f",
    );
    expect(tupleEls(r.result)).toEqual(["1", "2"]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("has(name) → 命中 true / 未命中 false（原生同款）", () => {
    const hit = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.has("a");`), "f");
    expect(litValue(hit.result)).toEqual({ ok: true, value: true });
    const miss = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.has("z");`), "f");
    expect(litValue(miss.result)).toEqual({ ok: true, value: false });
    expect(throwsError(miss.throws, "TypeError")).toBe(false);
  });

  it("size 是 **getter**（原生 2，条目数）", () => {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.size;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 2 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("toString() → 查询串（原生 \"a=1&b=2\"）", () => {
    const r = call(wrap(`return new URL("http://x/?a=1&b=2").searchParams.toString();`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 322 — new URLSearchParams(init) 的条目表", () => {
  it("字符串 init → 查询串解析（原生 get(\"b\") === \"2\"）", () => {
    const r = call(wrap(`return new URLSearchParams("a=1&b=2").get("b");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("init 缺席 → 空表（原生 size === 0）", () => {
    const r = call(wrap(`return new URLSearchParams().size;`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: 0 });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("二元组 tuple init → 逐条精确（原生 get(\"a\") === \"1\"）", () => {
    const r = call(wrap(`return new URLSearchParams([["a","1"]]).get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("record init → 槽值为字符串字面量时精确（原生 get(\"a\") === \"1\"）", () => {
    const r = call(wrap(`return new URLSearchParams({ a: "1" }).get("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: "1" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("数字 / 布尔字面量 init → 按查询串解析（原生 \"5=\" / \"true=\"）", () => {
    const num = call(wrap(`return new URLSearchParams(5).toString();`), "f");
    expect(litValue(num.result)).toEqual({ ok: true, value: "5=" });
    const bool = call(wrap(`return new URLSearchParams(true).toString();`), "f");
    expect(litValue(bool.result)).toEqual({ ok: true, value: "true=" });
    expect(throwsError(bool.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 322 — 变更面：set / append / delete / sort", () => {
  it("append 追加一条（同键不去重）→ toString 原生 \"a=1&b=2&b=2\"", () => {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&b=2"); sp.append("b", "2"); return sp.toString();`,
      ),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("set 替换全部同键条目 → getAll(\"a\") 原生 [\"9\"]", () => {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&a=2"); sp.set("a", "9"); return sp.getAll("a");`,
      ),
      "f",
    );
    expect(tupleEls(r.result)).toEqual(["9"]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("delete 返 **undefined**（原生 undefined，**不是** boolean）", () => {
    const r = call(wrap(`const sp = new URLSearchParams("a=1&b=2"); return sp.delete("a");`), "f");
    expect(litValue(r.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("delete 真的移除条目（原生 get(\"a\") === null、size === 1）", () => {
    const r = call(
      wrap(
        `const sp = new URLSearchParams("a=1&b=2"); sp.delete("a"); return [sp.get("a"), sp.get("b"), sp.size];`,
      ),
      "f",
    );
    expect(tupleEls(r.result)).toEqual([null, "2", 1]);
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("set / append 返 undefined（原生同款）", () => {
    const setR = call(wrap(`const sp = new URLSearchParams("a=1"); return sp.set("b", "2");`), "f");
    expect(litValue(setR.result)).toEqual({ ok: true, value: undefined });
    const appR = call(wrap(`const sp = new URLSearchParams("a=1"); return sp.append("b", "2");`), "f");
    expect(litValue(appR.result)).toEqual({ ok: true, value: undefined });
    expect(throwsError(appR.throws, "TypeError")).toBe(false);
  });

  it("sort 按名排序（原生 \"a=1&b=2\"）", () => {
    const r = call(
      wrap(`const sp = new URLSearchParams("b=2&a=1"); sp.sort(); return sp.toString();`),
      "f",
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a=1&b=2" });
    expect(throwsError(r.throws, "TypeError")).toBe(false);
  });

  it("keys / values 迭代出条目名 / 条目值（原生 [\"a\",\"b\"] / [\"1\",\"2\"]）", () => {
    const keys = call(wrap(`return [...new URLSearchParams("a=1&b=2").keys()];`), "f");
    expect(tupleEls(keys.result)).toEqual(["a", "b"]);
    const values = call(wrap(`return [...new URLSearchParams("a=1&b=2").values()];`), "f");
    expect(tupleEls(values.result)).toEqual(["1", "2"]);
    expect(throwsError(values.throws, "TypeError")).toBe(false);
  });
});

describe("Bug 322 — 负控制 / 精度口径", () => {
  it("URL 的其它组件槽不变（href / search）", () => {
    expect(litValue(call(wrap(`return new URL("http://x/?a=1").href;`), "f").result)).toEqual({
      ok: true,
      value: "http://x/?a=1",
    });
    expect(litValue(call(wrap(`return new URL("http://x/?a=1").search;`), "f").result)).toEqual({
      ok: true,
      value: "?a=1",
    });
  });

  it("非法 URL 仍确定抛 TypeError（不被 searchParams 补丁放宽）", () => {
    const r = call(wrap(`return new URL("not a url").href;`), "f");
    expect(throwsError(r.throws, "TypeError")).toBe(true);
  });

  it("条目表不可知时**不假精确**（抽象 init → unknown 域，且不抛）", () => {
    // 原生：`new URLSearchParams(抽象值)` 的条目表取决于运行时值 ⇒ 引擎不可知。
    // 口径：折 **unknown**（不是某个自信的确定值），且**不记假抛**。
    const r = call(
      `export function f(x) { return new URLSearchParams(x).get("a"); }`,
      "f",
      [unknownAbs],
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });

  it("抽象 URL 的 searchParams 条目表同样不可知（unknown 域，不抛）", () => {
    const r = call(
      `export function f(x) { return new URL(x).searchParams.get("a"); }`,
      "f",
      [unknownAbs],
    );
    expect(throwsError(r.throws, "TypeError")).toBe(false);
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });
});
