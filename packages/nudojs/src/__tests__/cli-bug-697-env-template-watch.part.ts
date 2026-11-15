/**
 * Bug 697：CLI watch 的 **env 模板失效分支是死代码** ⇒ 目录 watch 下改了
 * env 模板，依赖它的源文件**永不复分析**（IDE/watch 面板里类型一直是旧值）。
 *
 * 根因：`runIncremental` 的路径判定顺序 —— env 模板扩展名
 * （`.env.js` / `.env.mjs` / `.env.ts` / `mock-*.js` / `*.mock.js`）同时命中
 * `isNudoTargetPath` ⇒ `isNudoTargetPath` 分支先 `continue` ⇒ 下面的
 * env 反向边分支永远走不到。（`.env.mts` / `.env.cjs` 不命中
 * `isNudoTargetPath` ⇒ 旧顺序下反而正常。）
 *
 * 修复：env 模板判定**排在 `isNudoTargetPath` 之前**。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noteEnvPathDeps, clearEnvPathDeps } from "@nudojs/service";
import { startWatch } from "../commands/shared.ts";

const waitUntil = async (pred: () => boolean, ms = 20000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const ENV_SRC = `export function defineEnv(){ return { globals: { MAGIC: 1 } }; }\n`;
const MAIN_SRC = `/// @nudo:env ./globals.env.ts\nexport function useGlobal(){ return MAGIC; }\n`;

afterEach(() => {
  vi.restoreAllMocks();
  clearEnvPathDeps();
});

describe("Bug 697: env 模板变更 ⇒ 依赖它的源文件复分析", () => {
  it("改了 globals.env.ts → main.js 在增量轮被重新分析", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "clear").mockImplementation(() => {});

    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-697-"));
    const envFile = join(dir, "globals.env.ts");
    const mainFile = join(dir, "main.js");
    try {
      writeFileSync(envFile, ENV_SRC, "utf-8");
      writeFileSync(mainFile, MAIN_SRC, "utf-8");
      // 反向边登记（分析器侧行为，与被测的 watch 路由无关）
      noteEnvPathDeps(mainFile, MAIN_SRC);

      const analyzed: string[] = [];
      const close = startWatch(
        [dir],
        async (f) => {
          analyzed.push(f);
        },
        "test",
      );
      try {
        await waitUntil(() => analyzed.length >= 2);
        const mainRunsBefore = analyzed.filter((f) => f.endsWith("main.js")).length;
        expect(mainRunsBefore).toBeGreaterThanOrEqual(1);

        // 改 env 模板 ⇒ 依赖它的 main.js 必须复分析（旧行为：永不复分析）
        writeFileSync(
          envFile,
          `export function defineEnv(){ return { globals: { MAGIC: 2 } }; }\n`,
          "utf-8",
        );
        await waitUntil(
          () => analyzed.filter((f) => f.endsWith("main.js")).length > mainRunsBefore,
        );
        expect(analyzed.filter((f) => f.endsWith("main.js")).length).toBeGreaterThan(
          mainRunsBefore,
        );
      } finally {
        close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
      clearEnvPathDeps();
    }
  }, 60000);
});
