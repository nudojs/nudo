import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  migrateStatus,
  migrateStrip,
  migrateVerify,
  migrateRetire,
  stripTsToJs,
} from "../migrate.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function cli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "pnpm",
      ["exec", "tsx", "packages/cli/src/index.ts", ...args],
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
    const result = migrateRetire(dir);
    expect(result.removedDeps).toContain("devDependencies");
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    expect(pkg.devDependencies.typescript).toBeUndefined();
    expect(pkg.scripts.typecheck).toContain("nudo check");
    expect(existsSync(join(dir, ".nudo", "migrate-retired.json"))).toBe(true);
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
