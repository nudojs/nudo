/**
 * Bug 674 — `nudo health` 把**所有非 drift 的分析诊断**丢掉 → 坏掉的侧车在
 * health 面**绿灯**（假绿）。
 *
 * 口径（guides/health.md:18）：health 的门 = 「Analysis errors + call-site
 * solidification drift」。坏侧车（`nudo:interface-load`）是**分析错误** ⇒ 必须
 * 进 health 的判定面（failed / ok / exit 码），不得只在 `nudo check` 面报。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

const MAIN = `export function greet(name) {
  return "hi " + name;
}
`;

/** 坏侧车：语法错误 ⇒ 侧车加载失败（nudo:interface-load） */
const BROKEN_SIDECAR = `export const greet = fn({ name: string()
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-674-"));
  writeFileSync(p("main.js"), MAIN);
  writeFileSync(p("main.nudo.js"), BROKEN_SIDECAR);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 674: health 的分析错误必须进判定面（不得假绿）", () => {
  it("文本面：坏侧车 ⇒ 报分析错误 + exit 1（不得 Result: OK）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("main.js")]);
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain("Result: OK");
    expect(r.stdout).toContain("error");
    expect(r.stdout).toContain("nudo:interface-load");
  });

  it("--json 面：ok:false + errors≥1 + 文件级 error 给出原因", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("main.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ error?: string }>;
      summary: { errors: number };
    };
    expect(parsed.ok).toBe(false);
    expect(r.status).toBe(1);
    expect(parsed.summary.errors).toBeGreaterThanOrEqual(1);
    expect(parsed.files[0].error).toContain("nudo:interface-load");
  });

  it("跨动词同口径：nudo check 对同一路径同样报 nudo:interface-load", { timeout: 60_000 }, () => {
    const r = runCliTsx(["check", p("main.js")]);
    expect(r.stdout).toContain("nudo:interface-load");
  });
});
