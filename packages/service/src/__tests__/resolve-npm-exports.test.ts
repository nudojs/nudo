/**
 * DEC-004: resolve-npm exports 模式键 / 条件树 / 数组 fallback。
 * 三类反例（finding F2）：
 * 1. 子路径模式键 `"./*": "./dist/*.js"` → pkg/feature 命中 dist/feature.js
 * 2. 条件唯一出口挂在 browser 下 → pickExport 不得 miss
 * 3. 数组 fallback `["./miss.js", "./hit.js"]` → 命中 ./hit.js
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveNpmJsEntry,
  resolveNpmJsEntryDetailed,
  resolveNpmNudo,
} from "../evaluator/resolve-npm.ts";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function makePkg(
  pkgJson: Record<string, unknown>,
  files: Record<string, string> = {},
): { dir: string; pkgDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-exports-"));
  tmpDirs.push(dir);
  const pkgDir = join(dir, "node_modules", "pkg");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "pkg", ...pkgJson }));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(pkgDir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return { dir, pkgDir };
}

describe("exports pattern keys (./x/*)", () => {
  it("resolves pkg/feature via './*': './dist/*.js'", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": "./dist/*.js" } },
      { "dist/feature.js": "export const x = 1;" },
    );
    const hit = resolveNpmJsEntry("pkg/feature", dir);
    expect(hit).toBe(join(pkgDir, "dist", "feature.js"));
  });

  it("resolves pkg/a/b via './*': './dist/*.js' (star matches across segments)", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": "./dist/*.js" } },
      { "dist/a/b.js": "export const x = 1;" },
    );
    const hit = resolveNpmJsEntry("pkg/a/b", dir);
    expect(hit).toBe(join(pkgDir, "dist", "a", "b.js"));
  });

  it("prefers longer prefix in pattern keys", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": "./dist/*.js", "./special/*": "./src/*.js" } },
      {
        "dist/special/x.js": "export const a = 1;",
        "src/x.js": "export const b = 2;",
      },
    );
    const hit = resolveNpmJsEntry("pkg/special/x", dir);
    expect(hit).toBe(join(pkgDir, "src", "x.js"));
  });

  it("exact key takes precedence over pattern", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": "./dist/*.js", "./feature": "./exact.js" } },
      {
        "dist/feature.js": "export const a = 1;",
        "exact.js": "export const b = 2;",
      },
    );
    const hit = resolveNpmJsEntry("pkg/feature", dir);
    expect(hit).toBe(join(pkgDir, "exact.js"));
  });
});

describe("exports condition keys (browser)", () => {
  it("resolves via browser-only condition", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { browser: "./only-browser.js" } } },
      { "only-browser.js": "export const x = 1;" },
    );
    const hit = resolveNpmJsEntry("pkg", dir);
    expect(hit).toBe(join(pkgDir, "only-browser.js"));
  });

  it("prefers default over browser when both present", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { browser: "./browser.js", default: "./default.js" } } },
      {
        "browser.js": "export const a = 1;",
        "default.js": "export const b = 2;",
      },
    );
    // 分析面取 Node/default；browser 仅 browser-only 时兜底
    expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "default.js"));
  });

  it("prefers node over browser when both present", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { browser: "./browser.js", node: "./node.js" } } },
      {
        "browser.js": "export const a = 1;",
        "node.js": "export const b = 2;",
      },
    );
    const hit = resolveNpmJsEntry("pkg", dir);
    expect(hit).toBe(join(pkgDir, "node.js"));
  });

  it("types is only a fallback (after all JS conditions miss)", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { types: "./index.d.ts", default: "./index.js" } } },
      {
        "index.d.ts": "export declare const x: number;",
        "index.js": "export const x = 1;",
      },
    );
    // default 命中 → 不走 types
    expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "index.js"));
  });

  it("does not treat .d.ts as a runnable entry (types fallback skipped for eval)", () => {
    const { dir } = makePkg(
      { exports: { ".": { types: "./index.d.ts" } } },
      { "index.d.ts": "export declare const x: number;" },
    );
    // 声明文件不是可执行入口——eval 路径不得返回 .d.ts
    expect(resolveNpmJsEntry("pkg", dir)).toBeNull();
  });

  it("recursive condition nesting: { node: { require: ... } }", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { node: { require: "./cjs/index.js" }, default: "./esm/index.js" } } },
      {
        "cjs/index.js": "module.exports = {};",
        "esm/index.js": "export default {};",
      },
    );
    expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "cjs", "index.js"));
  });
});

describe("exports array fallback", () => {
  it("skips missing file and hits next in array", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./f": ["./miss.js", "./hit.js"] } },
      { "hit.js": "export const x = 1;" },
    );
    const hit = resolveNpmJsEntry("pkg/f", dir);
    expect(hit).toBe(join(pkgDir, "hit.js"));
  });

  it("uses first entry when it exists", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./f": ["./hit1.js", "./hit2.js"] } },
      {
        "hit1.js": "export const a = 1;",
        "hit2.js": "export const b = 2;",
      },
    );
    expect(resolveNpmJsEntry("pkg/f", dir)).toBe(join(pkgDir, "hit1.js"));
  });

  it("array at root entry: { '.': ['./miss.mjs', './hit.js'] }", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": ["./miss.mjs", "./hit.js"] } },
      { "hit.js": "export const x = 1;" },
    );
    expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "hit.js"));
  });

  it("array with conditions inside: [{ browser: ... }, { default: ... }]", () => {
    const { dir, pkgDir } = makePkg(
      {
        exports: {
          ".": [
            { browser: "./miss-browser.js" },
            { default: "./hit.js" },
          ],
        },
      },
      { "hit.js": "export const x = 1;" },
    );
    expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "hit.js"));
  });
});

describe("package-dir containment (no .. escape)", () => {
  it("rejects subpath with .. segments", () => {
    const { dir } = makePkg(
      { exports: { ".": "./index.js" } },
      { "index.js": "export const x = 1;" },
    );
    // pkg/../../evil 不是包内说明符——不得解析出包外文件
    const r = resolveNpmJsEntryDetailed("pkg/../../evil", dir);
    expect(r.path).toBeNull();
  });

  it("rejects pattern substitution that escapes via ..", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": "./dist/*.js" } },
      {
        "dist/feature.js": "export const a = 1;",
        "escape.js": "export const evil = 1;",
      },
    );
    // substitution "../../escape" → dist/../../escape.js 会逃出 pkgDir
    // 合法 feature 仍须命中
    expect(resolveNpmJsEntry("pkg/feature", dir)).toBe(join(pkgDir, "dist", "feature.js"));
    const escaped = resolveNpmJsEntryDetailed("pkg/feature/../../escape", dir);
    expect(escaped.path).toBeNull();
  });

  it("rejects exports target that points outside the package", () => {
    const { dir } = makePkg({ exports: { ".": "../outside.js" } }, {});
    // 包外旁路文件（node_modules/outside.js）
    writeFileSync(join(dir, "node_modules", "outside.js"), "export const x = 1;");
    const r = resolveNpmJsEntryDetailed("pkg", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });
});

describe("exports misses do not fall through to main / direct path", () => {
  it("does not fall back to main when exports key is missing", () => {
    const { dir } = makePkg(
      { main: "index.js", exports: { "./other": "./other.js" } },
      { "index.js": "export const x = 1;", "other.js": "export const y = 2;" },
    );
    // Node: ERR_PACKAGE_PATH_NOT_EXPORTED——不得静默改用 main
    const r = resolveNpmJsEntryDetailed("pkg/feature", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("does not fall back to main when exports target file is missing", () => {
    const { dir } = makePkg(
      { main: "index.js", exports: { "./f": "./missing.js" } },
      { "index.js": "export const x = 1;" },
    );
    const r = resolveNpmJsEntryDetailed("pkg/f", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("does not fall back to a sibling file when exports target is missing", () => {
    const { dir } = makePkg(
      { exports: { "./f": "./dist/f.js" } },
      { "f.js": "export const wrong = 1;" },
    );
    // exports 指向 dist/f.js（缺失）；包根 f.js 不得顶替
    const r = resolveNpmJsEntryDetailed("pkg/f", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });
});

describe("exports-unresolved diagnostic", () => {
  it("flags exportsUnresolved when exports has no matching key", () => {
    const { dir } = makePkg(
      { exports: { "./other": "./other.js" } },
      { "other.js": "export const x = 1;" },
    );
    const r = resolveNpmJsEntryDetailed("pkg/feature", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("flags exportsUnresolved when target file is missing", () => {
    const { dir } = makePkg({ exports: { "./f": "./missing.js" } });
    const r = resolveNpmJsEntryDetailed("pkg/f", dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
  });

  it("does not flag when exports resolves successfully", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./f": "./f.js" } },
      { "f.js": "export const x = 1;" },
    );
    const r = resolveNpmJsEntryDetailed("pkg/f", dir);
    expect(r.path).toBe(join(pkgDir, "f.js"));
    expect(r.exportsUnresolved).toBe(false);
  });

  it("does not flag when no exports field exists", () => {
    const { dir, pkgDir } = makePkg({ main: "index.js" }, { "index.js": "export const x = 1;" });
    const r = resolveNpmJsEntryDetailed("pkg", dir);
    expect(r.path).toBe(join(pkgDir, "index.js"));
    expect(r.exportsUnresolved).toBe(false);
  });
});

describe("resolveNpmNudo aligned exports reading", () => {
  it("finds nudo in nested condition object", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { ".": { node: { nudo: "./index.nudo.js" }, default: "./index.js" } } },
      {
        "index.nudo.js": "export const x = 1;",
        "index.js": "export const y = 2;",
      },
    );
    expect(resolveNpmNudo("pkg", dir)).toBe(join(pkgDir, "index.nudo.js"));
  });

  it("finds nudo nested in array fallback", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./f": ["./miss.js", { nudo: "./f.nudo.js" }] } },
      { "f.nudo.js": "export const x = 1;" },
    );
    expect(resolveNpmNudo("pkg/f", dir)).toBe(join(pkgDir, "f.nudo.js"));
  });

  it("resolves nested nudo: { import, default } with JS conditions", () => {
    const { dir, pkgDir } = makePkg(
      {
        exports: {
          ".": {
            nudo: { import: "./index.nudo.mjs", default: "./index.nudo.js" },
            default: "./index.js",
          },
        },
      },
      {
        "index.nudo.mjs": "export const x = 1;",
        "index.nudo.js": "export const y = 2;",
        "index.js": "export const z = 3;",
      },
    );
    // import 条件在 JS_CONDITIONS 中排在 default 前 → 命中 .mjs
    expect(resolveNpmNudo("pkg", dir)).toBe(join(pkgDir, "index.nudo.mjs"));
  });

  it("pattern key works for resolveNpmNudo", () => {
    const { dir, pkgDir } = makePkg(
      { exports: { "./*": { nudo: "./dist/*.nudo.js" } } },
      { "dist/feature.nudo.js": "export const x = 1;" },
    );
    expect(resolveNpmNudo("pkg/feature", dir)).toBe(join(pkgDir, "dist", "feature.nudo.js"));
  });

  it("returns null when no nudo condition present", () => {
    const { dir } = makePkg(
      { exports: { ".": { default: "./index.js" } } },
      { "index.js": "export const x = 1;" },
    );
    expect(resolveNpmNudo("pkg", dir)).toBeNull();
  });
});
