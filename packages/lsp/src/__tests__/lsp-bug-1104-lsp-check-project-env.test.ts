/**
 * Bug 1104 —— LSP **check 通道**看不见**项目级** path env ⇒ IDE 假红
 * （`nudo:entry-may-throw`），而 CLI `nudo check` 绿（两面口径相反）。
 *
 * 机制：`buildLspInjection`（`packages/lsp/src/agent-tools.ts`）把
 * `package.json#nudo.env` 的**原始相对名**（`./env.mjs`）塞进注入包；
 * 而 `checkSource` 的 env 查表基准 = 「**最后一次**预载的目录」= **文件目录**
 * （文件级 env 预载在后）⇒ 相对说明符的唯一候选 = `<proj>/src/env.mjs`
 * ≠ 预载登记的 `<proj>/env.mjs` ⇒ 查表落空 ⇒ env 全局缺失 ⇒ 入口求值抛
 * `ReferenceError: MAGIC is not defined` ⇒ 报 L2 `nudo:entry-may-throw`。
 * CLI 侧 `assembleEnvs` 早已把项目级说明符按**项目根**绝对化 ⇒ CLI 绿。
 *
 * 修法：项目级 env 说明符按**项目根**（`proj.projectDir`）绝对化，与 CLI
 * `assembleEnvs` 同款（共用 service 的 `absolutizeEnvSpec` 单一事实源）；
 * 文件级 env **仍按文件目录解析**（保持相对名），裸拼写名的既有判定口径不变。
 *
 * 钉：
 * - 正控制：项目根有 path env + 被检查文件在**子目录**且声明了文件级 env
 *   ⇒ LSP check 通道**不得**报 L2 `nudo:entry-may-throw`（env 全局可见）；
 * - 负控制：**真违约**（入口真的 throw）⇒ 仍**必须**报 L2 `nudo:entry-may-throw`
 *   （防止把闸门整体关掉）。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { analyzeFileAsync, clearPathEnvCaches } from "@nudojs/service";
import {
  checkToLspDiagnostics,
  clearValidationState,
  validateText,
  type LspDiagnostic,
  type ValidateTextDeps,
} from "../validation.ts";

/** 项目级 env（项目根）：MAGIC = 42。 */
const ENV_MJS = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

/** 合法入口：读 env 全局（env 可见 ⇒ 不抛 ⇒ 不得报 L2）。 */
const OK_SRC = `/// @nudo:env node
export function f() { return MAGIC; }
`;

/** 真违约：入口真的抛 ⇒ 必须报 L2（负控制）。 */
const THROW_SRC = `/// @nudo:env node
export function g() { throw new Error("boom"); }
`;

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时项目：package.json（项目级 env）+ env.mjs（项目根）+ src/<name>.js。 */
function makeProject(name: string, src: string): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-1104-"));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name, private: true, nudo: { env: ["./env.mjs"] } }),
    "utf-8",
  );
  writeFileSync(join(dir, "env.mjs"), ENV_MJS, "utf-8");
  const file = join(dir, "src", "app.js");
  writeFileSync(file, src, "utf-8");
  return { dir, file };
}

function collector(): { sent: LspDiagnostic[]; deps: ValidateTextDeps } {
  const sent: LspDiagnostic[] = [];
  return {
    sent,
    deps: {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    },
  };
}

function codes(diags: LspDiagnostic[]): string[] {
  return diags.map((d) => String(d.code));
}

describe("Bug 1104: LSP check 通道必须看得见项目级 path env（IDE 红 / CLI 绿 ⇒ 假红）", () => {
  beforeEach(() => {
    clearValidationState();
    clearPathEnvCaches();
  });

  it("正控制：项目根 env + 子目录文件 ⇒ 不报 L2 entry-may-throw（IDE push 面）", async () => {
    const { file } = makeProject("envproj-ok", OK_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, OK_SRC, 1, deps);

    const c = codes(sent);
    expect(c).not.toContain("nudo:entry-may-throw");
    // env 全局可见 ⇒ 也不该报「内建 API 未覆盖」
    expect(c).not.toContain("nudo:builtin-unknown");
  });

  it("正控制：check 通道本身（checkToLspDiagnostics）不报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-ok2", OK_SRC);
    // 预载态：IDE 的分析通道（analyzeFileAsync）先跑 ⇒ path env 已登记
    await analyzeFileAsync(file, OK_SRC);

    const diags = checkToLspDiagnostics(file, OK_SRC);
    expect(codes(diags)).not.toContain("nudo:entry-may-throw");
  });

  it("负控制：真违约（入口真的 throw）⇒ 仍必须报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-throw", THROW_SRC);
    const { sent, deps } = collector();
    await validateText(file, `file://${file}`, THROW_SRC, 1, deps);

    // 闸门没被整体关掉：真违约照报
    expect(codes(sent)).toContain("nudo:entry-may-throw");
  });

  it("负控制（check 通道本身）：真违约 ⇒ 仍报 L2 entry-may-throw", async () => {
    const { file } = makeProject("envproj-throw2", THROW_SRC);
    await analyzeFileAsync(file, THROW_SRC);

    const diags = checkToLspDiagnostics(file, THROW_SRC);
    expect(codes(diags)).toContain("nudo:entry-may-throw");
  });
});
