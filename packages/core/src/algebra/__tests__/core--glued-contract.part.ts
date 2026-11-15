/**
 * Bug 981：`@nudo:contract` 的**粘连**形态（`@nudo:contractx …`）此前
 * **零诊断**地蒸发。
 *
 * 根因：段扫描用严格正则 `^@nudo:contract\s+(.+)$`（标签后必须有分隔空白）
 * ⇒ 粘连写法**整行不匹配**且**无 else 分支** ⇒ 契约整条不见 ⇒ 用户以为契约
 * 生效了（**假绿**）；同族的其它畸形载荷（`x > 0` 等）反而会落到
 * `nudo:contract-syntax` ⇒ 口径不一致。
 *
 * 修复：诊断面**看得见**粘连形态（口径与族 28 的 Bug 980 一致——严格文法仍
 * 要求分隔空白，宽松形态只用于诊断）⇒ 发既有码 `nudo:contract-syntax`。
 */
import { describe, it, expect } from "vitest";
import { checkSource, pTrue } from "../index.ts";
import { issuesOf } from "./nudo-constraints.ts";

describe("Bug 981：粘连的 @nudo:contract 必须发语法诊断", () => {
  it("@nudo:contractx → nudo:contract-syntax（warning）", () => {
    const r = checkSource(
      "/t/bug-981.js",
      `
/**
 * @nudo:contractx positive
 */
export function f981(x) {
  return x;
}
`,
      pTrue,
    );
    const bad = r.issues.filter((i) => i.code === "nudo:contract-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("@nudo:contractx positive");
    expect(bad[0]!.line).toBe(3);
  });

  it("@nudo:contract 空载荷 → nudo:contract-syntax（warning）", () => {
    const r = checkSource(
      "/t/bug-981b.js",
      `
/**
 * @nudo:contract
 */
export function f981b(x) {
  return x;
}
`,
      pTrue,
    );
    const bad = r.issues.filter((i) => i.code === "nudo:contract-syntax");
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe("warning");
    expect(bad[0]!.message).toContain("Malformed @nudo:contract directive");
  });

  it("合法 @nudo:contract 零 contract-syntax（不误伤）", () => {
    const r = issuesOf(`
/**
 * @nudo:contract x positive
 */
export function ok(x) {
  return x;
}
`);
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
  });

  it("散文里的 @nudo:contract（行中提及）不算指令（不误伤）", () => {
    const r = checkSource(
      "/t/bug-981c.js",
      `
/**
 * 声明 @nudo:contractx 不是指令（行中提及）
 */
export function prose(x) {
  return x;
}
`,
      pTrue,
    );
    expect(r.issues.filter((i) => i.code === "nudo:contract-syntax")).toEqual([]);
  });
});
