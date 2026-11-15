/**
 * 缺陷报告类别 09 ——「CLI 机器面：JSON 信封、exit 契约与字段一致性」11 条回归钉：
 *
 * Bug 10 / 40 / 45 / 55 / 79 / 84 / 85 / 91 / 100 / 107 / 108。
 *
 * 夹具一律 `writeSrcTsconfig` ⇒ 子进程解析 `@nudojs/*` 到仓内 `src`。
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runCliNode as runCli,
  repoRoot,
  writeSrcTsconfig,
} from "./helpers/run-cli.ts";

function fixture(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `nudo-bug09-${tag}-`));
  writeSrcTsconfig(dir);
  writeFileSync(
    join(dir, "package.json"),
    '{"name":"bug09","version":"1.0.0","type":"module"}\n',
    "utf-8",
  );
  return dir;
}

function json(r: { stdout: string }): any {
  return JSON.parse(r.stdout);
}

/** 两条 directive-syntax：一条行内 @nudo:replaceFoo，一条函数级 @nudo:sample */
function directiveFixture(dir: string): string {
  const f = join(dir, "both.js");
  writeFileSync(
    f,
    '/// @nudo:replaceFoo helper number()\n/**\n * @nudo:sample n random()\n */\nexport function helper(v) { return v; }\nexport function use() { return helper("abc"); }\n',
    "utf-8",
  );
  return f;
}

