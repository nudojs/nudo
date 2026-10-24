/**
 * Bug 682 — `nudo health` 的 witness drift 计数报的是「新集合大小 + 旧集合大小」
 * 的和式，而不是**实际变更数** ⇒ 只改 1 条见证报「2 条变更」（且与同屏 Summary
 * 的「1 case drift」自相矛盾）。
 *
 * 口径：漂移计数 = 两侧见证的**实际变更条数**（同一条见证被改写只计 1 次）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let dir: string;
const p = (f: string) => join(dir, f);

/** 已固化一条见证（调用点现场在 usage.js 第 2 行） */
const LIB = `/**
 * @nudo:case "call@L2" ("Hello World")
 */
export function slugify(s) {
  return s.toLowerCase();
}
`;

/** 使用现场：同一调用点，但实参已改成 "Goodbye World" ⇒ 见证陈旧 */
const USAGE = `import { slugify } from "./lib.js";
console.log(slugify("Goodbye World"));
`;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-bug-682-"));
  writeFileSync(p("lib.js"), LIB);
  writeFileSync(p("usage.js"), USAGE);
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("Bug 682: witness drift 计数 = 实际变更条数", () => {
  it("文本面：只改 1 条见证 ⇒ 报「1 witness directive(s) changed」", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.stdout).toContain("1 witness directive(s) changed");
    expect(r.stdout).not.toContain("2 witness directive(s) changed");
    // 漂移确实存在（陈旧见证 ⇒ 仍须判红）
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("drift:");
  });

  it("--json 面：added + removed == 实际变更条数（== 1）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", "--json", p("lib.js"), "--from", p("usage.js")]);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      files: Array<{ drift?: { added: number; removed: number; changed?: number } }>;
      summary: { drift: number };
    };
    expect(parsed.ok).toBe(false);
    const drift = parsed.files[0].drift;
    expect(drift).toBeDefined();
    expect(drift!.added + drift!.removed).toBe(1);
    expect(drift!.changed).toBe(1); // 同一条见证被改写（不是 +1 new / -1 removed 两条）
    expect(parsed.summary.drift).toBe(1);
  });

  it("同屏 Summary 与明细自洽（Summary 的 case drift ≥ 1，明细条数 == 1）", { timeout: 60_000 }, () => {
    const r = runCliTsx(["health", p("lib.js"), "--from", p("usage.js")]);
    expect(r.stdout).toMatch(/Summary: .*· 1 case drift/);
    const m = /(\d+) witness directive\(s\) changed/.exec(r.stdout);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(1);
  });
});
