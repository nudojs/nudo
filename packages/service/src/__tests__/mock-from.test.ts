/**
 * `@nudo:mock name from "path"` 必须种入 B 路径（与内联 mock 同一 seed 通道）：
 * - from-mock 装载成功 → 调用走 mock 实现，无 builtin-unknown
 * - 缺文件 → 明确 nudo:module-missing 诊断，不静默丢弃
 * - 内联 mock 不回归
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatAbs, litValue } from "@nudojs/core";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "../mock-abs.ts";
import { parse, extractDirectives } from "@nudojs/parser";
import { tryBPathCallFull } from "../bpath-run.ts";
import { analyzeFile } from "../analyzer.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-mock-from-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content, "utf-8");
  }
  return dir;
}

function seedsOf(source: string, fromFile: string) {
  const fns = extractDirectives(parse(source));
  return mockDirectivesToAbsSeeds(fns, { fromFile });
}

describe("@nudo:mock name from path seeds B path", () => {
  it("from-mock binding is seeded and call results use the mock implementation", () => {
    const dir = tmpProject({
      "mocks/fs.js": `const fs = { readFileSync: (path, encoding) => "{ \\"port\\": 3000 }" };\n`,
      "read-config.js": `/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
`,
    });
    const entry = join(dir, "read-config.js");
    const source = `/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
`;
    const seeds = seedsOf(source, entry);
    expect(seeds.fromErrors).toBeUndefined();
    expect(seeds.seedVars.fs).toBeDefined();

    // B 路径调用必须拿到 mock 返回值（不是 unknown / builtin-unknown）
    const run = tryBPathCallFull(source, entry, "readConfig", [], {
      mocks: mockSeedsToAbsMocks(seeds),
      envNames: [],
    });
    expect(run).toBeDefined();
    const text = formatAbs(run!.result);
    expect(text).toContain("3000");
  });

  it("analyzeFile reports no builtin-unknown for a successfully from-mocked name", () => {
    const dir = tmpProject({
      "mocks/fs.js": `const fs = { readFileSync: (path, encoding) => "{ \\"port\\": 3000 }" };\n`,
    });
    const entry = join(dir, "read-config.js");
    const source = `/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
`;
    const result = analyzeFile(entry, source);
    const builtin = result.diagnostics.filter((d) => d.code === "nudo:builtin-unknown");
    expect(builtin.map((d) => d.message).join("\n")).not.toContain('"fs"');
    const missing = result.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing).toHaveLength(0);
  });
});

describe("missing from-mock file is fail-closed", () => {
  it("emits nudo:module-missing and does not silently drop the mock", () => {
    const dir = tmpProject({});
    const entry = join(dir, "read-config.js");
    const source = `/**
 * @nudo:mock fs from "./mocks/missing.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
`;
    const seeds = seedsOf(source, entry);
    expect(seeds.seedVars.fs).toBeUndefined();
    expect(seeds.fromErrors).toHaveLength(1);
    expect(seeds.fromErrors![0]!.message).toContain("not found");
    expect(seeds.fromErrors![0]!.fromPath).toBe("./mocks/missing.js");

    const result = analyzeFile(entry, source);
    const missing = result.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]!.message).toContain("missing.js");
  });

  it("emits diagnostic when the mock file lacks the named binding", () => {
    const dir = tmpProject({
      "mocks/fs.js": `const other = { readFileSync: () => "x" };\n`,
    });
    const entry = join(dir, "read-config.js");
    const source = `/**
 * @nudo:mock fs from "./mocks/fs.js"
 * @nudo:case "read" (string())
 */
function readConfig(path) {
  return fs.readFileSync(path, "utf-8");
}
`;
    const seeds = seedsOf(source, entry);
    expect(seeds.seedVars.fs).toBeUndefined();
    expect(seeds.fromErrors).toHaveLength(1);
    expect(seeds.fromErrors![0]!.message).toContain("'fs'");
  });
});

describe("inline mocks do not regress", () => {
  it("arrow / stub inline mocks still seed", () => {
    const source = `/**
 * @nudo:mock getPort = stub().returns(8080)
 * @nudo:mock double = (x) => x * 2
 * @nudo:case "default" ()
 */
function readPort() {
  return getPort();
}
`;
    const seeds = seedsOf(source, "/tmp/inline.js");
    expect(seeds.fromErrors).toBeUndefined();
    expect(seeds.seedVars.getPort).toBeDefined();
    expect(seeds.seedFns.double).toBeDefined();
    const mocks = mockSeedsToAbsMocks(seeds);
    expect(mocks.getPort).toBeDefined();
    expect(mocks.double).toBeDefined();
    expect(litValue(mocks.getPort as never)).toBeUndefined(); // fn mock, not a bare lit
    expect((mocks.getPort as { shape: { k: string } }).shape.k).toBe("fn");
    expect((mocks.double as { shape: { k: string } }).shape.k).toBe("fn");
  });

  it("constraint-builder inline mock still seeds", () => {
    const source = `/**
 * @nudo:mock retries = number()
 * @nudo:case "plan" ()
 */
function plan() {
  return retries + 1;
}
`;
    const seeds = seedsOf(source, "/tmp/inline.js");
    expect(seeds.seedVars.retries).toBeDefined();
  });
});
