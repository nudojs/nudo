import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  chmodSync,
} from "node:fs";
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

  it("verify fails when nudo check is red and passes when green", { timeout: 30_000 }, async () => {
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

  // BUG-005: verify 的 ok 必须与 nudo check 同源——@nudo:skip 由 host 下传
  // （skips: collectSkipReturns），verify 漏传会把 check 认为干净的文件判红。
  it("verify agrees with nudo check on @nudo:skip (both gates green)", { timeout: 30_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-verify-skip-"));
    dirs.push(dir);
    // 与上一用例的 bad.js 同形（L2 entry may-throw），但声明 @nudo:skip：
    // check 门禁尊重 skip → ok；verify 的 nudoOk 必须同绿。
    const f = join(dir, "skip.js");
    writeFileSync(
      f,
      `/**\n * @nudo:skip\n */\nexport function getName(user) {\n  return user.name;\n}\n`,
      "utf-8",
    );
    const rows = await migrateVerify([f]);
    expect(rows[0]!.nudoOk).toBe(true);
    // 对拍：同一文件走真实 check 门禁（exit 0 = ok）——两门禁判定一致
    const r = cli(["check", f]);
    expect(r.status).toBe(0);
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

  it("pnpm-workspace.yaml: status covers workspace sub-packages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-pnpm-status-"));
    dirs.push(dir);
    // 本仓形态：根 package.json 无 workspaces，包声明在 pnpm-workspace.yaml
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", private: true }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      [
        "# pnpm workspace",
        "packages:",
        '  - "packages/*" # trailing comment',
        "  - 'apps/*'",
        "allowBuilds:",
        "  esbuild: true",
        "minimumReleaseAgeExclude:",
        "  - 'vitest@5.0.2'",
        "",
      ].join("\n"),
      "utf-8",
    );
    for (const [sub, name] of [
      ["packages", "a"],
      ["apps", "b"],
    ] as const) {
      const p = join(dir, sub, name);
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
      mkdirSync(join(p, "src"));
      writeFileSync(join(p, "src", "x.ts"), `export const x: number = 1;\n`, "utf-8");
    }
    // decoy：后续顶格 key 下的 list 不得当成包路径
    const rows = migrateStatus(dir);
    expect(rows).toHaveLength(3); // root + packages/a + apps/b
    const subs = rows.filter((r) => r.typescriptDep);
    expect(subs).toHaveLength(2);
    for (const r of subs) {
      expect(r.tsFiles).toBe(1);
      expect(r.tscScripts).toContain("typecheck");
    }
  });

  it("pnpm-workspace.yaml: retire --all covers workspace sub-packages", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-pnpm-retire-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", private: true }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      ["packages:", '  - "packages/*"', "  - 'tools/*'", ""].join("\n"),
      "utf-8",
    );
    for (const [sub, name] of [
      ["packages", "a"],
      ["packages", "b"],
      ["tools", "c"],
    ] as const) {
      const p = join(dir, sub, name);
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
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.removedDeps.length).toBeGreaterThan(0);
      const abs = resolve(r.root);
      expect(existsSync(join(abs, ".nudo", "migrate-retired.json"))).toBe(true);
      const pkg = JSON.parse(readFileSync(join(abs, "package.json"), "utf-8"));
      expect(pkg.devDependencies.typescript).toBeUndefined();
      expect(pkg.scripts.typecheck).toContain("nudo check");
    }
  });

  it("packageRoots merges package.json#workspaces and pnpm-workspace.yaml without dupes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-pnpm-merge-"));
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "root", private: true, workspaces: ["packages/*"] }),
      "utf-8",
    );
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      ["packages:", '  - "packages/*"', "  - apps/*", ""].join("\n"),
      "utf-8",
    );
    for (const [sub, name] of [
      ["packages", "a"],
      ["apps", "b"],
    ] as const) {
      const p = join(dir, sub, name);
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
    const rows = migrateStatus(dir);
    // root + packages/a（两源同 pattern，去重）+ apps/b
    expect(rows).toHaveLength(3);
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

  it("rewriteTscCommand: -p/--project scope is preserved (monorepo)", () => {
    // tsconfig 文件 → 所在目录（非 "." 一律单引号字面量）
    expect(rewriteTscCommand("tsc -p packages/foo/tsconfig.json").cmd).toBe(
      "nudo check 'packages/foo'",
    );
    expect(rewriteTscCommand("tsc --project packages/foo/tsconfig.json --noEmit").cmd).toBe(
      "nudo check 'packages/foo'",
    );
    // 目录原样
    expect(rewriteTscCommand("tsc -p packages/foo").cmd).toBe("nudo check 'packages/foo'");
    expect(rewriteTscCommand("tsc --project=packages/bar").cmd).toBe("nudo check 'packages/bar'");
    // -b 带路径同样保留
    expect(rewriteTscCommand("tsc -b packages/foo").cmd).toBe("nudo check 'packages/foo'");
    expect(rewriteTscCommand("tsc --build apps/web/tsconfig.json").cmd).toBe(
      "nudo check 'apps/web'",
    );
    // 裸 -b / 无 -p 仍是 cwd
    expect(rewriteTscCommand("tsc -b").cmd).toBe("nudo check .");
    // runner 前缀 + 项目路径
    expect(rewriteTscCommand("pnpm exec tsc -p packages/foo/tsconfig.json").cmd).toBe(
      "npx nudojs check 'packages/foo'",
    );
  });

  // BUG-019 / F-4：重写后的路径必须是安全字面量，不得引入 shell 注入面
  it("rewriteTscCommand: path with shell metacharacters stays a safe literal", () => {
    // 原先单引号字面量被去壳后裸写 → $( ) 在 CI 展开
    expect(rewriteTscCommand("tsc -p 'x$(id)'").cmd).toBe("nudo check 'x$(id)'");
    // .json 会折叠到 dirname：元字符须在目录段才存活
    expect(rewriteTscCommand("tsc -p 'tsconfig.$(echo pwned)/tsconfig.json'").cmd).toBe(
      "nudo check 'tsconfig.$(echo pwned)'",
    );
    // backtick / glob 同理（非 .json 路径原样保留）
    expect(rewriteTscCommand("tsc -p 'src/`id`.ts'").cmd).toBe("nudo check 'src/`id`.ts'");
    expect(rewriteTscCommand("tsc -p 'foo*'").cmd).toBe("nudo check 'foo*'");
    // 含空白 + 元字符：旧 JSON.stringify 双引号内 $() 仍会展开
    expect(rewriteTscCommand("tsc -p 'dir with space/$(id)'").cmd).toBe(
      "nudo check 'dir with space/$(id)'",
    );
    // 路径内单引号按 '\'' 转义，整体仍是单引号字面量
    expect(rewriteTscCommand(`tsc -p "a'b$(id)"`).cmd).toBe(`nudo check 'a'\\''b$(id)'`);
    // 空格路径也不得回退到双引号；tsconfig 文件 → 目录为 "." 时保持裸写
    expect(rewriteTscCommand("tsc -p 'my tsconfig.json'").cmd).toBe("nudo check .");
    expect(rewriteTscCommand("tsc -p 'dir with space'").cmd).toBe("nudo check 'dir with space'");
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

  it("CLI migrate status is wired", { timeout: 30_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-cli-"));
    dirs.push(dir);
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x", scripts: {} }), "utf-8");
    const r = cli(["migrate", "status", dir, "--json"]);
    // command should parse (status 0) and emit JSON rows
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"packageJson"');
  });

  // BUG-009 / F-4: 不存在路径禁止 silent dirname 回退到真实 package 根
  it("missing path is rejected by status/retire/retireAll (never falls back to parent root)", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-missing-"));
    dirs.push(dir);
    const pkgBefore = JSON.stringify({
      name: "real-root",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.0.0" },
    });
    writeFileSync(join(dir, "package.json"), pkgBefore, "utf-8");
    const missing = join(dir, "typo-does-not-exist");

    expect(() => migrateStatus(missing)).toThrow(/not found/);
    expect(() => migrateRetire(missing, { workflows: false })).toThrow(/not found/);
    expect(() => migrateRetireAll(missing, { workflows: false })).toThrow(/not found/);

    // 零写入：父 package.json 原样，无 retire 标记
    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(pkgBefore);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
  });

  it("missing path is rejected by strip/verify with zero writes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-missing-io-"));
    dirs.push(dir);
    const pkgBefore = JSON.stringify({ name: "real-root" });
    writeFileSync(join(dir, "package.json"), pkgBefore, "utf-8");
    const missing = join(dir, "typo-does-not-exist");

    await expect(migrateStrip([missing], { write: true })).rejects.toThrow(/not found/);
    await expect(migrateVerify([missing])).rejects.toThrow(/not found/);

    expect(readFileSync(join(dir, "package.json"), "utf-8")).toBe(pkgBefore);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".js"))).toHaveLength(0);
  });

  it("existing package.json / source file still resolves to its directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-migrate-file-root-"));
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
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "a.ts"), `export const x: number = 1;\n`, "utf-8");

    // 传 package.json 文件本身 → 仍取所在目录（保留既有契约）
    const rows = migrateStatus(join(dir, "package.json"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.typescriptDep).toBe(true);
    expect(rows[0]!.tsFiles).toBe(1);

    const result = migrateRetire(join(dir, "package.json"), { workflows: false });
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
  });

  // BUG-010 / F-4: retire 持久化必须原子——注入写失败时树一致或可恢复
  function setupRetireFixture(name: string): {
    dir: string;
    pkgPath: string;
    wfPath: string;
    pkgBefore: string;
    wfBefore: string;
  } {
    const dir = mkdtempSync(join(tmpdir(), `nudo-migrate-${name}-`));
    dirs.push(dir);
    const pkgBefore = JSON.stringify(
      {
        name: "demo",
        scripts: { typecheck: "tsc --noEmit" },
        devDependencies: { typescript: "^5.0.0" },
      },
      null,
      2,
    );
    const pkgPath = join(dir, "package.json");
    writeFileSync(pkgPath, pkgBefore, "utf-8");
    const wfDir = join(dir, ".github", "workflows");
    mkdirSync(wfDir, { recursive: true });
    const wfPath = join(wfDir, "ci.yml");
    const wfBefore = "name: CI\njobs:\n  check:\n    steps:\n      - run: npx tsc --noEmit\n";
    writeFileSync(wfPath, wfBefore, "utf-8");
    return { dir, pkgPath, wfPath, pkgBefore, wfBefore };
  }

  it("BUG-010: package.json write failure leaves tree unchanged (zero half-state)", () => {
    const { dir, pkgPath, wfPath, pkgBefore, wfBefore } = setupRetireFixture("retire-fail-pkg");
    // 整包目录只读 → package.json（第一个写）即失败
    chmodSync(dir, 0o555);
    try {
      expect(() => migrateRetire(dir)).toThrow();
    } finally {
      chmodSync(dir, 0o755);
    }
    expect(readFileSync(pkgPath, "utf-8")).toBe(pkgBefore);
    expect(readFileSync(wfPath, "utf-8")).toBe(wfBefore);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo", "migrate-retiring.json"))).toBe(false);
  });

  it("BUG-010: workflow write failure rolls back package.json (no nudo-pkg + tsc-CI mix)", () => {
    const { dir, pkgPath, wfPath, pkgBefore, wfBefore } = setupRetireFixture("retire-fail-wf");
    const wfDir = join(dir, ".github", "workflows");
    // workflow 目录只读：package.json 先写成功，workflow 写失败 → 必须回滚 package.json
    chmodSync(wfDir, 0o555);
    try {
      expect(() => migrateRetire(dir)).toThrow();
    } finally {
      chmodSync(wfDir, 0o755);
    }
    // 一致：全旧（不能出现 package.json 已 nudo 而 workflow 仍 tsc）
    expect(readFileSync(pkgPath, "utf-8")).toBe(pkgBefore);
    expect(readFileSync(wfPath, "utf-8")).toBe(wfBefore);
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(false);
    expect(existsSync(join(dir, ".nudo", "migrate-retiring.json"))).toBe(false);
    // status 不得报 retired
    const rows = migrateStatus(dir);
    expect(rows[0]!.retired).toBe(false);
    expect(rows[0]!.retiring).toBe(false);
  });

  it("BUG-010: marker write failure rolls back package.json + workflows", () => {
    const { dir, pkgPath, wfPath, pkgBefore, wfBefore } = setupRetireFixture("retire-fail-marker");
    // marker 路径被目录占住 → rename 到目标失败（package.json + workflows 已写）
    mkdirSync(join(dir, ".nudo", "migrate-retired.json"), { recursive: true });
    expect(() => migrateRetire(dir)).toThrow();
    expect(readFileSync(pkgPath, "utf-8")).toBe(pkgBefore);
    expect(readFileSync(wfPath, "utf-8")).toBe(wfBefore);
    // 成功标记不存在（占位目录不算 retired）
    const rows = migrateStatus(dir);
    expect(rows[0]!.retired).toBe(false);
  });

  it("BUG-010: retire is recoverable after a failed attempt (re-run completes)", () => {
    const { dir, pkgPath, wfPath } = setupRetireFixture("retire-recover");
    mkdirSync(join(dir, ".nudo", "migrate-retired.json"), { recursive: true });
    expect(() => migrateRetire(dir)).toThrow();
    // 清掉故障注入后重跑 → 完整 retired
    rmSync(join(dir, ".nudo", "migrate-retired.json"), { recursive: true, force: true });
    const result = migrateRetire(dir);
    expect(result.removedDeps).toContain("devDependencies");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    expect(pkg.devDependencies?.typescript).toBeUndefined();
    expect(readFileSync(wfPath, "utf-8")).toContain("npx nudojs check .");
    const rows = migrateStatus(dir);
    expect(rows[0]!.retired).toBe(true);
    expect(rows[0]!.retiring).toBe(false);
  });
});
