/**
 * Bug 94 —— `@nudo:case` 的**模板字面量**实参被顶层逗号切分器劈开。
 *
 * 根因：两个字符串感知扫描器（core `format/text-scan.ts` 的
 * `splitTopLevelArgs` / `walkTopLevelChars`）与 core `directive-scan.ts` 的
 * `extractBalancedParensScan` 只把 `"` / `'` 当串定界符，反引号被当普通字符
 * ⇒ `` `a,b` `` 里的逗号在 depth 0 被切、`` `a(b` `` 里的 `(` 被当实参表
 * 开括号（整条见证被丢）。姊妹函数 `fn-directives.ts` 的
 * `stripTrailingComment` 早已把反引号当引号 —— 本条补齐同口径。
 */
import { describe, it, expect } from "vitest";
import { litValue, extractBalancedParens } from "@nudojs/core";
import { splitTopLevelArgs, walkTopLevelChars } from "@nudojs/core/internal";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag } from "../directives.ts";
import type { CaseDirective } from "../directives.ts";

function caseWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const fns = extractDirectives(parse(source), { diags });
  const cases = fns.flatMap((f) =>
    f.directives.filter((d) => d.kind === "case"),
  ) as CaseDirective[];
  return { cases, diags };
}

describe("Bug 94 — 反引号是串定界符", () => {
  it("splitTopLevelArgs：反引号内逗号 / 括号不当顶层分隔符", () => {
    expect(splitTopLevelArgs("`a,b`, 1")).toEqual(["`a,b`", "1"]);
    expect(splitTopLevelArgs("`a(b`")).toEqual(["`a(b`"]);
    expect(splitTopLevelArgs("`a:b`")).toEqual(["`a:b`"]);
    // 普通引号口径不变（负控）
    expect(splitTopLevelArgs('"a,b", 1')).toEqual(['"a,b"', "1"]);
  });

  it("walkTopLevelChars：反引号内括号不计深度", () => {
    let maxDepth = 0;
    walkTopLevelChars("(`a(b`)", (_ch, _i, depth) => {
      if (depth > maxDepth) maxDepth = depth;
      return false;
    });
    // 改前模板串里的 `(` 会叠加到 2；改后只外层一对括号 ⇒ 1
    expect(maxDepth).toBe(1);
  });

  it("extractBalancedParens：含括号的模板串仍平衡", () => {
    expect(extractBalancedParens("(`a(b`) => 1", 0)).toBe("`a(b`");
  });

  it("@nudo:case 含逗号模板 ⇒ 一个实参（cooked 字符串），无 directive-syntax", () => {
    const { cases, diags } = caseWithDiags(`/**
 * @nudo:case "csv" (\`a,b\`) => ["a","b"]
 */
export function split(s) { return s.split(","); }`);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.argsAbs).toHaveLength(1);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: "a,b" });
    expect(diags.filter((d) => d.code === "nudo:directive-syntax")).toEqual([]);
  });

  it("@nudo:case 含括号模板 ⇒ 见证不丢（无 unclosed argument list）", () => {
    const { cases, diags } = caseWithDiags(`/**
 * @nudo:case "par" (\`a(b\`) => ["a(b"]
 */
export function split(s) { return s.split(","); }`);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.argsAbs).toHaveLength(1);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: "a(b" });
    expect(diags.some((d) => d.message.includes("unclosed argument list"))).toBe(false);
  });

  it("不含逗号 / 括号的模板字面量仍正常（负控）", () => {
    const { cases } = caseWithDiags(`/**
 * @nudo:case "tpl" (\`xy\`)
 */
export function f(s) { return s; }`);
    expect(cases).toHaveLength(1);
    expect(litValue(cases[0]!.argsAbs[0]!)).toEqual({ ok: true, value: "xy" });
  });
});
