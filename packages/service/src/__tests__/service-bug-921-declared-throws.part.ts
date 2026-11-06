/**
 * Bug 921：case 级 `nudo:may-throw` **不认「已声明的有意抛」** ⇒ 两个 verb
 * 对同一份文件给出**相反裁决**。
 *
 * 复现：源码里声明了有意抛（`@nudo:case "t" (1) !! throws TypeError` 或
 * `@nudo:throws TypeError`，或侧车 `fn(…, { throws: "TypeError" })`）⇒
 * - `nudo check` 面：L2 entry 面按「已申报」豁免 ⇒ **OK / 0 error**；
 * - `nudo test` 面：case 级 `nudo:may-throw` 只认「抛了就是问题」⇒ **照报**
 *   未处理的抛 ⇒ 同一文件两个 verb 裁决相反。
 *
 * 修法（`packages/service/src/analyzer-orchestrate-uncached-cases.ts`）：
 * case 级 `nudo:may-throw` 发射**前**先取该函数的**已声明抛**，口径与 check 面
 * （`packages/core/src/algebra/check.ts` 的 entry 面 / L2 面 →
 * `extractDeclaredThrows` → `filterGateThrows`）**同口径** ⇒ 已声明 ⇒ 不发 warning。
 *
 * 钉：
 * - `!! throws TypeError` ⇒ 无 `nudo:may-throw`（改前有）；
 * - `@nudo:throws TypeError` ⇒ 无 `nudo:may-throw`（改前有）；
 * - 侧车 `fn(…, { throws: "TypeError" })` ⇒ 无 `nudo:may-throw`（改前有）；
 * - 负控制：未申报 ⇒ **有** `nudo:may-throw`（口径不变）；
 * - 负控制：申报的 kind 不覆盖实测 kind（申报 RangeError / 实测 TypeError）
 *   ⇒ **有** `nudo:may-throw`（口径不变）；
 * - 负控制：申报 `Error`（Error 族）覆盖实测 `TypeError` ⇒ 无 `nudo:may-throw`
 *   （族覆盖口径与 check 面一致）；
 * - 负控制：坏侧车（加载失败）⇒ `nudo:interface-load` 仍报（memo 化不得吞掉
 *   core 的「同 (路径, 原因) 只报一次」去重项）。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeFile } from "../analyzer.ts";
import { withTmpProject, writeTmpFile } from "./tmp-project.ts";

type Diag = { code?: string; message?: string };

/** 跑一个文件（可带侧车），返回诊断列表。 */
function analyzeDiags(files: Record<string, string>): readonly Diag[] {
  return withTmpProject("nudo-b921-", (dir) => {
    const file = writeTmpFile(dir, "f.js", files["f.js"]!);
    for (const [rel, content] of Object.entries(files)) {
      if (rel === "f.js") continue;
      writeTmpFile(dir, rel, content);
    }
    return analyzeFile(file, readFileSync(file, "utf-8")).diagnostics;
  });
}

/** `nudo:may-throw` 诊断条数（case 级「未处理的抛」）。 */
function mayThrowCount(files: Record<string, string>): number {
  return analyzeDiags(files).filter((d) => d.code === "nudo:may-throw").length;
}

const THROWING_CASE = `/**
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;

const CASE_THROWS_DECL = `/**
 * @nudo:case "t" (1) !! throws TypeError
 */
export function f(x) { throw new TypeError("x"); }
`;

const FN_THROWS_DECL = `/**
 * @nudo:throws TypeError
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;

const SIDECAR = `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number() }, number(), { throws: "TypeError" });
`;

describe("Bug 921：case 级 nudo:may-throw 认「已声明的有意抛」（与 check 面同口径）", () => {
  it("case 上的 `!! throws TypeError` ⇒ 不发 nudo:may-throw", () => {
    expect(mayThrowCount({ "f.js": CASE_THROWS_DECL })).toBe(0);
  });

  it("函数级 `@nudo:throws TypeError` ⇒ 不发 nudo:may-throw", () => {
    expect(mayThrowCount({ "f.js": FN_THROWS_DECL })).toBe(0);
  });

  it("侧车 `fn(…, { throws: \"TypeError\" })` ⇒ 不发 nudo:may-throw", () => {
    expect(mayThrowCount({ "f.js": THROWING_CASE, "f.nudo.js": SIDECAR })).toBe(0);
  });

  it("负控制：未申报 ⇒ 仍发 nudo:may-throw（口径不变）", () => {
    expect(mayThrowCount({ "f.js": THROWING_CASE })).toBe(1);
  });

  it("负控制：申报的 kind 不覆盖实测 kind（RangeError vs TypeError）⇒ 仍发", () => {
    const src = `/**
 * @nudo:throws RangeError
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;
    expect(mayThrowCount({ "f.js": src })).toBe(1);
  });

  it("负控制：申报 Error（族）覆盖实测 TypeError ⇒ 不发", () => {
    const src = `/**
 * @nudo:throws Error
 * @nudo:case "t" (1)
 */
export function f(x) { throw new TypeError("x"); }
`;
    expect(mayThrowCount({ "f.js": src })).toBe(0);
  });

  it("负控制：坏侧车 ⇒ nudo:interface-load 仍报（memo 化不得吞掉加载失败）", () => {
    const diags = analyzeDiags({
      "f.js": THROWING_CASE,
      "f.nudo.js": `import { fn, number } from "@nudojs/core";
export const f = fn({ x: number(
`,
    });
    expect(diags.filter((d) => d.code === "nudo:interface-load").length).toBeGreaterThan(0);
  });
});
