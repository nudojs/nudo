/**
 * Bug 1026 — CLI 的**目录目标扫描**只抄了产品默认安全排除 3 条里的 1 条
 * （`node_modules`）⇒ `dist/` / `coverage/` 里的构建产物被当源码门禁。
 *
 * 后果（本次逐条钉住）：
 * ① `nudo test <pkg>` 因**陈旧构建产物**里的过期见证而**红**（假红）
 * ② **CLI 与 IDE / vite 对同一文件结论相反**（service 闸门恒不分析 dist/）
 * ③ **watch 扫描**同样扫进 `dist/`
 *
 * 修法：目录发现复用产品唯一的范围闸门（`shouldAnalyzeFile`）⇒
 * `DEFAULT_ANALYSIS_EXCLUDE`（node_modules / dist / coverage）三条全生效。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldAnalyzeFile } from "@nudojs/service";
import { collectNudoFiles } from "../commands/shared.ts";
import { runCliTsx } from "./helpers/run-cli.ts";

/** 源码：见证成立 */
const SRC_LIB = `/**
 * @nudo:case "ok" (2) => 4
 */
export function double(x) {
  return x * 2;
}
`;
/** 陈旧构建产物：见证早已作废（源码里早就删掉了） */
const DIST_LIB = `/**
 * @nudo:case "stale" (2) => 99
 */
export function double(x) {
  return x * 2;
}
`;

describe("Bug 1026 — 目录目标扫描排除产品默认安全目录（dist / coverage）", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  /** 夹具：pkg/{package.json, src/lib.js, dist/lib.js, coverage/cov.js} */
  function makeFixture(): string {
    const pkg = mkdtempSync(join(tmpdir(), "nudo-1026-"));
    dirs.push(pkg);
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "scopefx", version: "1.0.0", private: true, type: "module" }),
      "utf-8",
    );
    mkdirSync(join(pkg, "src"), { recursive: true });
    mkdirSync(join(pkg, "dist"), { recursive: true });
    mkdirSync(join(pkg, "coverage"), { recursive: true });
    writeFileSync(join(pkg, "src", "lib.js"), SRC_LIB, "utf-8");
    writeFileSync(join(pkg, "dist", "lib.js"), DIST_LIB, "utf-8");
    writeFileSync(join(pkg, "coverage", "cov.js"), DIST_LIB, "utf-8");
    return pkg;
  }

  it("collectNudoFiles 不收 dist/ 与 coverage/ 下的文件（改前：收进来）", () => {
    const pkg = makeFixture();
    const names = collectNudoFiles(pkg)
      .map((f) => f.split("/").slice(-2).join("/"))
      .sort();
    expect(names).toEqual(["src/lib.js"]);
  });

  it("CLI check <pkg> 的文件集合里没有 dist/（改前：多出 dist/lib.js）", () => {
    const pkg = makeFixture();
    const r = runCliTsx(["check", pkg]);
    expect(r.stdout).not.toContain("dist/lib.js");
    expect(r.stdout).not.toContain("coverage/cov.js");
    expect(r.stdout).toContain("src/lib.js");
  });

  it("CLI test <pkg> 不因陈旧构建产物而红（改前：exit 1 假红）", () => {
    const pkg = makeFixture();
    const r = runCliTsx(["test", pkg]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("stale");
    expect(r.stdout).toContain("ok");
  });

  it("跨面一致：CLI 目录发现与 IDE/vite 的 service 闸门对同一批文件给出相同结论", () => {
    const pkg = makeFixture();
    const distFile = join(pkg, "dist", "lib.js");
    const srcFile = join(pkg, "src", "lib.js");
    // IDE / vite 走的就是这个闸门
    expect(shouldAnalyzeFile(distFile, DIST_LIB)).toBe(false);
    expect(shouldAnalyzeFile(srcFile, SRC_LIB)).toBe(true);
    // CLI 目录发现必须与它同口径
    const cliSet = collectNudoFiles(pkg);
    expect(cliSet).not.toContain(distFile);
    expect(cliSet).toContain(srcFile);
  });
});
