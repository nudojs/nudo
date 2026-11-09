/**
 * 缺陷分册 04-contract-command · CLI 回归（Bug 34 / 54 / 80 / 101）。
 *
 * 复现工程一律建在 /tmp 独立目录；CLI 用 `runCliTsx`（cwd = repoRoot ⇒ tsx
 * 按仓库根 tsconfig 把 `@nudojs/*` 解析到 **src**，不会落到 dist 旧产物），
 * 目标文件用绝对路径传给 CLI。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

let root: string;
const p = (...parts: string[]): string => join(root, ...parts);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "nudo-bug-contract-"));
  writeFileSync(
    p("package.json"),
    '{"name":"nudo-bug-contract","version":"1.0.0","type":"module"}\n',
  );

  // Bug 34：手写契约合取不可满足（x > 0 ∧ x < 0）
  writeFileSync(p("b34.js"), "export function f(x) { return x; }\n");
  writeFileSync(p("b34.nudo.js"), "export const f = fn({ x: number().gt(0).lt(0) });\n");

  // Bug 80：正常侧车 / 语法损坏的侧车（分两个文件，避免互相干扰）
  for (const tag of ["good", "bad"]) {
    writeFileSync(p(`${tag}.js`), "export function add(a, b) { return a + b; }\n");
  }
  writeFileSync(
    p("good.nudo.js"),
    'import { fn, number } from "@nudojs/core";\nexport const add = fn({ a: number(), b: number() });\n',
  );
  writeFileSync(p("bad.nudo.js"), "export const add = fn({ a: number().gt(0)  // broken\n");

  // Bug 101：两个顶层导出
  writeFileSync(
    p("b101.js"),
    "export function add(a, b) { return a + b; }\n" +
      "export function word(s) { return s.toUpperCase(); }\n",
  );

  // Bug 54：目录模式（两个 .d.ts）+ 单文件模式
  mkdirSync(p("dts"), { recursive: true });
  writeFileSync(p("dts", "a.d.ts"), "export declare function alpha(n: number): number;\n");
  writeFileSync(p("dts", "b.d.ts"), "export declare function beta(s: string): string;\n");
  mkdirSync(p("single"), { recursive: true });
  writeFileSync(p("single", "a.d.ts"), "export declare function alpha(n: number): number;\n");
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("Bug 34 · 只读 contract 不因 contract-conflict 改退出码", () => {
  it("print：stderr 报同码 error，但 exit 0（§1.3 只在用法 / IO 错误时 exit 1）", () => {
    const print = runCliTsx(["contract", p("b34.js")]);
    expect(print.status).toBe(0);
    expect(print.stderr).toContain("nudo:contract-conflict");
    expect(print.stdout).toContain("[unsatisfiable: x]");
  }, 120000);

  it("--json：同样 exit 0，conflict 字段照旧透出", () => {
    const json = runCliTsx(["contract", p("b34.js"), "--json"]);
    expect(json.status).toBe(0);
    expect(json.stderr).toContain("nudo:contract-conflict");
    expect(json.stdout).toContain('"conflict"');
  }, 120000);
});

describe("Bug 80 · 坏侧车三面透出 nudo:contract-load（与 check/export 同裁决）", () => {
  it("好侧车对照：exit 0 + [handwritten]，stderr 无 contract-load", () => {
    const r = runCliTsx(["contract", p("good.js")]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("[handwritten]");
    expect(r.stderr).not.toContain("nudo:contract-load");
  }, 120000);

  it("print：stderr 报同码 + exit 1", () => {
    const pr = runCliTsx(["contract", p("bad.js")]);
    expect(pr.status).toBe(1);
    expect(pr.stderr).toContain("nudo:contract-load");
  }, 120000);

  it("--json：stderr + exit 1，载荷带 diagnostics 字段", () => {
    const js = runCliTsx(["contract", p("bad.js"), "--json"]);
    expect(js.status).toBe(1);
    expect(js.stderr).toContain("nudo:contract-load");
    expect(js.stdout).toContain('"diagnostics"');
    expect(js.stdout).toContain("nudo:contract-load");
  }, 120000);

  it("--draft：stderr 报同码 + exit 1（不再按「无契约」静默起草）", () => {
    const dr = runCliTsx(["contract", "--draft", p("bad.js")]);
    expect(dr.status).toBe(1);
    expect(dr.stderr).toContain("nudo:contract-load");
  }, 120000);
});

describe("Bug 101 · 打印面 --fn / --all 生效（不再静默忽略）", () => {
  it("--fn add 只输出 add；--all 全量", () => {
    const f = p("b101.js");
    const json = runCliTsx(["contract", f, "--json", "--fn", "add"]);
    expect(json.status).toBe(0);
    expect(json.stdout).toContain('"add"');
    expect(json.stdout).not.toContain('"word"');

    const pr = runCliTsx(["contract", f, "--fn", "add"]);
    expect(pr.status).toBe(0);
    expect(pr.stdout).toContain("  add  ");
    expect(pr.stdout).not.toContain("  word  ");

    const all = runCliTsx(["contract", f, "--json", "--all"]);
    expect(all.status).toBe(0);
    expect(all.stdout).toContain('"word"');
  }, 120000);

  it("--fn 未命中 / --fn + --all 组合：显式 usage error + exit 1", () => {
    const f = p("b101.js");
    const miss = runCliTsx(["contract", f, "--json", "--fn", "nope"]);
    expect(miss.status).toBe(1);
    expect(miss.stdout).toContain("nudo:usage-error");

    const both = runCliTsx(["contract", f, "--json", "--fn", "add", "--all"]);
    expect(both.status).toBe(1);
    expect(both.stdout).toContain("nudo:usage-error");
  }, 120000);
});

describe("Bug 54 · 多 .d.ts 合并草稿逐导出点名接受目标", () => {
  it("--write：beta 指向 b.d.ts 自己的模块侧车，不再只给第一个文件", () => {
    const draft = p("dts", "a.nudo.draft.ts");
    if (existsSync(draft)) rmSync(draft);
    const r = runCliTsx(["contract", "--from-dts", p("dts"), "--write"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("no single accept target");
    expect(r.stdout).toContain("beta");
    expect(r.stdout).toContain("b.d.ts");
    expect(r.stdout).toContain("b.nudo.ts");
    expect(r.stdout).toContain("alpha");
    expect(r.stdout).toContain("a.d.ts");
    // 旧提示「copy accepted exports into <anchor>」不再出现
    expect(r.stdout).not.toContain("copy accepted exports into");
  }, 120000);

  it("单文件模式：next 提示逐字不变（既有钉不回退）", () => {
    const draft = p("single", "a.nudo.draft.ts");
    if (existsSync(draft)) rmSync(draft);
    const r = runCliTsx(["contract", "--from-dts", p("single", "a.d.ts"), "--write"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("copy accepted exports into");
    expect(r.stdout).not.toContain("no single accept target");
  }, 120000);
});
