/**
 * BUG-121 —— 返回契约若是「**shape 的 union**」，zod / standard / guard **三个
 * 运行时面全部塌缩**为「接受一切」⇒ 契约违约值被放行（假绿），而 dts / check
 * 仍保留 union ⇒ 四面互斥。
 *
 * 根因：`constraintDisproved` 的 `constraint.fields` 分支缺 `sum` 判定（与
 * `constraint.prim` 分支的处理**不对称**）⇒ identity 函数把 union 原样返回时
 * 逐个 shape 成员一律被判「已证否」⇒ 契约返回 Abs 被丢弃 ⇒ 回落 any。
 *
 * 钉：
 * - 三个运行时面都保留 union（不再 `z.unknown()` / `{"k":"unknown"}` /
 *   `return true`）；
 * - 运行时（Standard Schema 真跑）：契约违约值被**拒绝**，契约允许的值被接受；
 * - 与 dts 面同口径。
 */
import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx } from "./helpers/run-cli.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SRC = "export function G(x) {\n  return x;\n}\n";

const SIDECAR = [
  'import { fn, union, shape, lit, number, string } from "@nudojs/core";',
  "export const G = fn(",
  '  { x: union(shape({ kind: lit("a"), n: number() }), shape({ kind: lit("b"), s: string() })) },',
  '  union(shape({ kind: lit("a"), n: number() }), shape({ kind: lit("b"), s: string() })),',
  ");",
  "",
].join("\n");

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-b121-"));
  dirs.push(dir);
  writeFileSync(join(dir, "G.js"), SRC, "utf-8");
  writeFileSync(join(dir, "G.nudo.js"), SIDECAR, "utf-8");
  return dir;
}

describe("BUG-121 — shape-union 返回契约不塌缩", () => {
  it("zod / standard / guard 三面都保留 union（同一 zod 文件内 Input 与 Output 同口径）", () => {
    const dir = fixture();
    const r = runCliTsx(["export", join(dir, "G.js"), "--format", "all"]);
    expect(r.status).toBe(0);
    // zod 返回面不再是 z.unknown()
    expect(r.stdout).toMatch(/export const GOutput = z\.union\(\[/);
    expect(r.stdout).not.toMatch(/export const GOutput = z\.unknown\(\)/);
    // standard 节点是 union（不是 {"k":"unknown"}）
    expect(r.stdout).toContain('"k":"union","members"');
    // guard 不是恒真
    expect(r.stdout).not.toMatch(/export function isGOutput\(value: unknown\): boolean \{\s*const data = value as unknown;\s*return true;/);
    // dts 面保留 union（四面同口径）
    expect(r.stdout).toContain("kind: string; n: number } | { kind: string; s: string }");
  }, 60000);

  it("运行时：standard 面拒绝契约违约值、接受契约允许值", () => {
    const dir = fixture();
    const out = join(dir, "out");
    expect(runCliTsx(["export", join(dir, "G.js"), "--format", "standard", "--out", out]).status).toBe(0);
    const name = readdirSync(out).find((f) => f.endsWith(".nudo.standard.ts"));
    expect(name).toBeDefined();
    const artifact = readFileSync(join(out, name!), "utf-8");

    // artifact 里有类型标注 ⇒ 先剥类型再求值（node 的 strip-types）
    writeFileSync(join(dir, "artifact.mts"), artifact, "utf-8");
    const probe = join(dir, "probe.mjs");
    writeFileSync(
      probe,
      [
        `const m = await import(${JSON.stringify(join(dir, "artifact.mts"))});`,
        'const v = m.GOutput["~standard"];',
        'const bad = { kind: "z", q: 1 };',
        'const good = { kind: "a", n: 1 };',
        'console.log("bad", "issues" in v.validate(bad));',
        'console.log("good", "issues" in v.validate(good));',
        "",
      ].join("\n"),
      "utf-8",
    );
    const run = spawnSync(process.execPath, ["--experimental-strip-types", probe], { encoding: "utf8" });
    expect(`${run.stdout}${run.stderr}`).toContain("bad true");
    expect(`${run.stdout}${run.stderr}`).toContain("good false");
  }, 60000);
});
