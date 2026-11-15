/**
 * BUG-229：`nudo init` 的最小改动写盘只替换**第一个**同名 `"nudo"` 成员，而
 * 加载器按 `JSON.parse`（**后者胜**）读 ⇒ init 报「已写入 adoption baseline」
 * 并引导跑 adoption 档，但**生效的配置仍是旧的非法值**（陈述与事实相反）；
 * init 还主动写出一个带**重复键**的 package.json。
 *
 * 修复：改**生效成员（最后一个）**并把其余重复成员删掉 ⇒ 落盘只剩一个
 * `nudo` 成员，且「init 声称写入 ⇒ 加载器读到的配置 == adoption baseline」。
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectConfig } from "@nudojs/service";
import { runInit } from "../commands/init.ts";

const BASELINE = { check: { profile: "adoption" } };

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function makePkg(content: string): string {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-229-"));
  writeFileSync(join(dir, "package.json"), content);
  return dir;
}

/** init 的进程内直驱（捕获输出面） */
function init(): { code: number; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const code = runInit(dir as string, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  });
  return { code, out, err };
}

describe("BUG-229: 重复的 nudo 成员 ⇒ 写入必须对生效配置有效", () => {
  it("重复成员：落盘只剩一个 nudo 成员，且加载器读到 adoption baseline", () => {
    const d = makePkg(`{\n  "name": "p14",\n  "version": "1.0.0",\n  "nudo": null,\n  "nudo": null\n}\n`);
    const r = init();
    expect(r.code, r.err.join("\n")).toBe(0);
    expect(r.out.join("\n")).toContain("wrote adoption baseline");
    const written = readFileSync(join(d, "package.json"), "utf-8");
    // 旧行为：两个 "nudo" 成员并存，JSON.parse 取后者（null）⇒ 写入无效
    expect((written.match(/"nudo"/g) ?? []).length).toBe(1);
    expect(JSON.parse(written).nudo).toEqual(BASELINE);
    // 陈述 == 事实：加载器读到的配置就是写入的基线
    expect(findProjectConfig(d)?.config).toEqual(BASELINE);
  }, 60_000);

  it("单个非法值（对照）：同样落盘为基线且加载器可见", () => {
    const d = makePkg(`{\n  "name": "p14",\n  "version": "1.0.0",\n  "nudo": null\n}\n`);
    const r = init();
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(d, "package.json"), "utf-8")).nudo).toEqual(BASELINE);
    expect(findProjectConfig(d)?.config).toEqual(BASELINE);
  }, 60_000);
});
