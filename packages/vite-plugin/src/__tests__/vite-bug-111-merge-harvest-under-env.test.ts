/**
 * BUG-111 回归（vite-plugin 构建期）：env 模块与 harvest 模块**同名**合并时
 * 必须走 `mergeHarvestUnderEnv`（同名槽 env 赢、harvest 填其余空位）。
 *
 * 病灶：`buildViteCheckInjection` 用**对象展开**
 * （`{...graph.modules, ...envMods}`）⇒ 同名模块下 harvest 的**非冲突导出
 * 被整体丢弃** ⇒ 插件面绑定缺失 ⇒ 类型退化成 `unknown` + **误导性**
 * `nudo:unknown-inference`，而 CLI 面（`nudo check`，已走
 * `mergeHarvestUnderEnv`）**无诊断、签名精确** ⇒ 同一个仓库
 * `nudo check` 绿 / `vite build` 红（Bug 1037 的同族插件面）。
 *
 * 触发面：模块名与 env 键同名（`util` / `path` / `url` / `os` / `crypto` /
 * `events` / `stream` / `assert` … 都是真实存在的 npm 包名）。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：模块表改走
 * `mergeHarvestUnderEnv(graph.modules, envMods)`（与 CLI / test / service 同源）。
 *
 * 负控制：harvest 与 env **都没有**的导出仍须报 `nudo:unknown-inference`
 * （门禁不得被整体关掉）。
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

/**
 * 夹具：一个**与 env 键同名**的 npm 包 `util` —— harvest 只认得
 * `harvestOnly`；env（`@nudo:env node`）只认得 Node 内建 `util` 的导出。
 * 两者**不冲突** ⇒ 合并后必须**都保留**（对象展开会把 `harvestOnly` 丢掉）。
 */
function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-111-"));
  const pkg = join(dir, "node_modules", "util");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify({ name: "util", version: "1.0.0", types: "index.d.ts", main: "index.js" }),
    "utf-8",
  );
  writeFileSync(
    join(pkg, "index.d.ts"),
    "export declare function harvestOnly(): number;\n",
    "utf-8",
  );
  writeFileSync(join(pkg, "index.js"), "export function harvestOnly() { return 1; }\n", "utf-8");
  return dir;
}

/** `@nudo:env node` ⇒ env 模块表里有 `util`（Node 内建）——同名冲突的来源。 */
function src(imported: string): string {
  return `/// @nudo:env node
import { ${imported} } from "util";
export function use() {
  return ${imported}();
}
`;
}

type Run = { warns: string[]; errors: string[]; all: string };

async function run(dir: string, code: string): Promise<Run> {
  const file = join(dir, "app.js");
  writeFileSync(file, code, "utf-8");
  const plugin = nudoPlugin();
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => errors.push(String(m)),
    info: () => {},
  };
  await transformOf(plugin).call(ctx, code, file);
  return { warns, errors, all: [...warns, ...errors].join("\n") };
}

describe("BUG-111: 同名模块下 env ∪ harvest 必须合并（不得丢弃 harvest 专有导出）", () => {
  it("harvest 专有导出可解析 ⇒ 不再误报 nudo:unknown-inference（与 CLI 同结论）", async () => {
    const dir = project();
    try {
      const r = await run(dir, src("harvestOnly"));
      expect(r.all).not.toContain("nudo:unknown-inference");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("负控制：env 与 harvest 都没有的导出仍报 nudo:unknown-inference", async () => {
    const dir = project();
    try {
      const r = await run(dir, src("notExportedAnywhere"));
      expect(r.all).toContain("nudo:unknown-inference");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
