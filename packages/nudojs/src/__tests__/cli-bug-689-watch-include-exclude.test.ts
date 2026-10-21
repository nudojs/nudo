/**
 * Bug 689 — CLI `nudo check/test <dir> --watch` 的**扫描面不应用**
 * `nudo.analysis.include` / `exclude` ⇒ watch 门禁对**项目范围外**的文件仍然
 * 报错，且与 IDE 对同一文件口径相反（文档明写 watch 扫描「应用」）。
 *
 * 修法：watch 的文件集走**产品唯一的范围闸门** `shouldAnalyzeFile`
 * （LSP / vite-plugin 同一个入口 ⇒ 同口径），但**不应用 mode**
 * （docs/design/cli-semantics.md §7 的「入口 × include/exclude」表：
 * watch 扫描「应用」include/exclude、「不应用 mode」）。
 *
 * 分工（与 Bug 1026）：CLI **非 watch** 的目标扫描**忽略** include/exclude
 * （「点名路径即意图」，文档明写）⇒ 本用例同时钉住这条边界。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectNudoFiles, startWatch } from "../commands/shared.ts";

const waitUntil = async (pred: () => boolean, ms = 15000): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > deadline) throw new Error("waitUntil: timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
};

const SRC = (n: number) => `export function f${n}() {\n  return ${n};\n}\n`;

describe("Bug 689 — watch 扫描应用 nudo.analysis.include / exclude", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：fx/{package.json(include: src/**), src/in.js, other/out.js} */
  function makeFixture(): { fx: string; inFile: string; outFile: string } {
    const fx = mkdtempSync(join(tmpdir(), "nudo-689-"));
    dirs.push(fx);
    mkdirSync(join(fx, "src"), { recursive: true });
    mkdirSync(join(fx, "other"), { recursive: true });
    writeFileSync(
      join(fx, "package.json"),
      JSON.stringify({
        name: "scopefx",
        version: "1.0.0",
        private: true,
        type: "module",
        nudo: { analysis: { include: ["src/**"] } },
      }),
      "utf-8",
    );
    const inFile = join(fx, "src", "in.js");
    const outFile = join(fx, "other", "out.js");
    writeFileSync(inFile, SRC(1), "utf-8");
    writeFileSync(outFile, SRC(2), "utf-8");
    return { fx, inFile, outFile };
  }

  it("watch 扫描面不收 include 之外的文件（改前：收进来并报红）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const watchSet = collectNudoFiles(fx, { scope: "watch" });
    expect(watchSet).toContain(inFile);
    expect(watchSet).not.toContain(outFile);
  });

  it("watch 首轮只分析范围内的文件（产品面：与 IDE 同口径）", async () => {
    vi.spyOn(console, "clear").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { fx, inFile, outFile } = makeFixture();

    const seen: string[] = [];
    const close = startWatch([fx], async (f) => {
      seen.push(f);
    }, "check");
    try {
      await waitUntil(() => seen.length >= 1);
      expect(seen).toContain(inFile);
      expect(seen).not.toContain(outFile);
    } finally {
      close();
    }
  });

  it("边界：CLI 非 watch 的目录目标扫描仍忽略 include/exclude（点名路径即意图）", () => {
    const { fx, inFile, outFile } = makeFixture();
    const targetSet = collectNudoFiles(fx);
    expect(targetSet).toContain(inFile);
    expect(targetSet).toContain(outFile);
  });
});
