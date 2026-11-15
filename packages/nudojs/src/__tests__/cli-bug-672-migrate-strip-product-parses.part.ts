/**
 * Bug 672 — `nudo migrate strip --write` 写出的 `.js` **Node 无法解析**
 * （`private` / `public` / `readonly` 未剥离；参数属性
 * `constructor(private opening: number)` 也原样保留）。
 *
 * **真源**：`packages/core/src/strip-types.ts`（经 `packages/nudojs/src/migrate.ts` 的
 * `stripTsToJs` 调用）—— 族 21 收口时由主 agent 接线修好：
 * ① 类成员修饰符（`private` / `public` / `protected` / `readonly` / `abstract` /
 * `override` / `declare`）剥掉；② 构造器参数属性降级成
 * 「普通形参 + 构造器体开头的 `this.x = x`」。
 *
 * 命令层（`packages/nudojs/src/commands/migrate.ts`）另有一道**兜底闸门**：
 * 写盘**之前**检出「剥完仍有 TS-only 语法」的目标并**拒绝写盘** + 响亮报错
 * （migrate 是一程闸门，写坏了没有回退路径）。真源修好后常规路径不再触发它，
 * 它只作为真源漏网时的兜底存在。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const CLASS_TS = `export class Account {
  private balance: number = 0;
  public readonly owner: string = "ada";
  constructor(private opening: number) { this.balance = opening; }
}
`;

function dirWith(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-cli-bug-672-"));
  dirs.push(dir);
  writeFileSync(join(dir, name), content, "utf-8");
  return dir;
}

/** node --check（语法检查，不执行） */
function nodeCheck(path: string): { status: number; stderr: string } {
  const r = spawnSync(process.execPath, ["--check", path], { encoding: "utf-8" });
  return { status: r.status ?? 1, stderr: r.stderr ?? "" };
}

describe("Bug 672 — strip 产物必须是 Node 能解析的纯 JS", () => {
  it("产物必须落盘且能被 `node --check` 解析（成员修饰符已剥、参数属性已降级）", () => {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    const product = join(dir, "cls.js");
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(product)).toBe(true);
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
    const code = readFileSync(product, "utf-8");
    // 成员修饰符不得残留
    expect(code).not.toContain("private");
    expect(code).not.toContain("public");
    expect(code).not.toContain("readonly");
    // 参数属性降级：形参变普通形参 + 构造器体补上字段赋值
    expect(code).toContain("this.opening = opening");
    expect(code).not.toContain("constructor(private");
  });

  it("命令层闸门是**兜底**：真源修好后常规路径不再触发它（不得误拦合法产物）", () => {
    const dir = dirWith("cls.ts", CLASS_TS);
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "cls.ts")]);
    // 闸门仍在（真源漏网时拒写盘 + 点名文件 + exit 1），但真源已修 ⇒ 不该拦
    expect(r.status, r.stderr).toBe(0);
    expect(r.stderr).not.toContain("TypeScript syntax");
    expect(existsSync(join(dir, "cls.js"))).toBe(true);
  });

  it("对照：纯类型注解的 TS 源照常 strip（闸门不得过度拦截）", () => {
    const dir = dirWith("ok.ts", "export function add(a: number, b: number): number {\n  return a + b;\n}\n");
    const r = runCliTsx(["migrate", "strip", "--write", join(dir, "ok.ts")]);
    expect(r.status, r.stderr).toBe(0);
    const product = join(dir, "ok.js");
    expect(existsSync(product)).toBe(true);
    const code = readFileSync(product, "utf-8");
    expect(code).not.toContain(": number");
    const check = nodeCheck(product);
    expect(check.status, `${product}\n${check.stderr}`).toBe(0);
  });
});
