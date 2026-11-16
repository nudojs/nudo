/**
 * 反引号是串定界符：顶层逗号切分、括号深度、平衡括号扫描都不得把模板
 * 字面量内的 `,` / `(` 当结构；@nudo:case 的模板实参必须完整保留。
 */
import { describe, it, expect } from "vitest";
import { litValue, extractBalancedParens } from "@nudojs/core";
import { splitTopLevelArgs, walkTopLevelChars } from "@nudojs/core/internal";
import { parse } from "../parse.ts";
import { extractDirectives, type DirectiveDiag, type CaseDirective } from "../directives.ts";

function caseWithDiags(source: string) {
  const diags: DirectiveDiag[] = [];
  const cases = extractDirectives(parse(source), { diags }).flatMap((f) =>
    f.directives.filter((d) => d.kind === "case"),
  ) as CaseDirective[];
  return { cases, diags };
}

const SCANNER_CASES = [
  {
    name: "splitTopLevelArgs 不切模板内的逗号/括号",
    run: () => [
      splitTopLevelArgs("`a,b`, 1"),
      splitTopLevelArgs("`a(b`"),
      splitTopLevelArgs("`a:b`"),
      splitTopLevelArgs('"a,b", 1'),
    ],
    expected: [["`a,b`", "1"], ["`a(b`"], ["`a:b`"], ['"a,b"', "1"]],
  },
  {
    name: "walkTopLevelChars 不把模板内括号计入深度",
    run: () => {
      let max = 0;
      walkTopLevelChars("(`a(b`)", (_ch, _i, depth) => {
        if (depth > max) max = depth;
        return false;
      });
      return max;
    },
    expected: 1,
  },
  {
    name: "extractBalancedParens 对含括号模板仍平衡",
    run: () => extractBalancedParens("(`a(b`) => 1", 0),
    expected: "`a(b`",
  },
];

describe("反引号作为串定界符", () => {
  it.each(SCANNER_CASES)("$name", ({ run, expected }) => {
    expect(run()).toEqual(expected);
  });
});

const CASE_CASES = [
  { name: "含逗号模板", arg: "`a,b`", value: "a,b" },
  { name: "含括号模板", arg: "`a(b`", value: "a(b" },
  { name: "普通模板（负控）", arg: "`xy`", value: "xy" },
];

describe("@nudo:case 的模板实参", () => {
  it("逗号 / 括号 / 普通模板都保留为单个 cooked 实参，且不产语法诊断", () => {
    for (const { name, arg, value } of CASE_CASES) {
      const { cases, diags } = caseWithDiags(`/**
 * @nudo:case "tpl" (${arg})
 */
export function f(s) { return s; }`);
      expect(cases, name).toHaveLength(1);
      expect(cases[0]!.argsAbs, name).toHaveLength(1);
      expect(litValue(cases[0]!.argsAbs[0]!), name).toEqual({ ok: true, value });
      expect(diags.filter((d) => d.code === "nudo:directive-syntax"), name).toEqual([]);
      expect(diags.some((d) => d.message.includes("unclosed argument list")), name).toBe(false);
    }
  });
});
