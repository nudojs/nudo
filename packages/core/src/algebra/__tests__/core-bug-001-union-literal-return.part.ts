/**
 * Bug 001 —— 同 prim 字面量 union 的**返回契约**假阳性（误报违约）。
 *
 * `union(lit(0), lit(1))` 在 Abs 面上被**特化**成「单个 prim 臂 + 析取谓词」
 * （`samePrimLiteralUnionAbs`）⇒ 该 union 的语义落在**谓词**上，而不是
 * 「多个可判别臂」上。旧的 union 后置检查**逐成员**问「整条臂蕴含某一个
 * 成员」⇒ `x = 0 ∨ x = 1` 不蕴含 `x = 0`（x 可能是 1）⇒ 两个成员都不成立
 * ⇒ `disproved` ⇒ 已被证明满足契约的返回值被判违约（假红，直接卡 CI）。
 *
 * 修法：union 分支**先试整体蕴含**（臂的谓词 ⇒ union 的合并析取），
 * 证不出时才回落逐成员检查（只升级为 proved，不制造新的假绿）。
 *
 * 钉住的行为：
 * - 返回位：`return x`（x 契约 = `status`）对 `@nudo:contract return status`
 *   零 error（改前 1 条 `nudo:constraint-violated`）；
 * - 同 prim 字符串字面量 union 同款；
 * - **负控制**：返回值确定不在 union 内 / 值域宽于 union ⇒ 仍是 error
 *   （整体蕴含只放宽「已被证明满足」的那条路）。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { errorsOf, issuesOf, sidecarOpts } from "./nudo-constraints.ts";

/** 侧车：同 prim 字符串字面量 union（自定义约束用） */
const LIB = `
export const ab = union(lit("a"), lit("b"));
`;
const libOpts = () =>
  sidecarOpts("lib.nudo", LIB, "/t/bug001/app.js");

describe("Bug 001 · 同 prim 字面量 union 作返回契约不得假红", () => {
  it("返回位：x 的谓词已证明落在 union 内（status）⇒ 零 error", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract x status
 * @nudo:contract return status
 */
function echoStatus(x) {
  return x;
}
`,
      "/t/bug001-status.js",
    );
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("返回位：同 prim **字符串**字面量 union 同样不得假红", () => {
    const src = `/// @nudo:import { ab } from "./lib.nudo.js"

/**
 * @nudo:contract x ab
 * @nudo:contract return ab
 */
function echoAb(x) {
  return x;
}
`;
    const r = checkSource("/t/bug001/app.js", src, pTrue, libOpts());
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("负控制：返回值确定不在 union 内 ⇒ 仍报 error（整体蕴含不放宽确定违约）", () => {
    const r = issuesOf(
      `
/**
 * @nudo:contract return status
 */
function bad() {
  return 2;
}
`,
      "/t/bug001-bad.js",
    );
    const err = r.issues.find(
      (i) => i.severity === "error" && i.message.includes("@nudo:contract return"),
    );
    expect(err).toBeDefined();
  });

  it("负控制：值域宽于 union（x 只是裸 number）⇒ 仍是 error", () => {
    const r = errorsOf(
      `
/**
 * @nudo:contract x num
 * @nudo:contract return status
 */
function echoNum(x) {
  return x;
}
`,
      "/t/bug001-num.js",
    );
    expect(r.length).toBeGreaterThan(0);
  });
});
