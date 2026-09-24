/**
 * check 门禁命名档（design-cli-semantics §1.4）：
 * - 默认 / --profile strict：L2 entry may-throw = error
 * - --profile adoption：L2 降 warning，exit 0；**不吞 L1**
 * - --entry-throws 显式压过 profile
 * - package.json#nudo.check.profile；entryThrows 比 profile 更具体
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

const dir = mkdtempSync(join(tmpdir(), "nudo-cli-profile-"));

function write(name: string, src: string): string {
  const p = join(dir, name);
  writeFileSync(p, src);
  return p;
}

/** L2-only：export 上未消化 may-throw */
const L2_SRC = "export function getName(user){ return user.name; }\n";

describe("check --profile", () => {
  it("default is strict: L2 error, exit 1", () => {
    const p = write("p-default.js", L2_SRC);
    const r = runCli(["check", p]);
    expect(r.stdout + r.stderr).toContain("nudo:entry-may-throw");
    expect(r.stdout + r.stderr).toMatch(/error/i);
    expect(r.status).toBe(1);
  });

  it("--profile strict keeps L2 error", () => {
    const p = write("p-strict.js", L2_SRC);
    const r = runCli(["check", p, "--profile", "strict"]);
    expect(r.stdout + r.stderr).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });

  it("--profile adoption demotes L2 to warning, exit 0", () => {
    const p = write("p-adoption.js", L2_SRC);
    const r = runCli(["check", p, "--profile", "adoption"]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("nudo:entry-may-throw");
    expect(out).toMatch(/warning/i);
    expect(r.status, out).toBe(0);
  });

  it("--entry-throws error overrides --profile adoption", () => {
    const p = write("p-override.js", L2_SRC);
    const r = runCli([
      "check",
      p,
      "--profile",
      "adoption",
      "--entry-throws",
      "error",
    ]);
    expect(r.stdout + r.stderr).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });

  it("--entry-throws off overrides --profile strict", () => {
    const p = write("p-off.js", L2_SRC);
    const r = runCli([
      "check",
      p,
      "--profile",
      "strict",
      "--entry-throws",
      "off",
    ]);
    expect(r.stdout + r.stderr).not.toContain("nudo:entry-may-throw");
    expect(r.status).toBe(0);
  });

  it("rejects invalid --profile", () => {
    const p = write("p-bogus.js", L2_SRC);
    const r = runCli(["check", p, "--profile", "bogus"]);
    expect(r.stderr + r.stdout).toContain("Invalid --profile");
    expect(r.status).toBe(1);
  });

  it("help documents --profile", () => {
    const r = runCli(["check", "--help"]);
    expect(r.stdout).toContain("--profile");
    expect(r.stdout).toContain("adoption");
  });
});

describe("package.json#nudo.check.profile", () => {
  it("profile adoption demotes L2", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-cli-pkg-prof-"));
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ name: "t", nudo: { check: { profile: "adoption" } } }),
    );
    writeFileSync(join(d, "a.js"), L2_SRC);
    const r = runCli(["check", join(d, "a.js")]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("nudo:entry-may-throw");
    expect(r.status, out).toBe(0);
  });

  it("explicit entryThrows beats package.json profile", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-cli-pkg-entry-"));
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({
        name: "t",
        nudo: { check: { profile: "adoption", entryThrows: "error" } },
      }),
    );
    writeFileSync(join(d, "a.js"), L2_SRC);
    const r = runCli(["check", join(d, "a.js")]);
    expect(r.stdout + r.stderr).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });

  it("CLI --profile strict overrides package.json profile adoption", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-cli-pkg-cli-"));
    writeFileSync(
      join(d, "package.json"),
      JSON.stringify({ name: "t", nudo: { check: { profile: "adoption" } } }),
    );
    writeFileSync(join(d, "a.js"), L2_SRC);
    const r = runCli(["check", join(d, "a.js"), "--profile", "strict"]);
    expect(r.stdout + r.stderr).toContain("nudo:entry-may-throw");
    expect(r.status).toBe(1);
  });
});

describe("adoption does not swallow L1", () => {
  it("L1 contract violation stays error under --profile adoption", () => {
    const d = mkdtempSync(join(tmpdir(), "nudo-cli-l1-"));
    writeFileSync(
      join(d, "l1.js"),
      "export function scale(x){ return x + 1; }\nscale(0);\n",
    );
    writeFileSync(
      join(d, "l1.nudo.js"),
      'import { number, fn } from "@nudojs/core";\nexport const scale = fn({ x: number().gt(0) }, number());\n',
    );
    const r = runCli(["check", join(d, "l1.js"), "--profile", "adoption"]);
    const out = r.stdout + r.stderr;
    expect(out).toContain("nudo:constraint-violated");
    expect(r.status, out).toBe(1);
  });
});
