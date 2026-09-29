import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  migrateStatus,
  migrateStrip,
  migrateVerify,
  migrateRetire,
  migrateRetireAll,
  stripTsToJs,
  rewriteTscCommand,
  listWorkflowTscLines,
} from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function cli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "pnpm",
      ["exec", "tsx", "packages/nudojs/src/index.ts", ...args],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return {
      status: err.status ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

describe("nudo migrate", () => {
  it("stripTsToJs removes type annotations", () => {
    const { code, notes } = stripTsToJs(
      `export function add(a: number, b: number): number {\n  return a + b;\n}\n`,
    );
    expect(code).toContain("function add(a, b)");
    expect(code).not.toContain(": number");
    expect(notes.length).toBeGreaterThanOrEqual(0);
  });

  it("status reports tsc usage and blockers", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-status-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { build: "tsc -p ." },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), `export const x: number = 1;\n`, "utf-8");
    writeFileSync(join(dir, "tsconfig.json"), "{}\n", "utf-8");
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.typescriptDep).toBe(true);
    expect(rows[0]!.tsFiles).toBe(1);
    expect(rows[0]!.tscScripts).toContain("build");
  });

  it("strip --write emits .js and optional sidecar draft", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-strip-"));
    dirs.push(dir);
    const ts = join(dir, "math.ts");
    writeFileSync(
      ts,
      `export function double(n: number): number {\n  return n * 2;\n}\ndouble(2);\n`,
      "utf-8",
    );
    const results = await migrateStrip([ts], { write: true, draft: true });
    expect(results).toHaveLength(1);
    const jsPath = join(dir, "math.js");
    expect(existsSync(jsPath)).toBe(true);
    const js = readFileSync(jsPath, "utf-8");
    expect(js).toContain("function double(n)");
    expect(js).not.toContain(": number");
  });

  it("strip refuses explicit non-TS paths and never overwrites .js in place", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-strip-js-"));
    dirs.push(dir);
    const js = join(dir, "foo.js");
    const original = `export const x = 1; // keep me\n`;
    writeFileSync(js, original, "utf-8");
    await expect(migrateStrip([js], { write: true })).rejects.toThrow(/not a TypeScript source/);
    expect(readFileSync(js, "utf-8")).toBe(original);
    expect(existsSync(join(dir, "foo.d.js"))).toBe(false);
  });

  it("strip skips .d.ts declarations (no .d.js output)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-strip-dts-"));
    dirs.push(dir);
    writeFileSync(join(dir, "a.ts"), `export const x: number = 1;\n`, "utf-8");
    writeFileSync(join(dir, "b.d.ts"), `export declare function f(): void;\n`, "utf-8");
    writeFileSync(join(dir, "c.d.mts"), `export declare const y: number;\n`, "utf-8");
    const results = await migrateStrip([dir], { write: true, draft: false });
    const outs = results.map((r) => r.outFile);
    expect(outs.some((o) => o.endsWith(".d.js") || o.endsWith("b.d.js"))).toBe(false);
    expect(results.map((r) => r.file).some((f) => f.includes("b.d.ts") || f.includes("c.d.mts"))).toBe(false);
    expect(existsSync(join(dir, "b.d.js"))).toBe(false);
    expect(existsSync(join(dir, "c.d.mjs"))).toBe(false);
    expect(existsSync(join(dir, "a.js"))).toBe(true);
    // 显式 .d.ts 同样是用法错误，不产出 .d.js
    await expect(migrateStrip([join(dir, "b.d.ts")], { write: true })).rejects.toThrow(
      /not a TypeScript source/,
    );
    expect(existsSync(join(dir, "b.d.js"))).toBe(false);
  });

  it("status does not count .d.ts as stripable tsFiles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-status-dts-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "demo", scripts: { check: "nudo check ." } }),
      "utf-8",
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), `export const x: number = 1;\n`, "utf-8");
    writeFileSync(join(dir, "src", "ms.d.ts"), `export declare function ms(): void;\n`, "utf-8");
    writeFileSync(join(dir, "src", "lib.d.mts"), `export declare const z: number;\n`, "utf-8");
    const rows = migrateStatus(dir);
    expect(rows[0]!.tsFiles).toBe(1);
  });

  it("verify fails when nudo check is red and passes when green", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-verify-"));
    dirs.push(dir);
    // L2 entry may-throw (unconstrained param property access)
    const bad = join(dir, "bad.js");
    writeFileSync(bad, `export function getName(user) {\n  return user.name;\n}\n`, "utf-8");
    const badRows = await migrateVerify([bad]);
    expect(badRows[0]!.nudoOk).toBe(false);

    const ok = join(dir, "ok.js");
    writeFileSync(ok, `export function id(x){ return x; }\nid(1);\n`, "utf-8");
    const okRows = await migrateVerify([ok]);
    expect(okRows[0]!.nudoOk).toBe(true);
  });

  it("retire removes typescript dep and rewrites tsc scripts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-retire-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const result = migrateRetire(dir, { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  it("A1: rewrite tsc lines in .github/workflows on retire", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-wf-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      }),
      "utf-8",
    );
    const wfDir = join(dir, ".github", "workflows");
    mkdirSync(wfDir, { recursive: true });
    const wf = join(wfDir, "ci.yml");
    writeFileSync(
      wf,
      [
        "name: CI",
        "jobs:",
        "  check:",
        "    name: Lint (tsc x2)",
        "    steps:",
        "      - run: npx tsc --noEmit",
        "      - run: |",
        "          pnpm exec tsc -p .",
        "      - run: pnpm run typecheck",
        "",
      ].join("\n"),
      "utf-8",
    );

    expect(listWorkflowTscLines(dir).length).toBeGreaterThan(0);

    const dry = migrateRetire(dir, { dryRun: true });
    expect(dry.rewrittenWorkflows.length).toBeGreaterThan(0);
    // dry-run 不写盘
    expect(readFileSync(wf, "utf-8")).toContain("npx tsc --noEmit");

    const result = migrateRetire(dir);
    expect(result.rewrittenWorkflows.some((w) => w.to.includes("nudojs check"))).toBe(true);
    const text = readFileSync(wf, "utf-8");
    expect(text).toContain("npx nudojs check .");
    expect(text).toContain("- run: |");
    // job name 不被误伤
    expect(text).toContain("name: Lint (tsc x2)");
    // 已是 nudo 的 script 调用不改
    expect(text).toContain("pnpm run typecheck");
  });

  it("A1: migrateRetireAll batches workspace packages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-all-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "utf-8",
    );
    for (const name of ["a", "b"]) {
      const p = join(dir, "packages", name);
      mkdirSync(p, { recursive: true });
      writeFileSync(
        join(p, "package.json"),
        JSON.stringify({
          name,
          scripts: { typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.0.0" },
        }),
        "utf-8",
      );
    }
    const results = migrateRetireAll(dir, { workflows: false });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.removedDeps.length).toBeGreaterThan(0);
      // r.root 是相对 cwd 的路径
      expect(existsSync(join(resolve(r.root), ".nudo", "migrate-retired.json"))).toBe(true);
    }
  });

  it("rewriteTscCommand covers npx/pnpm/bare forms", () => {
    expect(rewriteTscCommand("npx tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("tsc --noEmit").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("pnpm exec tsc -p tsconfig.json").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("pnpm run typecheck").changed).toBe(false);
  });

  // F5-migrate-rewrite-tsc-flags-mangled：输入/期望输出逐行锁定
  it("rewriteTscCommand: runner prefix whitelist has no residual prefix", () => {
    // 裸 pnpm tsc 走 bare 段会留下 `pnpm ` → `pnpm nudo` 非产品命令
    expect(rewriteTscCommand("pnpm tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("pnpm tsc --noEmit").changed).toBe(true);
    // npm exec 不在旧前缀表 → `npm exec nudo check .` 残前缀
    expect(rewriteTscCommand("npm exec tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("npx --no-install tsc --noEmit").cmd).toBe("npx nudojs check .");
    expect(rewriteTscCommand("npm exec -- tsc --noEmit").cmd).toBe("npx nudojs check .");
    // script 形态前缀也不得残 `run `
    expect(rewriteTscCommand("pnpm run tsc --noEmit").cmd).toBe("npx nudojs check .");
    // 非产品 wrapper 保留，只换 tsc 本体
    expect(rewriteTscCommand("sudo tsc --noEmit").cmd).toBe("sudo nudo check .");
  });

  it("rewriteTscCommand: tsc flags are swallowed as a phrase, never residual", () => {
    // 旧 regex 固定顺序只吞 --noEmit/-p/--pretty/--skipLibCheck
    expect(rewriteTscCommand("tsc -b").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc --build").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc --project tsconfig.json").cmd).toBe("nudo check .");
    // 顺序无关：-p 在前时 --noEmit 旧实现会残留
    expect(rewriteTscCommand("tsc -p tsconfig.build.json --noEmit").cmd).toBe("nudo check .");
    // 未知旗标：剥离而非残留
    expect(rewriteTscCommand("tsc --someUnknownFlag --noEmit").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc --strict --incremental --pretty false").cmd).toBe("nudo check .");
    // 引号值属于短语，不得残成 check 参数
    expect(rewriteTscCommand('tsc -p "my tsconfig.json" --noEmit').cmd).toBe("nudo check .");
  });

  it("tsc inside shell strings / comments is not rewritten", () => {
    // 字符串里的 tsc 是普通文本
    expect(rewriteTscCommand('echo "please run tsc first"').changed).toBe(false);
    expect(rewriteTscCommand("echo 'please run tsc first'").changed).toBe(false);
    expect(rewriteTscCommand('echo "please run tsc first"').cmd).toBe(
      'echo "please run tsc first"',
    );
    // 注释里的 tsc 不是命令
    expect(rewriteTscCommand("tsc --noEmit # keep tsc around").cmd).toBe(
      "nudo check . # keep tsc around",
    );
    expect(rewriteTscCommand("# tsc --noEmit").changed).toBe(false);
    // 字符串外的真实 tsc 仍改写，字符串原样保留
    expect(rewriteTscCommand('tsc --noEmit && echo "tsc done"').cmd).toBe(
      'nudo check . && echo "tsc done"',
    );
  });

  it("workflow line with tsc only in a string is not a tsc line", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-str-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "demo" }), "utf-8");
    const wfDir = join(dir, ".github", "workflows");
    mkdirSync(wfDir, { recursive: true });
    const wf = join(wfDir, "ci.yml");
    writeFileSync(
      wf,
      [
        "name: CI",
        "jobs:",
        "  check:",
        "    steps:",
        '      - run: echo "please run tsc first"',
        "      - run: pnpm run lint && tsc --noEmit",
        "",
      ].join("\n"),
      "utf-8",
    );

    const hits = listWorkflowTscLines(dir);
    // 只有真 tsc 命令那行计入
    expect(hits.length).toBe(1);
    expect(hits[0]!.line).toContain("tsc --noEmit");

    const result = migrateRetire(dir);
    const text = readFileSync(wf, "utf-8");
    // 字符串里的 tsc 原样保留
    expect(text).toContain('echo "please run tsc first"');
    expect(text).toContain("nudo check .");
  });

  it("package.json script with tsc only in a string is not a tsc script", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-pkg-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "demo",
        scripts: {
          hint: 'echo "run tsc yourself"',
          typecheck: "tsc --noEmit",
        },
      }),
      "utf-8",
    );
    const rows = migrateStatus(dir);
    expect(rows[0]!.tscScripts).toEqual(["typecheck"]);
  });

  it("CLI migrate status is wired", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-cli-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }), "utf-8");
    const r = cli(["migrate", "status", dir, "--json"]);
    // command should parse (status 0) and emit JSON rows
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"packageJson"');
  });
});
