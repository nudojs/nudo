/**
 * ABS-12 R12-D · **canary e2e**：strict 能力档下，denied 面即使被「调用」
 * 也不得产生任何宿主副作用。
 *
 * 覆盖：网络（fetch）、定时器（setTimeout）、进程状态写（process.exitCode）、
 * 文件写（静态 require node:fs）、代码执行（eval）。断言四件事：
 * 1. 本地 TCP server 零连接（fetch 未执行）；
 * 2. canary 文件不存在（fs 写未执行）；
 * 3. `process.exitCode` 未被改写（宿主 process 未被写入）；
 * 4. 诊断里出现 `nudo:capability-denied`（能力面被显式拒绝，而不是静默）。
 *
 * 诚实边界：这是**同 realm 防御纵深**的回归钉，不是安全边界的证明。
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import { setCapabilityMode } from "@nudojs/core/internal";

let dir: string | undefined;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
  setCapabilityMode(undefined);
});

describe("ABS-12 · canary：denied 面零宿主副作用", () => {
  it("fetch / setTimeout / process 写 / require(fs) / eval 全部不执行", async () => {
    dir = mkdtempSync(join(tmpdir(), "nudo-cap-canary-"));
    const canaryFile = join(dir, "pwned");
    let connections = 0;
    const server = createServer(() => {
      connections++;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    const prevExitCode = process.exitCode;
    const src = `
export function f() {
  fetch("http://127.0.0.1:${port}/canary");
  setTimeout(() => {}, 0);
  process.exitCode = 7;
  const fs = require("node:fs");
  fs.writeFileSync(${JSON.stringify(canaryFile)}, "x");
  eval("1 + 1");
}`;
    try {
      const r = analyzeFile(join(dir, "canary.js"), src);
      // 若 fetch / timer 真的执行了，事件循环的这段时间足够产生观察结果
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(connections, "fetch must not open a socket").toBe(0);
      expect(existsSync(canaryFile), "fs.writeFileSync must not run").toBe(false);
      expect(process.exitCode, "process.exitCode must stay untouched").toBe(prevExitCode);

      const denied = r.diagnostics.filter((d) => d.code === "nudo:capability-denied");
      expect(denied.length).toBeGreaterThanOrEqual(2);
      const text = denied.map((d) => d.message).join("\n");
      expect(text).toContain("fetch");
      expect(text).toContain("node:fs");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      process.exitCode = prevExitCode;
    }
  });

  it("trusted 档只退回诊断面，仍不执行 HIGH-RISK 名单（fetch 依旧拦截）", async () => {
    setCapabilityMode("trusted");
    dir = mkdtempSync(join(tmpdir(), "nudo-cap-canary-trusted-"));
    let connections = 0;
    const server = createServer(() => {
      connections++;
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const r = analyzeFile(
        join(dir, "canary.js"),
        `export function f() { fetch("http://127.0.0.1:${port}/canary"); }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(connections).toBe(0);
      // trusted 档回到 builtin-unknown 面
      expect(r.diagnostics.map((d) => d.code)).toContain("nudo:builtin-unknown");
      expect(r.diagnostics.map((d) => d.code)).not.toContain("nudo:capability-denied");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
