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
const cli = join(root, "packages/cli/src/index.ts");
const tsx = join(root, "node_modules/.bin/tsx");

function runCli(
  args: string[],
  opts: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(tsx, [cli, ...args], {
    cwd: opts.cwd ?? root,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
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
});

describe("test --json exits 1 on declared assertion failure", () => {
  it("failed @nudo:case => expected", () => {
    const p = write(
      "assert-fail.js",
      `/**
 * @nudo:case "bad" (1) => 2
 */
export function wrong() { return 1; }
`,
    );
    const r = runCli(["test", p, "--json"]);
    const json = JSON.parse(r.stdout) as {
      assertions?: { passed?: number; failed?: number };
    };
    expect(json.assertions?.failed).toBe(1);
    expect(r.status).toBe(1);
  });

  it("passing declared case exits 0", () => {
    const p = write(
      "assert-pass.js",
      `/**
 * @nudo:case "ok" (1) => 1
 */
export function id(x) { return x; }
`,
    );
    const r = runCli(["test", p, "--json"]);
    const json = JSON.parse(r.stdout) as {
      assertions?: { passed?: number; failed?: number };
    };
    expect(json.assertions?.passed).toBe(1);
    expect(json.assertions?.failed).toBe(0);
    expect(r.status).toBe(0);
  });
});

describe("CLI flag / deprecation contract", () => {
  it("rejects invalid --entry-throws", () => {
    const p = write("bogus.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", p, "--entry-throws", "bogus"]);
    expect(r.stderr + r.stdout).toContain("Invalid --entry-throws");
    expect(r.status).toBe(1);
  });

  it("infer prints deprecation and still runs", () => {
    const p = write(
      "dep-infer.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["infer", p]);
    expect(r.stderr + r.stdout).toContain("deprecated");
    expect(r.stderr + r.stdout).toContain("nudo check");
  });

  it("types deprecates and maps to check --abs with gate", () => {
    const p = write(
      "dep-types.js",
      "export function getName(user){ return user.name; }\n",
    );
    const r = runCli(["types", p]);
    expect(r.stderr + r.stdout).toContain("deprecated");
    expect(r.stdout).toContain("getName(any)");
    expect(r.status).toBe(1);
  });

  it("check --json rejects multi-file targets", () => {
    const a = write("mj-a.js", "export function id(x){ return x; }\n");
    const r = runCli(["check", a, a, "--json"]);
    expect(r.stderr + r.stdout).toContain("single file");
    expect(r.status).toBe(1);
  });
});
