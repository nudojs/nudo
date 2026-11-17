/**
 * `@nudo:mock name from "path"` seed / fail-closed / 内联 mock / throws 通道。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { formatAbs, litValue, unknown as absUnknown } from "@nudojs/core";
import { mockDirectivesToAbsSeeds, mockSeedsToAbsMocks } from "../mock-abs.ts";
import { parse, extractDirectives } from "@nudojs/parser";
import { tryEvalCallFull } from "../eval-run.ts";
import { analyzeFile } from "../analyzer.ts";
import { tmpProject as makeTmpProject } from "./tmp-project.ts";

const tmpProject = (files: Record<string, string>): string => makeTmpProject("nudo-mock-from-", files);
const seedsOf = (source: string, fromFile: string) => mockDirectivesToAbsSeeds(extractDirectives(parse(source)), { fromFile });

describe("@nudo:mock from path", () => {
  it("成功 from-mock 种入且调用走 mock；analyzeFile 无 builtin-unknown", () => {
    const dir = tmpProject({ "mocks/fs.js": `const fs = { readFileSync: (path, encoding) => "{ \\"port\\": 3000 }" };\n` });
    const entry = join(dir, "read-config.js");
    const source = `/**\n * @nudo:mock fs from "./mocks/fs.js"\n * @nudo:case "read" (string())\n */\nfunction readConfig(path) { return fs.readFileSync(path, "utf-8"); }\n`;
    const seeds = seedsOf(source, entry);
    expect(seeds.fromErrors).toBeUndefined();
    expect(seeds.seedVars.fs).toBeDefined();
    const run = tryEvalCallFull(source, entry, "readConfig", [], { mocks: mockSeedsToAbsMocks(seeds), envNames: [] });
    expect(run).toBeDefined();
    expect(formatAbs(run!.result)).toContain("3000");
    const result = analyzeFile(entry, source);
    expect(result.diagnostics.filter((d) => d.code === "nudo:builtin-unknown").map((d) => d.message).join("\\n")).not.toContain('"fs"');
    expect(result.diagnostics.filter((d) => d.code === "nudo:module-missing")).toHaveLength(0);
  });

  it("缺文件 / 缺绑定均 fail-closed 并报 module-missing", () => {
    const dir = tmpProject({});
    const entry = join(dir, "read-config.js");
    const source = `/**\n * @nudo:mock fs from "./mocks/missing.js"\n * @nudo:case "read" (string())\n */\nfunction readConfig(path) { return fs.readFileSync(path, "utf-8"); }\n`;
    const seeds = seedsOf(source, entry);
    expect(seeds.seedVars.fs).toBeUndefined();
    expect(seeds.fromErrors).toHaveLength(1);
    expect(seeds.fromErrors![0]!.message).toContain("not found");
    expect(seeds.fromErrors![0]!.fromPath).toBe("./mocks/missing.js");
    const result = analyzeFile(entry, source);
    const missing = result.diagnostics.filter((d) => d.code === "nudo:module-missing");
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing[0]!.message).toContain("missing.js");

    const missingDir = tmpProject({ "mocks/fs.js": `const other = { readFileSync: () => "x" };\n` });
    const entry2 = join(missingDir, "read-config.js");
    const seeds2 = seedsOf(source.replace("missing.js", "fs.js"), entry2);
    expect(seeds2.seedVars.fs).toBeUndefined();
    expect(seeds2.fromErrors).toHaveLength(1);
    expect(seeds2.fromErrors![0]!.message).toContain("'fs'");
  });

  it("undefined 导出可接受；缺绑定仍报错；undefined 不落宿主", () => {
    const src = (name: string) => `/**\n * @nudo:mock ${name} from "./mocks/stub.js"\n * @nudo:case "default" ()\n */\nfunction f() { return ${name}; }\n`;
    for (const files of [{ "mocks/stub.js": `export const stub = undefined;\n` }, { "mocks/stub.js": `export let stub;\n` }]) {
      const dir = tmpProject(files);
      const source = src("stub");
      const seeds = seedsOf(source, join(dir, "app.js"));
      expect(seeds.fromErrors).toBeUndefined();
      expect(seeds.seedVars.stub).toBeDefined();
      expect(seeds.seedVars.stub!.term).toEqual({ op: "lit", value: undefined });
    }
    {
      const dir = tmpProject({ "mocks/other.js": `export const other = 1;\n` });
      const source = src("stub").replace("./mocks/stub.js", "./mocks/other.js");
      const seeds = seedsOf(source, join(dir, "app.js"));
      expect(seeds.seedVars.stub).toBeUndefined();
      expect(seeds.fromErrors).toHaveLength(1);
      expect(seeds.fromErrors![0]!.message).toContain("does not define a binding named 'stub'");
    }
    {
      const dir = tmpProject({ "mocks/fetch.js": `export const fetchStub = undefined;\n` });
      const source = src("fetchStub").replace("./mocks/stub.js", "./mocks/fetch.js");
      const seeds = seedsOf(source, join(dir, "app.js"));
      expect(seeds.fromErrors).toBeUndefined();
      const mocks = mockSeedsToAbsMocks(seeds);
      expect(mocks.fetchStub).toBeDefined();
      const r = tryEvalCallFull(source, join(dir, "app.js"), "f", [], { mocks, envNames: [] });
      expect(r!.result.term).toEqual({ op: "lit", value: undefined });
    }
  });

  it("内联 arrow/stub/约束构建器仍种入；from-mock 相对导入可解析", () => {
    const inline = `/**\n * @nudo:mock getPort = stub().returns(8080)\n * @nudo:mock double = (x) => x * 2\n * @nudo:mock retries = number()\n * @nudo:case "default" ()\n */\nfunction readPort() { return getPort(); }\n`;
    const seeds = seedsOf(inline, "/tmp/inline.js");
    expect(seeds.fromErrors).toBeUndefined();
    expect(seeds.seedVars.getPort).toBeDefined();
    expect(seeds.seedFns.double).toBeDefined();
    expect(seeds.seedVars.retries).toBeDefined();
    const mocks = mockSeedsToAbsMocks(seeds);
    expect(litValue(mocks.getPort as never)).toEqual({ ok: false });
    expect((mocks.getPort as { shape: { k: string } }).shape.k).toBe("fn");
    expect((mocks.double as { shape: { k: string } }).shape.k).toBe("fn");

    const dir = tmpProject({
      "lib/config.js": `export function portLabel() { return "3000"; }\n`,
      "mocks/fs.js": `import { portLabel } from "../lib/config.js";\nexport function readConfig() { return portLabel(); }\n`,
    });
    const source = `/**\n * @nudo:mock readConfig from "./mocks/fs.js"\n */\nexport function load() { return readConfig(); }\n`;
    const fromSeeds = seedsOf(source, join(dir, "app.js"));
    expect(fromSeeds.fromErrors).toBeUndefined();
    const r = tryEvalCallFull(`export function load() { return readConfig(); }\n`, join(dir, "app.js"), "load", [], { mocks: mockSeedsToAbsMocks(fromSeeds) });
    expect(formatAbs(r!.result)).toContain("3000");
  });

  it("mock 依赖图失败 fail-closed（缺失导入 / loader 抛错）", () => {
    {
      const dir = tmpProject({ "mocks/stub.js": `import { helper } from "./missing-dep.js";\nexport const stub = () => helper();\n` });
      const entry = join(dir, "app.js");
      const source = `/**\n * @nudo:mock stub from "./mocks/stub.js"\n * @nudo:case "default" ()\n */\nfunction f() { return stub(); }\n`;
      const seeds = seedsOf(source, entry);
      expect(seeds.seedVars.stub).toBeUndefined();
      expect(seeds.fromErrors).toHaveLength(1);
      expect(seeds.fromErrors![0]!.message).toContain("failed to resolve dependencies");
      expect(seeds.fromErrors![0]!.message).toContain("missing-dep.js");
      const result = analyzeFile(entry, source);
      const missing = result.diagnostics.filter((d) => d.code === "nudo:module-missing");
      expect(missing.length).toBeGreaterThanOrEqual(1);
    }
    {
      const dir = tmpProject({ "lib/dep.js": `export function helper() { return "ok"; }\n`, "mocks/stub.js": `import { helper } from "../lib/dep.js";\nexport const stub = () => helper();\n` });
      const entry = join(dir, "app.js");
      const source = `/**\n * @nudo:mock stub from "./mocks/stub.js"\n * @nudo:case "default" ()\n */\nfunction f() { return stub(); }\n`;
      const loadModule = (spec: string, fromFile: string): string | undefined => {
        if (spec.includes("dep.js")) throw new Error("injected loader boom");
        const abs = spec.startsWith(".") ? join(dirname(fromFile), spec) : spec;
        try { return readFileSync(abs, "utf-8"); } catch { return undefined; }
      };
      const seeds = mockDirectivesToAbsSeeds(extractDirectives(parse(source)), { fromFile: entry, loadModule });
      expect(seeds.seedVars.stub).toBeUndefined();
      expect(seeds.fromErrors).toHaveLength(1);
      expect(seeds.fromErrors![0]!.message).toContain("failed to resolve dependencies");
      expect(seeds.fromErrors![0]!.message).toContain("injected loader boom");
    }
  });

  it("不可解析 mock 表达式 fail-closed；显式 unknown/any/T.*/builder 仍种入", () => {
    const bad = `/**\n * @nudo:mock foo = @@@invalid@@@\n * @nudo:case "default" ()\n */\nfunction f() { return foo; }\n`;
    const seeds = seedsOf(bad, "/tmp/inline.js");
    expect(seeds.seedVars.foo).toBeUndefined();
    expect(seeds.fromErrors).toHaveLength(1);
    expect(seeds.fromErrors![0]!.name).toBe("foo");
    expect(seeds.fromErrors![0]!.code).toBe("nudo:mock-invalid");
    expect(seeds.fromErrors![0]!.message).toContain("Failed to parse mock expression");
    const result = analyzeFile("/tmp/inline.js", bad);
    const diags = result.diagnostics.filter((d) => d.code === "nudo:mock-invalid");
    expect(diags.length).toBeGreaterThanOrEqual(1);
    expect(diags[0]!.message).toContain("foo");

    const ok = `/**\n * @nudo:mock a = unknown\n * @nudo:mock b = any\n * @nudo:mock c = T.number\n * @nudo:mock d = number()\n * @nudo:case "default" ()\n */\nfunction f() { return [a, b, c, d]; }\n`;
    const okSeeds = seedsOf(ok, "/tmp/inline.js");
    expect(okSeeds.fromErrors).toBeUndefined();
    for (const name of ["a", "b", "c", "d"]) expect(okSeeds.seedVars[name], name).toBeDefined();
    expect(okSeeds.seedVars.d!.shape.k).toBe("prim");
  });

  it("throws 通道：always-throw result never + throws 非 never；may-throw throws 非 never", () => {
    {
      const dir = tmpProject({ "mocks/boom.js": `export function boomStub() { throw new TypeError("mock-boom"); }\n` });
      const entry = join(dir, "app.js");
      const source = `/**\n * @nudo:mock boomStub from "./mocks/boom.js"\n * @nudo:case "go" ()\n */\nfunction go() { return boomStub(); }\n`;
      const seeds = seedsOf(source, entry);
      expect(seeds.fromErrors).toBeUndefined();
      const run = tryEvalCallFull(source, entry, "go", [], { mocks: mockSeedsToAbsMocks(seeds), envNames: [] });
      expect(run!.result.shape.k).toBe("never");
      expect(run!.throws.shape.k).not.toBe("never");
    }
    {
      const dir = tmpProject({ "mocks/maybe.js": `export function maybeStub(x) { if (x) throw new TypeError("mock-maybe"); return 1; }\n` });
      const entry = join(dir, "app.js");
      const source = `/**\n * @nudo:mock maybeStub from "./mocks/maybe.js"\n * @nudo:case "go" (any())\n */\nfunction go(x) { return maybeStub(x); }\n`;
      const seeds = seedsOf(source, entry);
      expect(seeds.fromErrors).toBeUndefined();
      const run = tryEvalCallFull(source, entry, "go", [absUnknown], { mocks: mockSeedsToAbsMocks(seeds), envNames: [] });
      expect(run!.throws.shape.k).not.toBe("never");
    }
  });
});
