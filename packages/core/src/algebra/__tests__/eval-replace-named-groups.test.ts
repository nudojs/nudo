/**
 * 评审修复：replace 回调的命名捕获组参数布局。
 * 原生：regex 命名组时 callback 是 (match, ...pN, offset, string, groupsObject)。
 * 此前 slice(1, -2) 会把 groups 对象当成 offset，参数错位。
 * 注意：replace 只替换命中片段，断言整串中的替换结果。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

describe("evaluator replace named capture groups", () => {
  it("callback receives offset as a number even with named groups", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(?<b>b)/, (m, g, off) => String(off)); }`,
    );
    // 命中 'b' @1 → 替换为 "1" → "a1c"
    expect(litValue(r.result)).toEqual({ ok: true, value: "a1c" });
  });

  it("positional capture still works", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(b)/, (m, g, off) => g + ':' + off); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ab:1c" });
  });

  it("string pattern callback still gets offset", () => {
    const r = call(
      `export function f() { return 'abc'.replace('b', (m, off) => String(off)); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a1c" });
  });

  it("named group capture value is still delivered as positional", () => {
    const r = call(
      `export function f() { return 'abc'.replace(/(?<b>b)/, (m, g) => '[' + g + ']'); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a[b]c" });
  });

  // --- Bug 62：命名组时 replacer 末尾的 groups 对象实参 ------------------
  // 此前 replWrapper 检测到 groups 却从 callArgs 丢弃 → arguments.length 4、
  // groups undefined、groups.d 假 TypeError（L2 false-positive）。
  it("arguments.length counts the trailing groups object (5, native parity)", () => {
    const r = call(
      `export function f() { return "a1".replace(/(?<d>\\d)/, function() { return String(arguments.length); }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a5" });
  });

  it("non-named-group replacer keeps 4 args (native parity, control)", () => {
    const r = call(
      `export function f() { return "a1".replace(/(\\d)/, function() { return String(arguments.length); }); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a4" });
  });

  it("groups argument is an object", () => {
    // replace 用返回值替换命中 "1" → "a" + "object"
    const r = call(
      `export function f() { return "a1".replace(/(?<d>\\d)/, (m, g1, off, s, groups) => typeof groups); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "aobject" });
  });

  it("full arg-type chain: string|string|number|string|object", () => {
    const r = call(
      `export function f() {
        return "a1".replace(/(?<d>\\d)/, function() {
          return [typeof arguments[0], typeof arguments[1], typeof arguments[2], typeof arguments[3], typeof arguments[4]].join("|");
        });
      }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "astring|string|number|string|object" });
  });

  it("groups.d read works — no false TypeError", () => {
    const r = call(
      `export function f() {
        try { return "a1".replace(/(?<d>\\d)/, (m, g1, off, s, groups) => groups.d) + "|ok"; }
        catch (e) { return e.name; }
      }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a1|ok" });
  });

  it("Object.keys(groups) exposes the named captures", () => {
    const r = call(
      `export function f() { return "a1".replace(/(?<d>\\d)/, (m, g1, off, s, groups) => Object.keys(groups).join(",")); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "ad" });
  });

  it("replaceAll named-group replacer also receives groups", () => {
    const r = call(
      `export function f() { return "a1b2".replaceAll(/(?<d>\\d)/g, (m, g1, off, s, groups) => groups.d); }`,
    );
    expect(litValue(r.result)).toEqual({ ok: true, value: "a1b2" });
  });
});
