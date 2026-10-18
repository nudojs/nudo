/**
 * Bug 126 回归：`RegExp.prototype.compile` 不改接收者。compile 此前无臂：
 * r.compile("b","gi") 后 source/flags/7 个 flag getter/lastIndex 全是旧
 * brand 的 exact 折叠值；非法 pattern/flags 也漏 SyntaxError。修复：
 * execRegexBrand 值通道 + $reStateCall 写回通道共用 compileRegexBrand
 * （Annex B 语义：RegExp 实参缺省 flags → 复制；flags 给定 → TypeError；
 * 其余走 tryMakeRegexAbs 验证；成功全槽重建 lastIndex=0，返回接收者）。
 *
 * node 实测 ground truth（见各用例注释；Annex B 保留限制——compile 的
 * (regex, flags) 形仍是 TypeError，与 new RegExp(regex, flags) 已放宽不同）。
 */
import { describe, it, expect } from "vitest";
import { call, throwsError } from "./eval-helpers.ts";
import { litValue } from "../abs.ts";

function expectVal(body: string, expected: unknown) {
  const rec = call(`export function f() {\n${body}\n}`);
  expect(rec.throws?.shape?.k ?? "never", `throws face for: ${body}`).toBe("never");
  expect(litValue(rec.result), `value for: ${body}`).toEqual({ ok: true, value: expected });
}

function expectThrow(body: string, name: string) {
  const rec = call(`export function f() {\n${body}\n}`);
  expect(throwsError(rec.throws, name), `throws face for: ${body}`).toBe(true);
}

describe("RegExp.prototype.compile rebuilds receiver (Bug 126)", () => {
  it("重编译 pattern：source 更新", () => {
    // node: /a/.compile("b") → source "b"
    expectVal(`const r = /a/; r.compile("b"); return r.source;`, "b");
  });

  it("重编译 pattern+flags：flags/flag getter 全部重建", () => {
    // node: "gi:true"
    expectVal(`const r = /a/; r.compile("b", "gi"); return r.flags + ":" + r.global;`, "gi:true");
  });

  it("重编译后 lastIndex 归 0", () => {
    // node: 0
    expectVal(`const r = /a/g; r.test("aaa"); r.compile("b", "g"); return r.lastIndex;`, 0);
  });

  it("语句位与表达式位同源（表达式返回接收者）", () => {
    // node: r.compile("b") === r；out.source/r.source 同为 "b"
    expectVal(`const r = /a/; const out = r.compile("b"); return out.source + ":" + r.source;`, "b:b");
  });

  it("RegExp 实参 + 缺省 flags → 复制实参 source/flags", () => {
    // node: "x:i"
    expectVal(`const r = /a/; const s = /x/i; r.compile(s); return r.source + ":" + r.flags;`, "x:i");
  });

  it("无参 → /(?:)/（Bug 95 的 undefined 形不在本测）", () => {
    // node: "(?:)"
    expectVal(`const r = /a/; r.compile(); return r.source;`, "(?:)");
  });

  it("compile 后 sticky 品牌照常参与状态机", () => {
    // node: compile("b","y") + lastIndex 1 → exec "ab" → "b:2"
    expectVal(
      `const r = /a/; r.compile("b", "y"); r.lastIndex = 1; const m = r.exec("ab"); return m?.[0] + ":" + r.lastIndex;`,
      "b:2",
    );
  });

  it("RegExp 实参 + 给定 flags → TypeError（Annex B 保留限制）", () => {
    // node: r.compile(/b/i, "g") → TypeError（node 实测）
    expectVal(`const r = /a/; try { r.compile(/b/i, "g"); return "ok"; } catch (e) { return e.name; }`, "TypeError");
    expectThrow(`const r = /a/; r.compile(/b/i, "g"); return r.source;`, "TypeError");
  });

  it("非法 pattern → SyntaxError", () => {
    // node: r.compile("(") → SyntaxError
    expectVal(`const r = /a/; try { r.compile("("); return "ok"; } catch (e) { return e.name; }`, "SyntaxError");
    expectThrow(`const r = /a/; r.compile("("); return r.source;`, "SyntaxError");
  });

  it("非法 flags → SyntaxError", () => {
    // node: r.compile("a", "gg") → SyntaxError
    expectVal(`const r = /a/; try { r.compile("a", "gg"); return "ok"; } catch (e) { return e.name; }`, "SyntaxError");
  });

  it("compile 重建的 sticky 品牌参与 match（lastIndex=1 命中）", () => {
    // node: /a/.compile("b","y"); r.lastIndex = 1; "ab".match(r)[0] → "b"
    expectVal(`const r = /a/; r.compile("b", "y"); r.lastIndex = 1; return "ab".match(r)[0];`, "b");
  });
});
