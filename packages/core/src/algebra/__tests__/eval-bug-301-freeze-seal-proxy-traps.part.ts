/**
 * Bug 301 回归：Object.freeze / Object.seal 对 **Proxy** 的陷阱派发。
 *
 * 原生（node v26 实测）：SetIntegrityLevel（ES2024 10.4.6）=
 * 1) [[PreventExtensions]]（→ preventExtensions 陷阱）；falsy ⇒ TypeError；
 * 2) 每个自有键 [[DefineOwnProperty]]（→ defineProperty 陷阱）；falsy ⇒
 *    TypeError。
 *
 * 修复前：freeze / seal **完全无视**陷阱（直接落 extState 标签）⇒ 代理的
 * 不可扩展性与键级标志全被跳过（假冻结：陷阱返回 false 也不抛）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

function thrown(src: string): string | undefined {
  const t = call(src, "f").throws as
    | { shape?: { k?: string; name?: string } }
    | undefined;
  return t && t.shape?.k === "brand" ? t.shape.name : undefined;
}

const wrap = (body: string) => `export function f() { ${body} }`;

describe("Bug 301 — freeze / seal 的 Proxy 陷阱派发", () => {
  it("freeze：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { preventExtensions() { return false; } }); Object.freeze(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("seal：preventExtensions 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { preventExtensions() { return false; } }); Object.seal(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("freeze：defineProperty 陷阱返回 false ⇒ TypeError（改前不抛）", () => {
    expect(
      thrown(
        wrap(
          `const p = new Proxy({ a: 1 }, { defineProperty() { return false; } }); Object.freeze(p);`,
        ),
      ),
    ).toBe("TypeError");
  });

  it("freeze：preventExtensions + 逐键 defineProperty 陷阱都派发（改前一个都不派发）", () => {
    expect(
      v(
        wrap(
          `const calls = []; const p = new Proxy({ a: 1 }, { preventExtensions(t) { calls.push("preventExtensions"); return Reflect.preventExtensions(t); }, defineProperty(t, k, d) { calls.push("defineProperty:" + k); return Reflect.defineProperty(t, k, d); } }); Object.freeze(p); return calls.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "preventExtensions,defineProperty:a" });
  });

  it("seal：同样派发两个陷阱（改前一个都不派发）", () => {
    expect(
      v(
        wrap(
          `const calls = []; const p = new Proxy({ a: 1 }, { preventExtensions(t) { calls.push("preventExtensions"); return Reflect.preventExtensions(t); }, defineProperty(t, k, d) { calls.push("defineProperty:" + k); return Reflect.defineProperty(t, k, d); } }); Object.seal(p); return calls.join(",");`,
        ),
      ),
    ).toEqual({ ok: true, value: "preventExtensions,defineProperty:a" });
  });

  it("负控制：无陷阱的 Proxy 冻结不抛（原生同款）", () => {
    expect(thrown(wrap(`const p = new Proxy({ a: 1 }, {}); Object.freeze(p);`))).toBeUndefined();
  });
});
