/**
 * Bug 1053 — `migrate strip --write` 之后**源 `.ts` 仍在** ⇒ `nudo check`
 * （= `migrate retire` 装上的 CI 门禁）**跳过同 stem 的产物 `.js`**
 * ⇒ 发布的产物零覆盖（**假绿**）；且与 `migrate verify` 对同一包给出
 * **相反结论**（verify 红 / check 绿）。
 *
 * 根因：`collectNudoFiles`（`packages/nudojs/src/commands/shared.ts`）的
 * 「同 stem 只取其一」规则把「取哪一份」**硬编码成 `.ts`**（迁移**前**的
 * 事实源：带类型注解 ⇒ 推断更准）⇒ 迁移过渡期（strip → retire 之间，
 * `.ts` 与 `.js` **并存**是常态）恰好取**错**的那一份 ⇒ 门禁查的是
 * **退役后不再被编译的死源**，真正发布出去的 `.js` 零覆盖。
 *
 * 修法：同 stem 冲突时**产物（发布物）胜出** ⇒ 门禁门禁**要发布的东西**；
 * 「一个模块 ⇒ 一次分析」的不变式（Bug 923）仍然成立（源被压掉，不是两份
 * 都分析 ⇒ 计数不翻倍）。
 *
 * 判据：
 * ① `strip --write` 后 `nudo check` **覆盖产物 `.js`**（能报出产物里的问题
 *    ⇒ 证明产物被检查了；且被分析的文件是 `.js` 而**不是** `.ts`）；
 * ② **一致性**：`migrate verify` 与 `nudo check` 对同一包**结论一致**；
 * ③ 负控：普通项目（无同 stem 冲突）⇒ 目标集合**不变**；
 * ④ 负控：`migrate strip` **不带** `--write` ⇒ `.js` 未生成 ⇒ 行为不变。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 侧车契约模块（值级模板）—— 项目里**有契约**（迁移项目的常态）。 */
const SHAPES_NUDO_JS = `export const positive = number().gt(0);\n`;

/**
 * 源：带类型标注 ⇒ `ms` 是 `number` ⇒ `ms.toFixed(2)` **安全** ⇒ 源**绿**。
 * 产物（剥掉标注）：`ms` 是 `any` ⇒ `ms.toFixed(2)` **可能抛** ⇒ 产物**红**。
 * ⇒ 「源绿 / 产物红」正是「只查源 ⇒ 假绿」的证据。
 */
const INDEX_TS = `/// @nudo:import { positive } from "./shapes.nudo.js"

/**
 * @nudo:contract n positive
 */
export function repeat(n) {
  return n;
}

export function setDelay(ms: number): number {
  return ms.toFixed(2);
}
`;

/** 普通项目（无同 stem 冲突）：`.ts` 与 `.js` **不同 stem** ⇒ 各自被分析。 */
const PLAIN_TS = `export function inc(n: number): number {\n  return n + 1;\n}\n`;
const PLAIN_JS = `export function id(x) {\n  return x;\n}\n`;

function tmpPkg(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "s9-pkg", version: "0.0.0", type: "module" }),
    "utf-8",
  );
  return dir;
}

/** `check --json` 的**被分析文件集合**（单文件面 / 多文件信封两种形状都吃）。 */
function analyzedFiles(stdout: string): string[] {
  const data = JSON.parse(stdout) as {
    file?: string;
    reports?: Array<{ file?: string }>;
  };
  if (Array.isArray(data.reports)) return data.reports.map((r) => r.file ?? "");
  return data.file ? [data.file] : [];
}

/** `check --json` 的诊断码集合（单文件面 / 多文件信封两种形状都吃）。 */
function issueCodes(stdout: string): string[] {
  const data = JSON.parse(stdout) as {
    issues?: Array<{ code?: string }>;
    reports?: Array<{ issues?: Array<{ code?: string }> }>;
  };
  if (Array.isArray(data.reports)) {
    return data.reports.flatMap((r) => (r.issues ?? []).map((i) => i.code ?? ""));
  }
  return (data.issues ?? []).map((i) => i.code ?? "");
}

