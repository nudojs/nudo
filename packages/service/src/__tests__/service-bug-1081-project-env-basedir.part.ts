/**
 * Bug 1081（重犯 Bug 647）—— 项目级 path env 被按「**被分析文件所在目录**」
 * 解析 ⇒ agent 面（`collectCheckSupplementIssues`）两种错都犯：
 *
 * - **假阳**：项目级 env 文件明明在**项目根**存在，却被报成
 *   `path env not found: <proj>/src/env.ts`——那个路径**根本不存在**；
 * - **假阴**：项目级 env 的**真实加载失败**（如不导出 `defineEnv`）记在
 *   **项目根**基准下（CLI 按项目根预载），而本模块只按文件目录取
 *   ⇒ 取不到 ⇒ **零诊断**（真实失败被静默丢弃）。
 *
 * 口径（与 CLI `assembleEnvs` 同源，见 `packages/nudojs/src/commands/check.ts`）：
 * **项目级**（`package.json#nudo.env`）按**项目根**解析；**文件级**
 * （`/// @nudo:env`）按**被分析文件所在目录**解析。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "node:path";
import { DIAG } from "@nudojs/core/internal";
import { collectCheckSupplementIssues } from "../check-issues.ts";
import { clearPathEnvCaches, preloadPathEnvs } from "../evaluator/env-loader.ts";
import { tmpProject } from "./tmp-project.ts";

/** env-unresolved 通道的消息（其它通道的诊断不算）。 */
function envMessages(filePath: string, source: string): string[] {
  return collectCheckSupplementIssues(filePath, source)
    .filter((i) => i.code === DIAG.envUnresolved)
    .map((i) => i.message);
}

const ENV_OK = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }\n`;
/** 没有 defineEnv 导出 ⇒ 加载「成功」但不是合法 env ⇒ 真实加载失败。 */
const ENV_NO_DEFINE = `export const notDefineEnv = 1;\n`;
const APP_SRC = `export function f() { return 1; }\n`;

describe("Bug 1081: 项目级 path env 必须按项目根解析（文件级按文件目录）", () => {
  beforeEach(() => {
    // 进程级 live 记录是全局的 ⇒ 每例前清干净（否则跨例串台）
    clearPathEnvCaches();
  });

  it("假阳：项目级 env 在项目根存在 ⇒ 不得报「找不到 <proj>/src/env.ts」", () => {
    const dir = tmpProject("nudo-1081-env-", {
      "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_OK,
      "src/app.js": APP_SRC,
    });
    const app = join(dir, "src/app.js");

    const msgs = envMessages(app, APP_SRC);
    expect(msgs).toEqual([]);
  });

  it("假阴：项目级 env 真实加载失败（记在项目根基准）⇒ 必须报出来", async () => {
    const dir = tmpProject("nudo-1081-env-fail-", {
      "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_NO_DEFINE,
      "src/app.js": APP_SRC,
    });
    const app = join(dir, "src/app.js");

    // 模拟 CLI 按**项目根**基准预载项目级 env（CLI assembleEnvs：项目级按项目根）
    await preloadPathEnvs(["./env.ts"], dir);

    const msgs = envMessages(app, APP_SRC);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join("\n")).toContain(join(dir, "env.ts"));
    // 不得把「文件目录」下的不存在路径报出来（那是修前的假阳）
    expect(msgs.join("\n")).not.toContain(join(dir, "src", "env.ts"));
  });

  it("文件级 env 仍按**文件目录**解析（不得改成项目根）", () => {
    const dir = tmpProject("nudo-1081-file-env-", {
      "package.json": JSON.stringify({ name: "proj" }),
      "src/app.js": `/// @nudo:env ./missing.ts\n${APP_SRC}`,
    });
    const app = join(dir, "src/app.js");
    const src = `/// @nudo:env ./missing.ts\n${APP_SRC}`;

    const msgs = envMessages(app, src);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain(join(dir, "src", "missing.ts"));
  });
});
