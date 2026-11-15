/**
 * 审计 34 · D8：单点判据（局部绑定表 / 循环头 const / 能力档）。
 *
 * 三条 bug 都是「同一个判据漏了一种形态」，修在各判据的唯一入口。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-d8-"));
  dirs.push(dir);
  for (const [name, src] of Object.entries(files)) writeFileSync(join(dir, name), src, "utf-8");
  return dir;
}

const CALLEE = [
  "export function f(x) { if (x < 0) { throw new Error(\"neg\"); } return x; }",
  "",
].join("\n");
const CALLEE_SIDECAR = [
  'import { fn, number } from "@nudojs/core";',
  "export const f = fn({ x: number().ge(0) }, number());",
  "",
].join("\n");

function codes(dir: string, file: string): string[] {
  const r = runCliTsx(["check", join(dir, file), "--json"]);
  const json = JSON.parse(r.stdout) as { issues?: Array<{ code: string }> };
  return (json.issues ?? []).map((i) => i.code);
}

describe("D8 · 局部绑定表（BUG-003）", () => {
  it("形参 / catch / for-of 遮蔽模块级 const：不把外层值当实参（0 违规）", () => {
    const dir = fixture({
      "f.js": CALLEE,
      "f.nudo.js": CALLEE_SIDECAR,
      "main.js": [
        'import { f } from "./f.js";',
        "const LIMIT = -1;",
        "export function paramShadow(LIMIT) { return f(LIMIT); }",
        "export function catchShadow() { try { throw 1 } catch (LIMIT) { return f(LIMIT) } }",
        "export function forOfShadow() { for (const LIMIT of [1]) return f(LIMIT); }",
        "",
      ].join("\n"),
    });
    expect(codes(dir, "main.js")).not.toContain("nudo:constraint-violated");
  }, 60000);

  it("解构声明（对象 / 数组 / 重命名）进实参表：违规被抓到", () => {
    const dir = fixture({
      "f.js": CALLEE,
      "f.nudo.js": CALLEE_SIDECAR,
      "e2.js": 'import { f } from "./f.js";\nexport function only() { const { n } = { n: -1 }; return f(n); }\n',
      "e3.js": 'import { f } from "./f.js";\nexport function arr() { const [n] = [-1]; return f(n); }\n',
      "e4.js": 'import { f } from "./f.js";\nexport function renamed() { const { n: m } = { n: -1 }; return f(m); }\n',
    });
    for (const file of ["e2.js", "e3.js", "e4.js"]) {
      expect(codes(dir, file), file).toContain("nudo:constraint-violated");
    }
  }, 120000);

  it("负控制：`let` 绑定未遮蔽时仍取不到静态值（不发明义务）", () => {
    const dir = fixture({
      "f.js": CALLEE,
      "f.nudo.js": CALLEE_SIDECAR,
      "ok.js": [
        'import { f } from "./f.js";',
        "export function run(v) { let x = v; x = x + 1; return f(x); }",
        "",
      ].join("\n"),
    });
    expect(codes(dir, "ok.js")).not.toContain("nudo:constraint-violated");
  }, 60000);
});

describe("D8 · 循环头 const（BUG-001）", () => {
  it("`for (const i = 0; i < 4; i++)` 判必抛", () => {
    const dir = fixture({
      "c1.js": "export function f() { let s = 0; for (const i = 0; i < 4; i++) { s += i; } return s; }\n",
    });
    expect(codes(dir, "c1.js")).toContain("nudo:entry-may-throw");
  }, 60000);

  it("负控制：`for (let i = 0; …)` 仍是 OK", () => {
    const dir = fixture({
      "c3.js": "export function f() { let s = 0; for (let i = 0; i < 4; i++) { s += i; } return s; }\n",
    });
    expect(codes(dir, "c3.js")).not.toContain("nudo:entry-may-throw");
  }, 60000);
});

describe("D8 · 能力档诊断（BUG-026）", () => {
  it("strict 档下 check 也报 capability-denied（与 test 同口径）", () => {
    const dir = fixture({
      "cap-fs.cjs": [
        'const fs = require("node:fs");',
        'module.exports = { read: (p) => fs.readFileSync(p, "utf8") };',
        "",
      ].join("\n"),
    });
    expect(codes(dir, "cap-fs.cjs")).toContain("nudo:capability-denied");
  }, 60000);
});

describe("D3 · 模块装载期必抛（BUG-025）", () => {
  it("BigInt 混型 `1n + 1` ⇒ module-throw", () => {
    const dir = fixture({
      "bigint.js": 'export const x = 1n + 1;\n',
    });
    expect(codes(dir, "bigint.js")).toContain("nudo:module-throw");
  }, 60000);

  it("`in` 右操作数是原始值 ⇒ module-throw", () => {
    const dir = fixture({ "in.js": 'export const x = "abc" in 5;\n' });
    expect(codes(dir, "in.js")).toContain("nudo:module-throw");
  }, 60000);

  it("BigInt 除零 ⇒ module-throw", () => {
    const dir = fixture({ "div.js": "export const x = 1n / 0n;\n" });
    expect(codes(dir, "div.js")).toContain("nudo:module-throw");
  }, 60000);

  it("对象字面量缺成员被调用 `({}).m()` ⇒ module-throw", () => {
    const dir = fixture({ "nc.js": "export const x = ({}).m();\n" });
    expect(codes(dir, "nc.js")).toContain("nudo:module-throw");
  }, 60000);

  it("负控制：`1n + 1n` 不抛", () => {
    const dir = fixture({ "ok.js": "export const x = 1n + 1n;\n" });
    expect(codes(dir, "ok.js")).not.toContain("nudo:module-throw");
  }, 60000);
});
