/**
 * T4：双入口包（browser/node）观察信号 nudo:dual-entry。
 * - 分析到双入口变体之一 → info（记录不跨文件注入，观察面只覆盖本入口）
 * - 单入口包 / 两面同一文件 / 非入口文件 → 零误报
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeFile } from "../analyzer.ts";
import {
  detectEntryVariantsFromPackageJson,
  entryVariantForFile,
  entryVariantIssueForFile,
} from "../entry-variants.ts";

const temps: string[] = [];
function tempPkg(pkgJson: unknown, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-dual-"));
  temps.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkgJson), "utf-8");
  for (const [rel, src] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, src, "utf-8");
  }
  return dir;
}

beforeEach(() => {
  /* each test owns its temp dir */
});
afterEach(() => {
  while (temps.length) {
    const d = temps.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("detectEntryVariantsFromPackageJson", () => {
  it("flags exports with differing browser/node conditions", () => {
    const faces = detectEntryVariantsFromPackageJson({
      name: "dual",
      exports: {
        ".": {
          browser: "./browser.js",
          node: "./node.js",
          default: "./node.js",
        },
      },
    });
    expect(faces).not.toBeNull();
    expect(faces!.browser).toContain("./browser.js");
    expect(faces!.node).toContain("./node.js");
  });

  it("flags legacy browser field vs main", () => {
    const faces = detectEntryVariantsFromPackageJson({
      name: "legacy",
      main: "./node.js",
      browser: "./browser.js",
    });
    expect(faces).not.toBeNull();
    expect(faces!.kind).toBe("browser-field");
  });

  it("is silent on single-entry packages (zero-FP)", () => {
    expect(
      detectEntryVariantsFromPackageJson({ name: "one", main: "./index.js" }),
    ).toBeNull();
    expect(
      detectEntryVariantsFromPackageJson({
        name: "one",
        exports: { ".": "./index.js" },
      }),
    ).toBeNull();
    expect(
      detectEntryVariantsFromPackageJson({
        name: "one",
        exports: { ".": { node: "./n.js", default: "./n.js" } },
      }),
    ).toBeNull();
  });

  it("is silent when browser and node resolve to the same file", () => {
    expect(
      detectEntryVariantsFromPackageJson({
        name: "same",
        main: "./index.js",
        browser: "./index.js",
      }),
    ).toBeNull();
    expect(
      detectEntryVariantsFromPackageJson({
        name: "same",
        exports: { ".": { browser: "./i.js", node: "./i.js" } },
      }),
    ).toBeNull();
  });
});

describe("nudo:dual-entry diagnostic", () => {
  const DUAL = {
    name: "dual-lib",
    exports: {
      ".": {
        browser: "./browser.js",
        node: "./node.js",
        default: "./node.js",
      },
    },
  };
  const SRC = `export function id(x) { return x; }\n`;

  it("fires info when analyzing one entry variant", () => {
    const dir = tempPkg(DUAL, {
      "browser.js": SRC,
      "node.js": SRC,
    });
    const r = analyzeFile(join(dir, "browser.js"), SRC);
    const d = r.diagnostics.find((x) => x.code === "nudo:dual-entry");
    expect(d).toBeDefined();
    expect(d!.severity).toBe("info");
    expect(d!.message).toContain("browser");
    expect(d!.message).toContain("do not cross files");
  });

  it("fires on the other variant too (each side is only half the picture)", () => {
    const dir = tempPkg(DUAL, {
      "browser.js": SRC,
      "node.js": SRC,
    });
    const r = analyzeFile(join(dir, "node.js"), SRC);
    const d = r.diagnostics.find((x) => x.code === "nudo:dual-entry");
    expect(d).toBeDefined();
    expect(d!.message).toContain("node");
  });

  it("does not fire on single-entry packages (negative)", () => {
    const dir = tempPkg(
      { name: "single", main: "./index.js" },
      { "index.js": SRC },
    );
    const r = analyzeFile(join(dir, "index.js"), SRC);
    expect(r.diagnostics.filter((x) => x.code === "nudo:dual-entry")).toEqual([]);
  });

  it("does not fire on non-entry helpers inside a dual-entry package", () => {
    const dir = tempPkg(DUAL, {
      "browser.js": SRC,
      "node.js": SRC,
      "lib/helper.js": SRC,
    });
    const r = analyzeFile(join(dir, "lib", "helper.js"), SRC);
    expect(r.diagnostics.filter((x) => x.code === "nudo:dual-entry")).toEqual([]);
  });

  it("entryVariantForFile only claims files on exactly one face", () => {
    const dir = tempPkg(DUAL, {
      "browser.js": SRC,
      "node.js": SRC,
      "lib/helper.js": SRC,
    });
    expect(entryVariantForFile(join(dir, "browser.js"))?.role).toBe("browser");
    expect(entryVariantForFile(join(dir, "node.js"))?.role).toBe("node");
    expect(entryVariantForFile(join(dir, "lib", "helper.js"))).toBeNull();
  });

  it("entryVariantIssueForFile mirrors the analyzeFile diagnostic", () => {
    const dir = tempPkg(DUAL, { "browser.js": SRC });
    const issue = entryVariantIssueForFile(join(dir, "browser.js"));
    expect(issue).not.toBeNull();
    expect(issue!.code).toBe("nudo:dual-entry");
    expect(issue!.severity).toBe("info");
    expect(entryVariantIssueForFile(join(dir, "missing-no-pkg", "x.js"))).toBeNull();
  });
});
