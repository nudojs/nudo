/**
 * Bug 928：`check --watch --from` 的调用点证据是**启动快照** ⇒ 每轮从不刷新
 * ⇒ 同一轮里两个文件对同一次调用给出相反裁决，且与同一磁盘状态下的**全新**
 * 非 watch 运行结论相反。
 *
 * 修复：watch 每轮重采 `--from` 调用点证据（startCheckWatch 的 onRoundStart），
 * 证据缺失（读不到 / 解析失败）进入本轮门禁（红）。
 *
 * 测试直接驱动 startCheckWatch（拿到 startWatch 的关闭句柄 ⇒ 确定性清理）。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCheckWatch } from "../commands/check-command.ts";

const waitUntil = async (pred: () => boolean, ms = 30000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const LIB_SRC = `export function add(a, b) {
  return a + b;
}
`;
const LIB_CONTRACT = `import { fn, number } from "@nudojs/core";
export const add = fn({ a: number().gt(0), b: number() }, number());
`;
/** 越界的调用点实参（-1 不满足 a > 0）⇒ L1 domain-exceeds */
const USAGE_BAD = `import { add } from "./lib.js";

export const r = add(-1, 2);
`;
/** 合法的调用点实参 ⇒ 无 domain-exceeds */
const USAGE_OK = `import { add } from "./lib.js";

export const r = add(1, 2);
`;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe("Bug 928 — watch 每轮重采 --from 调用点证据", () => {
  it("调用点改了之后，重新分析依赖方时用的是**当前**证据（不是启动快照）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-928-watch-"));
    const lib = join(dir, "lib.js");
    const usage = join(dir, "usage.js");
    writeFileSync(lib, LIB_SRC, "utf-8");
    writeFileSync(join(dir, "lib.nudo.js"), LIB_CONTRACT, "utf-8");
    writeFileSync(usage, USAGE_BAD, "utf-8");

    const logs: string[] = [];
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logs.push(args.map((a) => String(a)).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const close = startCheckWatch([lib], {
      from: [usage],
      humanMode: true,
      shared: {},
    });

    try {
      // 首轮：启动快照里的 -1 ⇒ L1 domain-exceeds
      await waitUntil(() => logs.join("\n").includes("nudo:interface-domain-exceeds"));
      expect(logs.join("\n")).toContain("-1 exceeds");

      // 调用点改成合法实参（证据变了）
      writeFileSync(usage, USAGE_OK, "utf-8");
      // 等这一轮（usage.js 不是被跟踪目标 ⇒ 增量轮无脏文件，直接返回）
      await new Promise((r) => setTimeout(r, 600));
      const before = logs.length;

      // 触碰依赖方 ⇒ 触发增量轮，重新分析 lib.js
      writeFileSync(lib, LIB_SRC, "utf-8");
      await waitUntil(() => logs.length > before);
      await waitUntil(() => {
        const tail = logs.slice(before).join("\n");
        return tail.includes("nudo check") && !tail.includes("exceeds");
      });

      const tail = logs.slice(before).join("\n");
      // 新证据（1 ≤ a）⇒ 不再有 domain-exceeds（启动快照会一直报 -1）
      expect(tail).not.toContain("nudo:interface-domain-exceeds");
      expect(tail).not.toContain("-1 exceeds");
    } finally {
      close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
