/**
 * Bug 966 — `nudo migrate retire` 改写 tsc 命令时把 shell 的 `$( … )` 命令替换
 * 留在改写结果里、并直接粘到门禁路径上
 * ⇒ 落盘命令要么是 bash 语法错误、要么指向不存在的路径。
 *
 * 契约：命令替换 / 算术替换 / 进程替换是**一个整体**——改写器必须整体消费，
 * 不得在左括号处截断（`nudo check .(pwd)/dist` / `nudo check '$'(cat …)`）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateRetire, rewriteTscCommand } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(scripts: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-966-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "b966", version: "1.0.0", scripts }, null, 2)}\n`,
  );
  return dir;
}

describe("Bug 966 — 命令替换 $( … ) 被截断后粘到门禁路径上", () => {
  it("旗标值里的命令替换被整体消费（不留尾巴）", () => {
    const out = rewriteTscCommand("tsc --outDir $(pwd)/dist").cmd;
    expect(out).toBe("nudo check .");
    expect(out).not.toContain("$(pwd)");
    expect(out).not.toContain(".(pwd)");
  });

  it("-p 的值是命令替换时不得产出 '$'( … ) 这种坏语法", () => {
    const out = rewriteTscCommand("tsc -p $(cat tsconfig.path)").cmd;
    expect(out).not.toContain("'$'");
    expect(out).not.toContain("$(cat");
    expect(out).toBe("nudo check .");
  });

  it("算术替换 / 进程替换同样整体消费", () => {
    expect(rewriteTscCommand("tsc --outDir $((1+1))/dist").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc --outDir <(cat x)/dist").cmd).toBe("nudo check .");
  });

  it("命令替换内部的 tsc 调用同样被退役（独立命令上下文）", () => {
    expect(rewriteTscCommand("echo $(tsc --noEmit)").cmd).toBe("echo $(nudo check .)");
  });

  it("tsc 之后的独立命令（&& 之后）原样保留", () => {
    const out = rewriteTscCommand("tsc --noEmit && echo $(git rev-parse --short HEAD)").cmd;
    expect(out).toBe("nudo check . && echo $(git rev-parse --short HEAD)");
  });

  it("retire 落盘的脚本是合法命令（无悬空 $() / 反引号）", () => {
    const dir = fixture({
      typecheck: "tsc --noEmit $(cat flags.txt)",
    });
    migrateRetire(dir);
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    for (const value of Object.values(pkg.scripts) as string[]) {
      expect(value).not.toContain("'$'");
      expect(value).not.toContain(".(pwd)");
      // 括号必须配平（`$(` 会被整体消费，不会留半个开括号）
      const opens = (value.match(/\(/g) ?? []).length;
      const closes = (value.match(/\)/g) ?? []).length;
      expect(opens).toBe(closes);
    }
    expect(pkg.scripts.typecheck).toBe("nudo check .");
  });
});
