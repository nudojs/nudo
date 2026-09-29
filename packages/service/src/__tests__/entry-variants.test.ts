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
    const g = faces!.groups.get("exports:.");
    expect(g).toBeDefined();
    expect(g!.browser).toContain("./browser.js");
    expect(g!.node).toContain("./node.js");
  });

  it("flags legacy browser field vs main", () => {
    const faces = detectEntryVariantsFromPackageJson({
      name: "legacy",
      main: "./node.js",
      browser: "./browser.js",
    });
    expect(faces).not.toBeNull();
    expect(faces!.kind).toBe("browser-field");
    const g = faces!.groups.get("browser-field");
    expect(g!.browser).toContain("./browser.js");
    expect(g!.node).toContain("./node.js");
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

  it("groups multi-subpath exports faces separately (no cross-subpath merge)", () => {
    const faces = detectEntryVariantsFromPackageJson({
      name: "mixed",
      exports: {
        ".": "./index.js",
        "./tool": { browser: "./tool.browser.js", default: "./tool.node.js" },
      },
    });
    expect(faces).not.toBeNull();
    const root = faces!.groups.get("exports:.");
    expect(root!.browser).toEqual([]);
    expect(root!.node).toContain("./index.js");
    const tool = faces!.groups.get("exports:./tool");
    expect(tool!.browser).toContain("./tool.browser.js");
    expect(tool!.node).toContain("./tool.node.js");
  });

  it("does not treat browser:false remap as a browser face", () => {
    // disabled-in-browser alone is not dual
    expect(
      detectEntryVariantsFromPackageJson({
        name: "disable",
        browser: { "./lib.js": false },
        main: "./lib.js",
      }),
    ).toBeNull();
    // mixed remap: only the real pair is dual; false-mapped key stays single-face
    const faces = detectEntryVariantsFromPackageJson({
      name: "mixed-remap",
      browser: {
        "./lib.js": false,
        "./other.js": "./other.browser.js",
      },
    });
    expect(faces).not.toBeNull();
    const disabled = faces!.groups.get("browser:lib.js");
    expect(disabled!.browser).toEqual([]);
    expect(disabled!.node).toContain("./lib.js");
    const pair = faces!.groups.get("browser:other.js");
    expect(pair!.browser).toContain("./other.browser.js");
    expect(pair!.node).toContain("./other.js");
  });

  it("does not push p.module into the node face", () => {
    // esm.js has no browser counterpart — module must not invent one
    expect(
      detectEntryVariantsFromPackageJson({
        name: "esm",
        module: "./esm.js",
        browser: { "./lib.js": "./lib.browser.js" },
      }),
    ).not.toBeNull();
    const faces = detectEntryVariantsFromPackageJson({
      name: "esm",
      module: "./esm.js",
      browser: { "./lib.js": "./lib.browser.js" },
    });
    for (const g of faces!.groups.values()) {
      expect(g.node).not.toContain("./esm.js");
      expect(g.browser).not.toContain("./esm.js");
    }
    // module alone (even with browser string and no main) is not a dual pair
    expect(
      detectEntryVariantsFromPackageJson({
        name: "esm-only",
        module: "./esm.js",
        browser: "./browser.js",
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

  it("does not fire on a single-entry subpath of a multi-subpath package (F2 regression)", () => {
    const dir = tempPkg(
      {
        name: "mixed",
        exports: {
          ".": "./index.js",
          "./tool": { browser: "./tool.browser.js", default: "./tool.node.js" },
        },
      },
      {
        "index.js": SRC,
        "tool.browser.js": SRC,
        "tool.node.js": SRC,
      },
    );
    // "." is single-entry — must not inherit "./tool"'s dual pair
    const idx = analyzeFile(join(dir, "index.js"), SRC);
    expect(idx.diagnostics.filter((x) => x.code === "nudo:dual-entry")).toEqual([]);
    expect(entryVariantForFile(join(dir, "index.js"))).toBeNull();

    // "./tool" is a real dual group — both faces fire, message lists only this group
    const node = entryVariantForFile(join(dir, "tool.node.js"));
    expect(node).not.toBeNull();
    expect(node!.role).toBe("node");
    expect(node!.browserTargets).toEqual(["tool.browser.js"]);
    expect(node!.nodeTargets).toEqual(["tool.node.js"]);
    const br = entryVariantForFile(join(dir, "tool.browser.js"));
    expect(br).not.toBeNull();
    expect(br!.role).toBe("browser");
  });

  it("does not fire for p.module or browser:false pseudo-entries (F2 regression)", () => {
    const dir = tempPkg(
      {
        name: "esm-remap",
        module: "./esm.js",
        browser: { "./lib.js": false, "./other.js": "./other.browser.js" },
      },
      {
        "esm.js": SRC,
        "lib.js": SRC,
        "other.js": SRC,
        "other.browser.js": SRC,
      },
    );
    // module face has no browser counterpart
    expect(entryVariantForFile(join(dir, "esm.js"))).toBeNull();
    // browser:false is not a browser face
    expect(entryVariantForFile(join(dir, "lib.js"))).toBeNull();
    // real remap pair still fires
    expect(entryVariantForFile(join(dir, "other.js"))?.role).toBe("node");
    expect(entryVariantForFile(join(dir, "other.browser.js"))?.role).toBe("browser");
  });
});
