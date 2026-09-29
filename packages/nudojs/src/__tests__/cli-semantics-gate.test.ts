/**
 * CLI 语义门禁（design-cli-semantics review P0/P1）：
 * - L2 export 形态矩阵
 * - test --json 断言失败挡 exit
 * - check --abs 仍门禁 + 入口 any 展示
 * - 非法 --entry-throws 拒绝
 * - deprecation 路径存在
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../..", import.meta.url));
const cli = join(root, "packages/nudojs/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "false" },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
  };
}

const dir = mkdtempSync(join(tmpdir(), "nudo-cli-sem-"));

function write(name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src);
  return p;
}

describe("L2 export form matrix via CLI check", () => {
  const cases: Array<{ id: string; src: string; expectL2: boolean }> = [
    {
      id: "export-function",
      src: "export function getName(user){ return user.name; }\n",
      expectL2: true,
    },
    {
      id: "export-default-function",
      src: "export default function getName(user){ return user.name; }\n",
      expectL2: true,
    },
    {
      id: "export-const-arrow",
      src: "export const getName = (user) => user.name;\n",
      expectL2: true,
    },
    {
      id: "export-explicit-throw",
      src: 'export function boom(){ throw new TypeError("x"); }\n',
      expectL2: true,
    },
    {
      id: "cjs-exports",
      src: "exports.getName = function getName(user){ return user.name; };\n",
      expectL2: true,
    },
    {
      id: "try-catch-ok",
      src: "export function getName(user){ try { return user.name; } catch { return 'n'; } }\n",
      expectL2: false,
    },
    {
      id: "nested-try-outer-catch-ok",
      src: "export function getName(user){ try { try { return user.name; } finally {} } catch { return 'n'; } }\n",
      expectL2: false,
    },
    {
      id: "cjs-object-method",
      src: "module.exports = { getName(user){ return user.name; } };\n",
      expectL2: true,
    },
    {
      id: "export-alias",
      src: "function getName(user){ return user.name; }\nexport { getName as publicName };\n",
      expectL2: true,
    },
    {
      id: "export-default-anon-arrow",
      src: "export default (user) => user.name;\n",
      expectL2: true,
    },
    {
      id: "export-class-static",
      src: "export class Foo { static bar(u){ return u.name; } }\n",
      expectL2: true,
    },
  ];

  for (const c of cases) {
    it(`${c.id} → L2=${c.expectL2}`, () => {
      const p = write(`${c.id}.js`, c.src);
      const r = runCli(["check", p]);
      const hasL2 = (r.stdout + r.stderr).includes("nudo:entry-may-throw");
      expect(hasL2, `${r.stdout}${r.stderr}`).toBe(c.expectL2);
      expect(r.status, `${r.stdout}${r.stderr}`).toBe(c.expectL2 ? 1 : 0);
    });
  }
});

describe("check --abs still gates; entry params display any", () => {
  it("L2 file: abs face shows any and exit 1", () => {
    const p = write(
      "abs-l2.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["check", p, "--abs"]);
    expect(r.stdout).toContain("getName(any)");
    expect(r.stdout).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });

  it("--ignore-throws TypeError clears abs gate exit", () => {
    const p = write(
      "abs-ok.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["check", p, "--abs", "--ignore-throws", "TypeError"]);
    expect(r.stdout).toContain("getName(any)");
    expect(r.stdout).not.toContain("nudo:entry-may-throw");
    expect(r.status).toBe(0);
  });

  it("ignore-throws still shows throws domain on signature", () => {
    const p = write(
      "abs-keep-throws.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["check", p, "--ignore-throws", "TypeError"]);
    expect(r.stdout).toContain("throws TypeError");
    expect(r.status).toBe(0);
  });
});

describe("package.json#nudo.check config", () => {
  it("ignoreThrows from package.json clears L2", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-cfg-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", nudo: { check: { ignoreThrows: ["TypeError"] } } }),
    );
    writeFileSync(join(dir, "a.js"), "export function getName(user){ return user.name; }\n");
    // cwd 保持 monorepo root（tsx 从 packages/nudojs 解析 workspace dist）；
    // findProjectConfig 按**文件路径**向上找 package.json#nudo.check
    const r = runCli(["check", join(dir, "a.js")]);
    expect(r.stdout + r.stderr, `status=${r.status}\n${r.stdout}\n${r.stderr}`).not.toContain(
      "nudo:entry-may-throw",
    );
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
  });

  it("entryThrows off from package.json clears L2", () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-cli-cfg-off-"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "t", nudo: { check: { entryThrows: "off" } } }),
    );
    writeFileSync(join(dir, "a.js"), "export function getName(user){ return user.name; }\n");
    const r = runCli(["check", join(dir, "a.js")]);
    expect(r.stdout + r.stderr, `status=${r.status}\n${r.stdout}\n${r.stderr}`).not.toContain(
      "nudo:entry-may-throw",
    );
    expect(r.status, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`).toBe(0);
  });
});

describe("test exit honesty", () => {
  it("synthetic L2 may-throw does not gate test exit", () => {
    const p = write(
      "test-syn-l2.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["test", p]);
    expect(r.stdout).toContain("entry@");
    expect(r.stdout).toContain("throws TypeError");
    expect(r.status).toBe(0);
  });

  it("test --abs prints assertion report on declared failure", () => {
    const p = write(
      "test-abs-fail.js",
      `/**
 * @nudo:case "bad" (1) => 2
 */
