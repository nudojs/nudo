/**
 * Bug 991 — agent 工具 `nudo/check` 只跑裸 `checkSource` ⇒ CLI / LSP 并入
 * check 报告的**补充诊断通道**一条都没接 ⇒ 同一文件三个面三份 issue 集。
 *
 * 本钉覆盖两条旁路通道：
 * 1. **指令文法诊断**（`nudo:directive-syntax`）——parser 的 extract 与
 *    service 的 `collectEvalReplacements` 写进调用方自备的 `diags` 数组，
 *    不会流进 `checkSource` 的返回值；
 * 2. **path env 未解析**（`nudo:env-unresolved`）——service 进程级 live 状态
 *    （`getPathEnvLoadErrors`），既不是 `checkSource` 的入参也不是返回值。
 *
 * 改前 agent 面：`summary.warnings = 0`、`issues` 为空、`ok: true` ⇒ 一个按
 * `nudo/check` 结果决策的 agent 会认为「文件完全干净」。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

const D1_SYNTAX = `/**
 * @nudo:sample abc
 */
export function add(a) {
  return a + 1;
}
`;

const D2_ENV = `/// @nudo:env "./nope.mjs"
export function add(a) {
  return a + 1;
}
`;

describe("Bug 991 — agent nudo/check 接上补充诊断通道", () => {
  it("指令文法诊断（nudo:directive-syntax）并入 issues + summary", async () => {
    await withLspServer({ "d1_syntax.js": D1_SYNTAX }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/d1_syntax.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:directive-syntax",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("warning");
      expect(json.summary.warnings).toBeGreaterThanOrEqual(1);
    });
  });

  it("path env 未解析（nudo:env-unresolved）并入 issues + summary", async () => {
    await withLspServer({ "d2_env.js": D2_ENV }, async ({ req, dir }) => {
      const r = await req("nudo/check")({ file: `${dir}/d2_env.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const issue = json.issues.find(
        (i: { code: string }) => i.code === "nudo:env-unresolved",
      );
      expect(issue).toBeTruthy();
      expect(issue.severity).toBe("warning");
      expect(issue.message).toContain("nope.mjs");
      expect(json.summary.warnings).toBeGreaterThanOrEqual(1);
    });
  });

  it("dot 形式同样接上（协议别名不降级）", async () => {
    await withLspServer({ "d1_syntax.js": D1_SYNTAX }, async ({ req, dir }) => {
      const r = await req("nudo.check")({ file: `${dir}/d1_syntax.js`, format: "json" });
      const json = JSON.parse(r.content[0].text);
      const codes = json.issues.map((i: { code: string }) => i.code);
      expect(codes).toContain("nudo:directive-syntax");
    });
  });
});