describe("类别 09 · CLI 机器面", () => {
  it("Bug 10：check --json --gitlab 的 stdout 恰好一份 JSON 文档（注解走 stderr）", () => {
    const dir = fixture("10");
    const bad = join(dir, "bad.js");
    writeFileSync(bad, "export function broken( {\n  return 1;\n", "utf-8");
    const r = runCli(["check", "--json", "--gitlab", bad]);
    expect(r.status).toBe(1);
    expect(() => json(r)).not.toThrow();
    expect(json(r).ok).toBe(false);
    expect(r.stderr.trim().length).toBeGreaterThan(0);
  });

  it("Bug 40：--watch --json 的 --from 路径错误进信封并落 exit 1", () => {
    const dir = fixture("40");
    writeFileSync(join(dir, "lib.js"), "/** @nudo:throws TypeError */\nexport function f(x) { return x + 1; }\n");
    const probe = join(dir, "probe.mts");
    writeFileSync(
      probe,
      `import { startCheckWatch } from ${JSON.stringify(join(repoRoot, "packages/nudojs/src/commands/check-command.ts"))};
process.exitCode = undefined;
const stop = startCheckWatch(["lib.js"], {
  from: ["__missing.js"], humanMode: false, jsonFace: true,
  shared: { fromPaths: ["__missing.js"] } as any,
} as any);
setTimeout(() => { console.error("FINAL_EXITCODE", process.exitCode); stop(); process.exit(0); }, 2000);
`,
      "utf-8",
    );
    const r = spawnSync(join(repoRoot, "node_modules/.bin/tsx"), [probe], {
      cwd: dir,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain("FINAL_EXITCODE 1");
    expect(r.stdout).toContain('"ok":false');
    expect(r.stdout).toContain("pathErrors");
  }, 60_000);

  it("Bug 45：contract --json 的 variadic 吞噬用法错误也出 JSON 信封", () => {
    const dir = fixture("45");
    writeFileSync(join(dir, "lib.js"), "export function f(x) { return x; }\n");
    const usage = join(dir, "usage.js");
    writeFileSync(usage, 'import { f } from "./lib.js";\nf(1);\n');
    const r = runCli(["contract", "--json", "--from", usage]);
    expect(r.status).toBe(1);
    const d = json(r);
    expect(Array.isArray(d)).toBe(true);
    expect(d[0].pathErrors[0].code).toBe("nudo:usage-error");
  });

  it("Bug 55：health --from 不吞掉侧车加载失败诊断", () => {
    const dir = fixture("55");
    const lib = join(dir, "lib.js");
    writeFileSync(lib, 'export function greet(name) { return "hi " + name; }\n');
    writeFileSync(
      join(dir, "lib.nudo.js"),
      'import { fn } from "@nudojs/core";\nthrow new Error("broken sidecar");\n',
    );
    const usage = join(dir, "usage.js");
    writeFileSync(usage, 'import { greet } from "./lib.js";\ngreet("x");\n');
    const plain = runCli(["health", lib, "--json"]);
    const withFrom = runCli(["health", lib, "--from", usage, "--json"]);
    expect(json(plain).ok).toBe(false);
    expect(json(withFrom).ok).toBe(false);
    expect(json(withFrom).summary.errors).toBeGreaterThan(0);
  });

  it("Bug 79：位置参数目标去重（check / test / verify / health）", () => {
    const dir = fixture("79");
    const src = join(dir, "src");
    mkdirSync(src);
    const lib = join(src, "lib.js");
    writeFileSync(lib, "export function add(a, b) { return a + b; }\n");
    writeFileSync(join(src, "other.js"), 'export function greet(n) { return "hi " + n; }\n');
    const check = runCli(["check", src, lib, "--json"]);
    expect(json(check).reports.length).toBe(2);
    expect(json(check).summary.files).toBe(2);
    expect(runCli(["test", lib, lib, "--json"]).status).toBe(0);
    const verify = runCli(["migrate", "verify", src, lib, "--json"]);
    expect(json(verify).length).toBe(2);
    const health = runCli(["health", src, lib, "--json"]);
    expect(json(health).files.length).toBe(2);
  }, 90_000);

  it("Bug 84：指令诊断保留 parser 给出的位置（JSON / GHA）", () => {
    const dir = fixture("84");
    const both = directiveFixture(dir);
    const r = runCli(["check", both, "--json"]);
    const ds = json(r).issues.filter((i: any) => i.code === "nudo:directive-syntax");
    expect(ds.length).toBe(2);
    expect(ds.every((i: any) => typeof i.line === "number" && typeof i.column === "number")).toBe(true);
    const gha = runCli(["check", both, "--gha"]);
    expect(gha.stdout).toContain("line=2");
  });

  it("Bug 85：test 面补上行内指令（@nudo:replace / @nudo:as）文法诊断", () => {
    const dir = fixture("85");
    const both = directiveFixture(dir);
    const r = runCli(["test", both, "--json"]);
    const ds = json(r).diagnostics.filter((i: any) => i.code === "nudo:directive-syntax");
    expect(ds.length).toBe(2);
    const inlineOnly = join(dir, "only-inline.js");
    writeFileSync(
      inlineOnly,
      '/// @nudo:replaceFoo helper number()\nexport function helper(v) { return v; }\n',
    );
    const r2 = runCli(["test", inlineOnly, "--json"]);
    expect(json(r2).diagnostics.filter((i: any) => i.code === "nudo:directive-syntax").length).toBe(1);
  });

  it("Bug 91：check --abs 对必抛函数打印 never / conf: exact", () => {
    const dir = fixture("91");
    const a = join(dir, "a.js");
    writeFileSync(
      a,
      '/** @nudo:throws TypeError */\nexport function alwaysThrows() { throw new TypeError("boom"); }\nexport function returnsValue() { return 5; }\n',
    );
    const r = runCli(["check", a, "--abs"]);
    expect(r.stdout).toContain("never");
    expect(r.stdout).toContain("conf: exact");
    expect(r.stdout).not.toMatch(/alwaysThrows\(\)\s*\n\s*unknown/);
  });

  it("Bug 100：migrate status --json 对无效的 nudo 形状报 nudoConfig:false", () => {
    const dir = fixture("100");
    writeFileSync(join(dir, "package.json"), '{"name":"bug09","version":"1.0.0","nudo":null}\n');
    writeFileSync(join(dir, "a.ts"), "export function f(x) { return x; }\n");
    const r = runCli(["migrate", "status", dir, "--json"]);
    expect(json(r)[0].nudoConfig).toBe(false);
  });

  it("Bug 107：--abs --quiet 同时生效（代数面在、签名表被压）", () => {
    const dir = fixture("107");
    const clean = join(dir, "clean.js");
    writeFileSync(clean, "export function clean(x) { return x; }\n");
    const r = runCli(["check", clean, "--abs", "--quiet"]);
    expect(r.stdout).toContain("clean(any)");
    expect(r.stdout).toContain("conf: path");
    expect(r.stdout).not.toContain("signatures");
  });

  it("Bug 108：test <missing> --json 的失败信封带 ok / summary.errors", () => {
    const dir = fixture("108");
    const r = runCli(["test", join(dir, "missing.js"), "--json"]);
    expect(r.status).toBe(1);
    const d = json(r);
    expect(d.ok).toBe(false);
    expect(typeof d.summary.errors).toBe("number");
  });
});
