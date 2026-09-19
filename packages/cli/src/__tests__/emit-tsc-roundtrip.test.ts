import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { analyzeFileAsync, generateFunctionDtsLines } from "@nudojs/service";

const dirs: string[] = [];

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tscNoEmit(file: string): { ok: boolean; stderr: string } {
  try {
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", file], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

describe("emit ↔ tsc roundtrip", () => {
  it("generated .d.ts passes tsc --noEmit --strict", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-emit-tsc-"));
    dirs.push(dir);
    const srcPath = join(dir, "sample.js");
    const source = `/**
 * @nudo:case "add" (5, 3)
 * @nudo:case "sym" (number(), number())
 */
function add(a, b) {
  return a + b;
}

/**
 * @nudo:case "inc" (1)
 */
function inc(x) {
  return x + 1;
}

/**
 * @nudo:case "name" ("Ada")
 */
function greet(name) {
  return "hi " + name;
}
`;
    writeFileSync(srcPath, source, "utf-8");

    const result = await analyzeFileAsync(srcPath, source);
    expect(result.functions.length).toBeGreaterThan(0);

    const lines: string[] = [];
    for (const fn of result.functions) {
      lines.push(...generateFunctionDtsLines(fn));
    }
    expect(lines.join("\n")).toContain("export declare function");

    const dtsPath = join(dir, "sample.d.ts");
    writeFileSync(dtsPath, lines.join("\n") + "\n", "utf-8");
    expect(readFileSync(dtsPath, "utf-8")).toContain("export declare function add");

    const check = tscNoEmit(dtsPath);
    expect(check.ok, `tsc failed:\n${check.stderr}`).toBe(true);
  });
});
