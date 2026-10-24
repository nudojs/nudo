/**
 * Bug 1100 —— `nudo migrate strip --write` 把「**未写盘**」的成功行报成 `wrote`。
 *
 * 症状（目标目录里混一个语法错文件：`good.ts` + `bad.ts`）：
 * 1. **人类面说谎**：stdout 打 `wrote  good.ts → good.js`，而磁盘上**根本没有**
 *    `good.js`（库面原子性：批内有失败 ⇒ 整批零写盘，Bug 574）⇒ 同一行下面还
 *    跟着一句 `note: not written — …` ⇒ **同一行既说「wrote」又说「not
 *    written」**（自相矛盾）。
 * 2. **机器面不可判定**：`--json` 的 `results[]` 里该行带 `outFile`
 *    （`good.js`）⇒ 消费方**只能靠一条自由文本 `notes`** 才能区分「计划成功」
 *    与「已写盘」⇒ 极易误判已产出。
 *
 * 根因（两半）：
 * - 库面（`packages/nudojs/src/migrate.ts`）有失败时**整批零写盘**，但把成功行
 *   的结果一并返回（结果不丢是对的）⇒ 附注记 `STRIP_NOT_WRITTEN_NOTE`。
 * - 命令层（`packages/nudojs/src/commands/migrate.ts`）把这些成功行当普通成功行
 *   推入 `results`，人类面又**无条件**按 `--write` 打 `wrote`。
 *
 * 修法：
 * - 库面：逐行给**写盘状态**（机器面枚举）：写盘轮全成功 ⇒ `written`；批内有
 *   失败 ⇒ 整批 `not-written`（dry-run 的行不带此键，命令层补 `planned`）。
 * - 命令层：人类面措辞由**逐行**的写盘状态决定（`wrote` / `not written` /
 *   `dry`）⇒ 未写盘**不得**打 `wrote`；`--json` 的每一行都带 `writeStatus`
 *   ⇒ 消费方只读结构化字段即可判定。
 *
 * 必须保持的不变量（负控）：
 * - **整批零写盘的原子性不变**（Bug 574）：有失败 ⇒ 磁盘上一个 `.js` 都没有。
 * - **成功行的结果不丢**：失败批次里「本来可以迁移」的文件仍出现在 `results[]`。
 * - **退出码语义不变**：有失败 ⇒ 非 0；全成功 ⇒ 0。
 * - `pathErrors[]` 的内容与量纲不变（失败**文件**，不是目标目录 —— Bug 1086）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";
import { migrateStrip } from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const GOOD = `export function ok(a: number): number {\n  return a + 1;\n}\n`;
const BAD = `export function oops(a: number): number {\n  return a +;\n}\n`;

function dirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-1100-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
  return dir;
}

type StripRow = {
  file: string;
  outFile: string;
  notes?: string[];
  /** 写盘状态（机器面 · Bug 1100）：`written` / `not-written` / `planned` */
  writeStatus?: string;
};

type StripEnvelope = {
  ok?: boolean;
  action?: string;
  results?: StripRow[];
  pathErrors?: Array<{ path: string; code: string; message: string }>;
  error?: string;
};

describe("Bug 1100 —— migrate strip --write 的写盘状态（人类面不谎称 / 机器面可判定）", () => {
  it("验收 1：批内有失败文件 + --write ⇒ 人类面**不打** `wrote`，且磁盘上零产出", () => {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCliTsx(["migrate", "strip", "--write", "."], { cwd: dir });

    // 人类面：该行必须显示为「未写盘」，**不得**出现 `wrote`
    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toContain("not written");
    expect(r.stdout).toContain("good.ts");
    // 失败详情走 stderr（带文件名）
    expect(r.stderr).toContain("bad.ts");
    // 原子性：一个字节都没落盘
    expect(existsSync(join(dir, "good.js"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("验收 2：同场景 --json ⇒ results[] 的该行带**机器可判定**的「未写盘」标记", () => {
    const dir = dirWith({ "good.ts": GOOD, "bad.ts": BAD });

    const r = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });

    const parsed = JSON.parse(r.stdout) as StripEnvelope;
    expect(parsed.ok).toBe(false);
    expect(parsed.action).toBe("strip");
    // 结果**不丢**（成功行仍在 results[] 里）
    expect(parsed.results?.length ?? 0).toBe(1);
    const row = parsed.results![0]!;
    expect(row.file).toBe("good.ts");
    expect(row.outFile).toBe("good.js");
    // 机器可判定：**只读结构化字段**就能判定「没落盘」（不必解析 notes）
    expect(row.writeStatus).toBe("not-written");
    expect(row.writeStatus).not.toBe("written");
    // 失败路径的量纲不变（失败**文件**，不是目标目录 —— Bug 1086）
    expect(parsed.pathErrors?.length ?? 0).toBe(1);
    expect(parsed.pathErrors![0]!.path).toBe("bad.ts");
  });

  it("验收 3：全部成功 + --write ⇒ 人类面照旧打 `wrote`，产物真实落盘，标记为「已写盘」", () => {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCliTsx(["migrate", "strip", "--write", "."], { cwd: dir });

    expect(r.stdout).toMatch(/^wrote {2}good\.ts → good\.js$/m);
    expect(r.stdout).not.toContain("not written");
    // 产物真的落盘
    expect(existsSync(join(dir, "good.js"))).toBe(true);

    // 机器面：标记为「已写盘」
    const j = runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]!.writeStatus).toBe("written");
  });

  it("验收 4：退出码语义不变（有失败 ⇒ 非 0；全成功 ⇒ 0）", () => {
    const bad = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const good = dirWith({ "good.ts": GOOD });

    expect(runCliTsx(["migrate", "strip", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: bad }).status).toBe(1);
    expect(runCliTsx(["migrate", "strip", "--write", "."], { cwd: good }).status).toBe(0);
    expect(runCliTsx(["migrate", "strip", "--json", "--write", "."], { cwd: good }).status).toBe(0);
  });

  it("负控：dry-run（不带 --write）⇒ 人类面是 `dry`（不是 `wrote`），标记为「计划」", () => {
    const dir = dirWith({ "good.ts": GOOD });

    const r = runCliTsx(["migrate", "strip", "."], { cwd: dir });

    expect(r.stdout).not.toMatch(/^wrote /m);
    expect(r.stdout).toMatch(/^dry {2}good\.ts → good\.js$/m);
    expect(existsSync(join(dir, "good.js"))).toBe(false);

    const j = runCliTsx(["migrate", "strip", "--json", "."], { cwd: dir });
    const parsed = JSON.parse(j.stdout) as StripRow[];
    expect(parsed[0]!.writeStatus).toBe("planned");
  });

  it("库面：写盘轮逐行给写盘状态（有失败 ⇒ not-written；全成功 ⇒ written）", async () => {
    const mixed = dirWith({ "good.ts": GOOD, "bad.ts": BAD });
    const rows = await migrateStrip([mixed], { write: true, draft: false });
    const good = rows.find((r) => r.file.endsWith("good.ts"))!;
    expect(good.writeStatus).toBe("not-written");
    // 原子性不变（Bug 574）
    expect(readdirSync(mixed).filter((f) => f.endsWith(".js"))).toHaveLength(0);

    const ok = dirWith({ "good.ts": GOOD });
    const okRows = await migrateStrip([ok], { write: true, draft: false });
    expect(okRows[0]!.writeStatus).toBe("written");
    expect(existsSync(join(ok, "good.js"))).toBe(true);
  });
});
