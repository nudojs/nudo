/**
 * Bug 298 回归：JSON.parse 的 **callable reviver 真执行**（原生
 * InternalizeJSONProperty 语义）。
 *
 * 修前：reviver **一次都不执行** ⇒ 回调副作用（计数器 / 累加串 / 捕获变量
 * 写 / this 绑定）整体丢失，捕获变量保留**确定旧值**（引擎内部不对称：
 * 同文件的 stringify replacer 却真执行）。
 *
 * 修法（json.ts `runJsonReviver`）：解析成功后按原生**后序深度优先**逐键
 * 调 reviver.call(holder, key, value)——调用次数 = JSON 结构节点数，根键
 * "" 也算一次；holder = 根对象（this 恒为它）。
 *
 * 值域仍保守 unknown（逐键变换未建模——既有回归 eval-json.test.ts 与
 * eval-object-json-w9.test.ts 钉此口径）；本条钉的是**副作用通道**。
 *
 * 锚定值均为 node 原生实测（见各断言）。
 */
import { describe, it, expect } from "vitest";
import { litValue } from "@nudojs/core";
import { call, isNever, throwsError } from "./eval-helpers.ts";

function v(src: string) {
  return litValue(call(src, "f").result);
}

describe("Bug 298: JSON.parse 的 callable reviver 副作用通道", () => {
  it("reviver 调用次数 = 节点数（node: 3）", () => {
    expect(
      v(`export function f() { let n = 0; JSON.parse("[1,2]", (k, v) => { n++; return v; }); return n; }`),
    ).toEqual({ ok: true, value: 3 });
  });

  it("标量文本：根键一次（node: 1）", () => {
    expect(
      v(`export function f() { let n = 0; JSON.parse("1", (k, v) => { n++; return v; }); return n; }`),
    ).toEqual({ ok: true, value: 1 });
  });

  it("键序 = 后序深度优先（node: \"b;a;;\"）", () => {
    expect(
      v(
        `export function f() { let s = ""; JSON.parse('{"a":{"b":1}}', (k, v) => { s += k + ";"; return v; }); return s; }`,
      ),
    ).toEqual({ ok: true, value: "b;a;;" });
  });

  it("function 表达式 reviver 同样被调用（node: 2）", () => {
    expect(
      v(
        `export function f() { let n = 0; JSON.parse('{"a":1}', function (k, v) { n++; return v; }); return n; }`,
      ),
    ).toEqual({ ok: true, value: 2 });
  });

  it("this 绑定 = holder（原生 typeof this === \"object\"）", () => {
    expect(
      v(
        `export function f() { let s = ""; JSON.parse('{"a":1}', function (k, v) { s += typeof this + ";"; return v; }); return s; }`,
      ),
    ).toEqual({ ok: true, value: "object;object;" });
  });

  it("reviver 抛错原样传播（原生抛原异常——不是 SyntaxError）", () => {
    const r = call(
      `export function f() { try { JSON.parse("1", () => { throw new TypeError("boom"); }); return "no-throw"; } catch (e) { return "caught"; } }`,
      "f",
    );
    expect(v(`export function f() { try { JSON.parse("1", () => { throw new TypeError("boom"); }); return "no-throw"; } catch (e) { return "caught"; } }`)).toEqual({
      ok: true,
      value: "caught",
    });
    expect(isNever(r.throws)).toBe(true);
  });

  it("reviver 抛错不被降级成 SyntaxError（负控制：解析失败仍是 SyntaxError）", () => {
    const r = call(`export function f() { return JSON.parse("{", 1); }`, "f");
    expect(isNever(r.result)).toBe(true);
    expect(throwsError(r.throws, "SyntaxError")).toBe(true);
  });

  it("负控制：非 callable reviver 原生忽略（结果仍是解析值）", () => {
    expect(v(`export function f() { return JSON.stringify(JSON.parse('{"a":1}', 1)); }`)).toEqual({
      ok: true,
      value: '{"a":1}',
    });
    expect(v(`export function f() { return JSON.stringify(JSON.parse('{"a":1}', null)); }`)).toEqual({
      ok: true,
      value: '{"a":1}',
    });
  });

  it("负控制：stringify replacer 侧不回归（仍被调用 3 次）", () => {
    expect(
      v(
        `export function f() { let n = 0; JSON.stringify({ a: { b: 1 } }, (k, v) => { n++; return v; }); return n; }`,
      ),
    ).toEqual({ ok: true, value: 3 });
  });

  it("负控制：parse 的值域仍保守 unknown（逐键变换未建模）", () => {
    const r = call(`export function f() { return JSON.parse('{"a":1}', (k, v) => v); }`, "f");
    expect((r.result as { shape?: { k?: string } }).shape?.k).toBe("unknown");
  });
});
