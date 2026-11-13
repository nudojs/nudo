/**
 * ABS-18 · watch 增量轮**逐出粒度**回归钉。
 *
 * 旧行为：`evictForDependents(ordered)` 把「改动文件 + 全部传递 dependents」
 * 一起逐出 ⇒ 每次编辑都整条链重算，缓存键里的依赖指纹根本没机会命中。
 * 新契约（2026-11-13）：
 * - 逐出只覆盖**事件里真的变了**的文件（各层缓存键已含依赖内容指纹）；
 * - dependents 仍进分析循环（本测试的 fake runOne 钉住这一点），但语义编辑
 *   会因指纹翻转而重算、inert 编辑（尾部注释/空白）则命中复用（见 core 侧
 *   `load-deps-fp-stable.test.ts`）。
 *
 * 这里用「替换 AnalysisSession」观察逐出参数，不依赖真实分析耗时。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  setAnalysisSession,
  stablePathKey,
  type AnalysisSession,
} from "@nudojs/service";
import { startWatch } from "../commands/shared.ts";

const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

let dir: string;
let prevSession: AnalysisSession | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-abs18-evict-"));
});

afterEach(() => {
  setAnalysisSession(prevSession);
  prevSession = undefined;
  vi.restoreAllMocks();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

describe("ABS-18 · 增量轮只逐出被改文件，不逐出传递 dependents", () => {
  it("改 b.js：分析集 = {a.js, b.js}（a 依赖 b），逐出集 = {b.js}", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(b, "export const b = 1;\n", "utf-8");
    writeFileSync(a, 'import { b } from "./b.js";\nexport const a = b + 1;\n', "utf-8");

    const evicted: string[][] = [];
    const fake: AnalysisSession = {
      evictForDependents(files: string[]): void {
        evicted.push([...files]);
      },
      clear(): void {},
      reset(): void {},
      analyze(): never {
        throw new Error("fake runOne: startWatch 不应调用 session.analyze");
      },
    };
    prevSession = setAnalysisSession(fake);

    const seen: string[] = [];
    const close = startWatch([dir], async (f) => {
      seen.push(f);
    }, "check");
    try {
      // 首轮全量：a.js + b.js
      await waitUntil(() => seen.length >= 2);
      seen.length = 0;

      // 语义编辑 b.js ⇒ 增量轮：a 与 b 都进分析集
      writeFileSync(b, "export const b = 2;\n", "utf-8");
      await waitUntil(() => seen.length >= 2);
      const analyzed = seen.map(stablePathKey).sort();
      expect(analyzed).toEqual([stablePathKey(a), stablePathKey(b)].sort());

      // 逐出参数只含“真的变了”的 b.js
      expect(evicted.length).toBeGreaterThanOrEqual(1);
      expect(evicted.at(-1)).toEqual([stablePathKey(b)]);
    } finally {
      close();
    }
  });
});
