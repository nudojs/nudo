/**
 * Bug 1098 —— 项目级 path env（`package.json#nudo.env`）在**分析器通道**
 * 对「声明了任何 `@nudo:env` 的文件」**完全不可见**（假阳 + 假绿 + 口径分裂）。
 *
 * 机制（同一根因的两面）：
 * - 预载侧（`analyzeFileAsync`）把项目级 env 的相对说明符按**项目根**绝对化
 *   后登记 ⇒ 注册表 key = `<proj>/env.mjs`；
 * - 收集侧（`analyzeFileUncachedInner`）却仍用**原始相对名**（`./env.mjs`）
 *   查表，而查表基准 = 「最后一次 preload 的目录」= **文件目录**（文件级 env
 *   预载在后）⇒ 相对说明符的**唯一候选** = `<proj>/src/env.mjs` ⇒ 与预载登记
 *   的 key 不匹配 ⇒ **查表落空** ⇒ env 全局丢失。
 *
 * 后果（实测）：
 * - **假阳**：被分析文件只要声明了**任何** `@nudo:env`（哪怕内建名 `node`），
 *   返回面退化成 `never`（ReferenceError: MAGIC is not defined）+
 *   `nudo:builtin-unknown` 警告（IDE 面直接发布 ⇒ 假阳告警 + hover 显示 never）；
 * - **假绿**：env 缺失 ⇒ 大量 unknown/never ⇒ check 的 analyzer 通道弱化判定；
 * - **口径分裂**：同一文件 CLI `nudo check` 显示 `f() => 42`，IDE 通道显示 never。
 *
 * 钉：
 * ① 文件带 `/// @nudo:env node` ⇒ 项目级 env 仍可见（返回面不是 never、
 *    无 `nudo:builtin-unknown` 假阳）；
 * ② 文件不带 `@nudo:env` ⇒ 行为不回退（仍能解析项目级 env）；
 * ③ 分析器通道与 CLI `nudo check` 结论一致（都 `f() => 42`）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { formatAbs } from "@nudojs/core";
import { DIAG } from "@nudojs/core/internal";
import { analyzeFileAsync } from "../analyzer.ts";
import { clearPathEnvCaches } from "../evaluator/env-loader.ts";
import type { AnalysisResult } from "../analyzer-types.ts";
import { tmpProject } from "./tmp-project.ts";
// CLI 面是**只读参照**（正确实现）：本测试用它钉「IDE 通道 ≡ CLI 结论」。
import { runCheck } from "nudojs/commands/check.ts";

/** 项目级 env（项目根）：MAGIC = 42。 */
const ENV_MJS = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

/** 被分析文件**带**文件级 env（内建名）——修前项目级 env 对它完全不可见。 */
const APP_WITH_FILE_ENV = `/// @nudo:env node
export function f() { return MAGIC; }
`;

/** 被分析文件**不带** `@nudo:env`（基线：项目级 env 恰好可见）。 */
const APP_NO_FILE_ENV = `export function f() { return MAGIC; }
`;

/** 项目（项目级 env 在项目根，被分析文件在 src/ 子目录）。 */
function project(files: Record<string, string>): string {
  return tmpProject("nudo-1098-env-", {
    "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.mjs"] } }),
    "env.mjs": ENV_MJS,
    ...files,
  });
}

/** 函数的 entry/call 返回面（人类可读串）。 */
function fnReturn(result: AnalysisResult, name: string): string {
  const fn = result.functions.find((f) => f.name === name);
  expect(fn).toBeDefined();
  const c = fn!.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"));
  expect(c).toBeDefined();
  return formatAbs(c!.abs);
}

/** CLI `nudo check --json` 的机器面（签名 + issues）。 */
async function cliCheckJson(file: string): Promise<{
  signatures: Array<{ name: string; display: string; abs: string }>;
  issues: Array<{ code?: string; message: string }>;
}> {
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const prevExit = process.exitCode;
  try {
    await runCheck(file, { json: true });
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExit;
  }
  const jsonText = logs.find((l) => l.trimStart().startsWith("{"));
  expect(jsonText).toBeDefined();
  return JSON.parse(jsonText!);
}

describe("Bug 1098: 项目级 path env 必须对分析器通道可见（文件带 @nudo:env 时也不丢）", () => {
  beforeEach(() => {
    // 进程级 live 记录是全局的 ⇒ 每例前清干净（否则跨例串台）
    clearPathEnvCaches();
  });

  afterEach(() => {
    clearPathEnvCaches();
    process.exitCode = undefined;
  });

  it("① 文件带 @nudo:env node ⇒ 项目级 env 仍可见（不是 never、无 builtin-unknown 假阳）", async () => {
    const dir = project({ "src/app.js": APP_WITH_FILE_ENV });
    const app = join(dir, "src/app.js");

    const r = await analyzeFileAsync(app, APP_WITH_FILE_ENV);
    const ret = fnReturn(r, "f");
    expect(ret).toContain("42");
    expect(ret).not.toContain("never");
    // 假阳告警：`MAGIC` 是 env 全局 ⇒ 不得报「内建 API 未覆盖」
    expect(r.diagnostics.map((d) => d.code)).not.toContain(DIAG.builtinUnknown);
  });

  it("② 文件不带 @nudo:env ⇒ 行为不回退（仍能解析项目级 env）", async () => {
    const dir = project({ "src/app.js": APP_NO_FILE_ENV });
    const app = join(dir, "src/app.js");

    const r = await analyzeFileAsync(app, APP_NO_FILE_ENV);
    const ret = fnReturn(r, "f");
    expect(ret).toContain("42");
    expect(ret).not.toContain("never");
    expect(r.diagnostics.map((d) => d.code)).not.toContain(DIAG.builtinUnknown);
  });

  it("③ 分析器通道与 CLI `nudo check` 结论一致（都 f() => 42）", async () => {
    const dir = project({ "src/app.js": APP_WITH_FILE_ENV });
    const app = join(dir, "src/app.js");

    const serviceRet = fnReturn(await analyzeFileAsync(app, APP_WITH_FILE_ENV), "f");
    const cli = await cliCheckJson(app);
    const sig = cli.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("42");
    expect(sig!.abs).toContain("42");
    // 两面同源：服务通道不得比 CLI 面更弱（env 丢失 ⇒ never/unknown）
    expect(serviceRet).toContain("42");
    expect(serviceRet).not.toContain("never");
    expect(serviceRet).not.toContain("unknown");
  });
});
