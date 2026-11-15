/**
 * BUG-222 回归（vite-plugin 构建期）：**项目级** env
 * （`package.json#nudo.env`）装载失败必须可见（`nudo:env-unresolved`），
 * 与 CLI / LSP 同口径。
 *
 * 病灶：`envUnresolvedDiagnostics` 只按**文件目录**取失败表
 * （`getPathEnvLoadErrors(dirname(id))`），而项目级 env 的失败条目被记在
 * **项目根**名下（`analyzer-orchestrate.ts` 的 `preloadAnalysisEnvs`：
 * `projectEnvBaseDir = proj?.projectDir ?? fileEnvBaseDir`）⇒ 过滤条件
 * **永远匹配不上** ⇒ 静默丢弃 ⇒ 构建期 env 失效零提示（假绿），
 * 而完全等价的**文件级** `/// @nudo:env ./x.ts` 插件**会**报
 * ⇒ 同一语义两种写法结论不同。
 *
 * 修法（`packages/vite-plugin/src/report.ts`）：**双 baseDir** 取错误
 * （文件目录 + 项目根），并按「项目级按项目根绝对化后」的期望路径集过滤
 * —— 与 CLI `packages/nudojs/src/commands/check.ts`（Bug 647）和 LSP
 * `packages/lsp/src/validation.ts` 的 `envUnresolvedDiags` 同款。
 *
 * 负控制：项目 env 正常（文件存在且契约合法）⇒ 不得报 `nudo:env-unresolved`。
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("hook not callable");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

const APP_SRC = `export function f(x) {
  return x + 1;
}
`;
const OK_ENV_SRC = `export function defineEnv() {
  return { globals: { OK: 1 } };
}
`;

function project(projectEnv: string[], envFiles: Record<string, string> = {}): {
  dir: string;
  file: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-222-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-222",
      private: true,
      type: "module",
      nudo: { env: projectEnv },
    }),
    "utf-8",
  );
  for (const [name, content] of Object.entries(envFiles)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  const file = join(dir, "src", "a.js");
  writeFileSync(file, APP_SRC, "utf-8");
  return { dir, file };
}

async function run(dir: string, file: string, code: string): Promise<string> {
  const plugin = nudoPlugin();
  (plugin.configResolved as (c: { root: string }) => void)?.call({}, { root: dir });
  const msgs: string[] = [];
  const ctx = {
    warn: (m: string) => msgs.push(String(m)),
    error: (m: string) => msgs.push(String(m)),
    info: (m: string) => msgs.push(String(m)),
  };
  // transform 返回 null（插件不改产物）；诊断全部走 ctx 通道
  await transformOf(plugin).call(ctx, code, file);
  return msgs.join("\n");
}

describe("BUG-222: 项目级 env 装载失败必须上屏（nudo:env-unresolved）", () => {
  it("项目级 env 缺失 ⇒ 构建期 warning 指名项目根下的路径", async () => {
    const { dir, file } = project(["./missing-env.ts"]);
    try {
      const all = await run(dir, file, APP_SRC);
      expect(all).toContain("nudo:env-unresolved");
      expect(all).toContain("path env failed to load");
      // 解析基准 = **项目根**（不是文件目录）：路径必须是 <projectRoot>/missing-env.ts
      expect(all).toContain(join(dir, "missing-env.ts"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同一语义的**文件级**写法同样报（两种写法结论一致）", async () => {
    const { dir, file } = project([]);
    try {
      const code = `/// @nudo:env ./missing-env.ts\n${APP_SRC}`;
      writeFileSync(file, code, "utf-8");
      const all = await run(dir, file, code);
      expect(all).toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：项目 env 正常 ⇒ 不报 nudo:env-unresolved", async () => {
    const { dir, file } = project(["./ok-env.ts"], { "ok-env.ts": OK_ENV_SRC });
    try {
      const all = await run(dir, file, APP_SRC);
      expect(all).not.toContain("nudo:env-unresolved");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