export function wrong() { return 1; }
`,
    );
    const r = runCli(["test", p, "--abs"]);
    expect(r.stdout).toContain("assertions");
    expect(r.stdout).toContain("FAIL");
    expect(r.status).toBe(1);
  });
});

describe("CLI flag contract", () => {
  it("rejects invalid --entry-throws", () => {
    const p = write("bogus.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", p, "--entry-throws", "bogus"]);
    expect(r.stderr + r.stdout).toContain("Invalid --entry-throws");
    expect(r.status).toBe(1);
  });

  it("check --json multi-file emits CheckJsonMulti envelope", () => {
    const a = write("mj-a.js", "export function id(x){ return x; }\n");
    const b = write("mj-b.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", a, b, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.kind).toBe("multi");
    expect(parsed.version).toBe(1);
    expect(parsed.reports).toHaveLength(2);
    expect(parsed.summary.files).toBe(2);
  });

  it("check --json single file stays bare CheckJson", () => {
    const a = write("sj-a.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", a, "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.kind).toBeUndefined();
    expect(parsed.file).toContain("sj-a.js");
  });
});

describe("check --json ok↔exit single source (BUG-008)", () => {
  it("good+missing mixed: stdout non-empty, ok:false ⇔ exit 1", () => {
    const a = write("mix-good.js", "export function id(x){ return x; }\n");
    const missing = join(dir, "mix-missing.js");
    const r = runCli(["check", a, missing, "--json"]);
    expect(r.stdout.length, `stdout empty; stderr=${r.stderr}`).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(parsed.pathErrors[0].path).toContain("mix-missing.js");
    // ok ⇔ exit0
    expect(r.status).toBe(parsed.ok ? 0 : 1);
    expect(r.status).toBe(1);
  });

  it("only missing: stdout non-empty CheckJsonMulti with pathErrors, exit 1", () => {
    const missing = join(dir, "only-missing.js");
    const r = runCli(["check", missing, "--json"]);
    expect(r.stdout.length, `stdout empty; stderr=${r.stderr}`).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.kind).toBe("multi");
    expect(parsed.ok).toBe(false);
    expect(parsed.reports).toEqual([]);
    expect(parsed.pathErrors?.length).toBeGreaterThan(0);
    expect(r.status).toBe(1);
  });

  it("good only: ok:true ⇔ exit 0", () => {
    const a = write("solo-good.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", a, "--json"]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.ok).toBe(true);
    expect(r.status).toBe(0);
  });

  it("multi good files still ok:true ⇔ exit 0", () => {
    const a = write("mg-a.js", "export function id(x){ return x; }\n");
    const b = write("mg-b.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", a, b, "--json"]);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.kind).toBe("multi");
    expect(parsed.ok).toBe(true);
    expect(parsed.pathErrors).toBeUndefined();
    expect(r.status).toBe(0);
  });

  it("test --json missing path emits CaseJson body with pathErrors, exit 1", () => {
    const missing = join(dir, "test-missing.js");
    const r = runCli(["test", missing, "--json"]);
    expect(r.stdout.length, `stdout empty; stderr=${r.stderr}`).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(r.status).toBe(1);
  });

  it("test --json good+missing includes pathErrors and exit 1", () => {
    const a = write("test-mix-good.js", "export function id(x){ return x; }\n");
    const missing = join(dir, "test-mix-missing.js");
    const r = runCli(["test", a, missing, "--json"]);
    expect(r.stdout.length).toBeGreaterThan(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.file).toContain("test-mix-good.js");
    expect(parsed.pathErrors?.length ?? 0).toBeGreaterThan(0);
    expect(r.status).toBe(1);
  });
});
