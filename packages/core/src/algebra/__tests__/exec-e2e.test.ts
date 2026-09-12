import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { transpile, litValue, absToString, $lit, $arr, $idx, $len, $get, $obj } from "@nudojs/core";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const runtimeUrl = pathToFileURL(
  join(dirname(fileURLToPath(import.meta.url)), "../exec/runtime.ts"),
).href;

/** transpile 后写盘并动态 import（真 Node 执行 B 路径程序） */
async function execTranspiled(source: string, exportName: string) {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bpath-e2e-"));
  dirs.push(dir);
  // 指向 monorepo 内 runtime，vitest/node 均可解析 .ts
  const js = transpile(source, { runtimeImport: runtimeUrl });
  const modPath = join(dir, "mod.mjs");
  writeFileSync(modPath, js, "utf-8");
  const mod = await import(pathToFileURL(modPath).href);
  return mod[exportName] as (...args: unknown[]) => unknown;
}

describe("B-path e2e (transpile + Node import)", () => {
  it("add executes on Abs literals", async () => {
    const add = await execTranspiled(
      `export function add(a, b) { return a + b; }`,
      "add",
    );
    const r = add($lit(2), $lit(40)) as ReturnType<typeof $lit>;
    expect(litValue(r)).toBe(42);
  });

  it("array literal + index + length", async () => {
    const run = await execTranspiled(
      `export function run() {
  const a = [1, 2, 3];
  const x = a[1];
  const n = a.length;
  return x + n;
}`,
      "run",
    );
    const r = run() as ReturnType<typeof $lit>;
    expect(litValue(r)).toBe(5); // 2 + 3
  });

  it("object destructure + member", async () => {
    const run = await execTranspiled(
      `export function run() {
  const o = { id: 10, name: "a" };
  const { id, name } = o;
  return id + name;
}`,
      "run",
    );
    const r = run() as ReturnType<typeof $lit>;
    expect(absToString(r)).toContain("string"); // 10 + "a" → "10a"
    expect(litValue(r)).toBe("10a");
  });

  it("array destructure", async () => {
    const run = await execTranspiled(
      `export function run() {
  const pair = [3, 4];
  const [x, y] = pair;
  return x * y;
}`,
      "run",
    );
    const r = run() as ReturnType<typeof $lit>;
    expect(litValue(r)).toBe(12);
  });

  it("local function call + if/else", async () => {
    const go = await execTranspiled(
      `export function go(n) {
  if (n > 0) { return n + 1; } else { return 0; }
}`,
      "go",
    );
    expect(litValue(go($lit(1)) as never)).toBe(2);
    expect(litValue(go($lit(-1)) as never)).toBe(0);
  });

  it("runtime array helpers", () => {
    const a = $arr([$lit(1), $lit(2)]);
    expect(litValue($idx(a, $lit(0)))).toBe(1);
    expect(litValue($len(a))).toBe(2);
    expect(litValue($get($obj({ k: $lit(1) }), "k"))).toBe(1);
  });
});
