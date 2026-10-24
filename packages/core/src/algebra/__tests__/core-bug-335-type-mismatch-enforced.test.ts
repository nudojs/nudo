/**
 * Bug 335 —— 「prim + 界」契约的**长度界**通道对非字符串实参回落到普通数值界
 * ⇒ 违规与否取决于数字大小（`5` 撞 `string().max(3)` 报「长度 5 > 3」，
 * `2` 撞 `string().max(3)` 静默通过）⇒ 同一类类型错配给出两种结论。
 *
 * core 侧根因同 Bug 333：实例化时丢了 prim 的类型义务 ⇒ 执法层只剩长度界
 * 可用，只能拿数字当长度比。本钉钉住 core 侧：类型义务必须在实例化谓词里，
 * 且产品面的 `expected` 必须点名类型（而不是只报长度界）。
 *
 * ⚠ 执法侧「length 通道不得回落到数值界」由 S3（scan-literal-calls.ts）收口；
 * 本钉只断言 core 侧的类型义务与产品面的类型化 expected，不锁错误条数。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { instantiateConstraint, string } from "../constraint.ts";
import { predToString } from "../pred.ts";
import { sidecarOpts } from "./nudo-constraints.ts";

const SIDECAR = `export const shortStr = string().max(3);`;

function checkWith(src: string) {
  return checkSource(
    "/t/f.js",
    `/// @nudo:import { shortStr } from "./std.nudo.js"
${src}`,
    pTrue,
    sidecarOpts("std.nudo.js", SIDECAR),
  );
}

describe("Bug 335：长度界契约不得拿数字当长度比（类型义务须在位）", () => {
  it("string().max(3) 实例化带 typeof 类型义务", () => {
    const p = predToString(instantiateConstraint(string().max(3), "s"));
    expect(p).toContain('typeof s = "string"');
  });

  it("数值实参撞字符串长度契约 → 按类型错配报（expected 点名 string）", () => {
    const r = checkWith(`/** @nudo:contract s shortStr */
function needsShort(s) { return s; }
needsShort(5);
`);
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.code === "nudo:constraint-violated",
    );
    expect(errs.length).toBeGreaterThan(0);
    expect(
      errs.some((i) => (i.expected ?? "").includes('typeof s = "string"')),
    ).toBe(true);
  });

  it("字符串实参撞同契约 → 仍按长度界判（类型义务不误伤合法实参）", () => {
    const r = checkWith(`/** @nudo:contract s shortStr */
function needsShort(s) { return s; }
needsShort("ab");
`);
    const errs = r.issues.filter(
      (i) => i.severity === "error" && i.code === "nudo:constraint-violated",
    );
    expect(errs).toHaveLength(0);
  });
});