describe("Bug 1053 — strip 产物被 check 跳过（发布物零覆盖 ⇒ 假绿）", () => {
  it("① strip --write 后 check 覆盖同 stem 的产物 .js（报出产物里的问题）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");

    const strip = runCliTsx([
      "migrate",
      "strip",
      "--write",
      "--no-draft",
      join(dir, "src", "index.ts"),
    ]);
    expect(strip.status, strip.stderr).toBe(0);
    // strip 默认**保留源** ⇒ `.ts` 与 `.js` 并存（迁移过渡期的常态）
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.js"))).toBe(true);

    const check = runCliTsx(["check", dir, "--json"]);
    // 产物里的问题（`ms` 无标注 ⇒ may throw）必须被报出 ⇒ 产物**被检查了**
    expect(check.status, check.stdout).toBe(1);
    expect(issueCodes(check.stdout)).toContain("nudo:entry-may-throw");
    // 被分析的文件是**产物** `.js`（不是源 `.ts`）
    const files = analyzedFiles(check.stdout);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/index\.js$/);
    // 一个模块 ⇒ 一次分析（Bug 923 的计数不变式不翻倍）
    expect(files.filter((f) => f.endsWith("index.ts"))).toHaveLength(0);
  });

  it("② 一致性：migrate verify 与 nudo check 对同一包结论一致（都红）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053b-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");
    const strip = runCliTsx([
      "migrate",
      "strip",
      "--write",
      "--no-draft",
      join(dir, "src", "index.ts"),
    ]);
    expect(strip.status, strip.stderr).toBe(0);

    const verify = runCliTsx(["migrate", "verify", dir]);
    const check = runCliTsx(["check", dir]);
    // 改前：verify 红（产物红）/ check 绿（只查源）⇒ 相反结论 ⇒ 假绿
    expect(verify.status, verify.stdout + verify.stderr).toBe(1);
    expect(check.status, check.stdout + check.stderr).toBe(1);
    expect(check.status).toBe(verify.status);
    // 人类面也要看得见「查的是产物」
    expect(check.stdout).toMatch(/index\.js/);
  });

  it("③ 负控：普通项目（无同 stem 冲突）⇒ check 的目标集合不变", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053c-");
    writeFileSync(join(dir, "src", "a.ts"), PLAIN_TS, "utf-8");
    writeFileSync(join(dir, "src", "b.js"), PLAIN_JS, "utf-8");

    const check = runCliTsx(["check", dir, "--json"]);
    expect(check.status, check.stdout).toBe(0);
    const files = analyzedFiles(check.stdout).map((f) => f.split("/").pop());
    expect(files.sort()).toEqual(["a.ts", "b.js"]);
  });

  it("④ 负控：strip 不带 --write ⇒ .js 未生成 ⇒ check 行为不变（仍查源）", { timeout: 180_000 }, () => {
    const dir = tmpPkg("nudo-migrate-bug-1053d-");
    writeFileSync(join(dir, "src", "shapes.nudo.js"), SHAPES_NUDO_JS, "utf-8");
    writeFileSync(join(dir, "src", "index.ts"), INDEX_TS, "utf-8");

    const strip = runCliTsx(["migrate", "strip", join(dir, "src", "index.ts")]);
    expect(strip.status, strip.stderr).toBe(0);
    expect(existsSync(join(dir, "src", "index.ts"))).toBe(true);
    expect(existsSync(join(dir, "src", "index.js"))).toBe(false);

    const check = runCliTsx(["check", dir, "--json"]);
    // 无产物 ⇒ 源照旧被分析（行为不变）
    const files = analyzedFiles(check.stdout);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/index\.ts$/);
  });
});
