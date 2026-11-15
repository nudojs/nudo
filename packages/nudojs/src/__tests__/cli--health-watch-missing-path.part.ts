/**
 * Bug 927：`nudo health --watch <不存在的路径>`：**路径错误被 watch 的文件
 * 收集整个吞掉** ⇒ exit 0 / 零报告 / 静默空会话 ⇒ 假绿；而 `nudo health`
 * （无 watch）对**同一路径** exit 1。
 *
 * 根因：「File not found」报告的唯一生产者是 runHealth，而 watch 路径下
 * runHealth 只能作为 startWatch 的 per-file runner 被调用；路径不存在 ⇒
 * 收集为空 ⇒ runner 一次都不跑 ⇒ 报告永不产生、退出码永不置红。
 *
 * 钉：watch 面必须与无 watch 面**同款**——路径错误上屏 + 红 + 进程自己
 * 退出（不装 watch ⇒ 不常驻）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runWatchCli } from "./helpers/run-watch-cli.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
let missing: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-927-"));
  missing = join(dir, "nope.js");
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 927: health --watch 的路径错误通道可达", () => {
  it("health --watch <不存在路径>：路径错误上屏 + exit 1 + 进程自己退出（不装 watch）", { timeout: 40_000 }, async () => {
    const r = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    expect(r.stdout, `stderr=${r.stderr}`).toContain("File not found");
    expect(r.stdout).toContain("Result: FAIL");
    expect(r.stdout).toContain("1 error(s)");
    // 不得装 watch（否则是常驻的静默绿会话）
    expect(r.stdout).not.toContain("Watching for changes");
    expect(r.exited, "watch 面仍在常驻（路径错误被吞）").toBe(true);
    expect(r.status).toBe(1);
  });

  it("与无 watch 面同款：同一路径的结论一致（红 + 同一句错误说明）", { timeout: 40_000 }, async () => {
    const watch = await runWatchCli(["health", missing], { waitFor: "exit", timeoutMs: 12_000 });
    const plain = runCliTsx(["health", missing]);
    expect(plain.status).toBe(1);
    expect(plain.stdout).toContain("File not found");
    expect(watch.stdout).toContain(plain.stdout.split("\n")[0]!.trim());
  });
});
