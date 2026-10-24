/**
 * Bug 693：`nudo test --watch --json` / `nudo health --watch --json` 的
 * **watch 横幅写进 stdout** ⇒ stdout = 横幅 + JSON + 横幅 ⇒
 * `JSON.parse(stdout)` 直接抛 SyntaxError（机器面契约破）。
 *
 * 修复：watch 横幅（人类进度）一律走 **stderr**；stdout 只剩 JSON。
 *
 * 钉法（必须真的 JSON.parse）：spawn 真实 CLI → 收 stdout → JSON.parse。
 *
 * ⚠️ 收口订正：本钉原先用 `node tsx/dist/cli.mjs <cli> … --watch` 起子进程 ——
 * tsx 的 CLI 会把 `--watch` 当成**自己/node 的旗标**吞掉 ⇒ 子进程的
 * `process.argv` 里没有 `--watch` ⇒ CLI **根本没进 watch 形态** ⇒ 钉在测
 * 非 watch 路径（假通过）。改用共享的 `runWatchCli`（`node --import tsx` +
 * 显式追加 `--watch`）⇒ 钉真的落在 watch 形态上。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWatchCli } from "./helpers/run-watch-cli.ts";

const ONE = `export function one(){ return 1; }\n`;

describe("Bug 693: watch --json 的 stdout 必须是纯 JSON", () => {
  it("nudo test --watch --json → JSON.parse(stdout) 不抛", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-c4-693-"));
    try {
      const file = join(dir, "one.js");
      writeFileSync(file, ONE, "utf-8");
      const r = await runWatchCli(["test", file, "--json"], {
        cwd: dir,
        // 等 stdout 里出现**一份可解析的 JSON**（watch 面首轮跑完才有）；
        // 谓词只看 stdout —— stderr 的横幅不该参与 JSON 判定
        waitFor: (out) => {
          try {
            JSON.parse(out);
            return true;
          } catch {
            return false;
          }
        },
      });
      const stdout = r.stdout;
      const stderr = r.stderr;

      // 核心断言：stdout 真的能被 JSON.parse（旧行为：横幅在前 ⇒ 抛）
      expect(() => JSON.parse(stdout)).not.toThrow();
      const parsed = JSON.parse(stdout) as { version?: number; functions?: unknown[] };
      expect(parsed.version).toBe(1);
      // 横幅不再进 stdout
      expect(stdout).not.toContain("Watching for changes");
      expect(stdout).not.toContain("nudo test...");
      // 横幅走 stderr（人类面不丢）
      expect(stderr).toContain("nudo test...");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
