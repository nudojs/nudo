/**
 * Bug 52 —— 文档注释里**提到**诊断码被当成畸形指令（error 级假红）。
 *
 * 根因：`directiveTagForm` 用 `line.startsWith(tag)` 判标签名，标签后紧跟 `-`
 * 的连字符形态（`@nudo:assume-invalid` / `@nudo:assume-relied`，以及同族
 * `@nudo:contract-…` / `@nudo:throws-…` / `@nudo:invariant-…`）被判 `glued`
 * ⇒ `scanAssumeSegments` 产出「坏段」⇒ check 发 error `nudo:assume-invalid`。
 *
 * 修法：标签后紧跟 `-` 一律判「不是本标签」（与 parser `fn-directives.ts`
 * 的 `(?!-)` 边界同口径，Bug 838 / 980）。词字符**直接粘连**
 * （`@nudo:assumed d <= max`）仍判 `glued` —— Bug 421 / 1032 的坏段通道
 * 必须保留，不得回归。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";

function issuesOf(src: string, file = "/t/bug52.js") {
  return checkSource(file, src, pTrue).issues;
}

function prose(tag: string): string {
  return `/**
 * @nudo:${tag} is a diagnostic code mentioned in docs.
 */
export function f(x) { return x; }`;
}

describe("Bug 52 — 诊断码散文行不是指令申报", () => {
  it("@nudo:assume-invalid / assume-relied：无 nudo:assume-invalid、无 error（改前 exit 1）", () => {
    for (const tag of ["assume-invalid", "assume-relied"]) {
      const issues = issuesOf(prose(tag), `/t/bug52-${tag}.js`);
      expect(issues.filter((i) => i.code === "nudo:assume-invalid"), tag).toEqual([]);
      expect(issues.filter((i) => i.severity === "error"), tag).toEqual([]);
    }
  });

  it("同族连字符标签同样不产畸形诊断（四族口径一致）", () => {
    for (const tag of ["contract-syntax", "throws-x", "invariant-relied"]) {
      const issues = issuesOf(prose(tag), `/t/bug52-${tag}.js`);
      expect(issues.filter((i) => i.severity === "error"), tag).toEqual([]);
      expect(
        issues.filter((i) =>
          ["nudo:contract-syntax", "nudo:invariant-invalid", "nudo:assume-invalid"].includes(
            i.code,
          ),
        ),
        tag,
      ).toEqual([]);
    }
  });

  it("Bug 1032 不回归：粘连 @nudo:assumed 仍报 error", () => {
    const issues = issuesOf(`/**
 * @nudo:assumed d <= max
 */
export function f(d, max) { return d; }`);
    const bad = issues.filter((i) => i.code === "nudo:assume-invalid");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("error");
    expect(bad[0]!.message).toContain("@nudo:assumed d <= max");
  });

  it("Bug 421 不回归：空载荷 @nudo:assume 仍报 error", () => {
    const issues = issuesOf(`/**
 * @nudo:assume
 */
export function f(x) { return x; }`);
    expect(issues.filter((i) => i.code === "nudo:assume-invalid")).toHaveLength(1);
  });

  it("合法 @nudo:assume d <= max 仍不报诊断", () => {
    const issues = issuesOf(`/**
 * @nudo:assume d <= max
 */
export function f(d, max) { return d; }`);
    expect(issues.filter((i) => i.code === "nudo:assume-invalid")).toEqual([]);
  });
});
