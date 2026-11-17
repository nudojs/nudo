/** DEC-004: resolve-npm exports 模式键 / 条件树 / 数组 fallback / 包含性 / nudo 面。 */
import { describe, it, expect, vi } from "vitest";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { resolveNpmJsEntry, resolveNpmJsEntryDetailed, resolveNpmNudo } from "../evaluator/resolve-npm.ts";
import { tmpProject } from "./tmp-project.ts";

const isRoot = process.geteuid?.() === 0;

function makePkg(pkgJson: Record<string, unknown>, files: Record<string, string> = {}): { dir: string; pkgDir: string } {
  const dir = tmpProject("nudo-exports-");
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

describe("exports resolution", () => {
  it("模式键：跨段 star、长前缀、exact 优先", () => {
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": "./dist/*.js" } }, { "dist/feature.js": "x" });
      expect(resolveNpmJsEntry("pkg/feature", dir)).toBe(join(pkgDir, "dist", "feature.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": "./dist/*.js" } }, { "dist/a/b.js": "x" });
      expect(resolveNpmJsEntry("pkg/a/b", dir)).toBe(join(pkgDir, "dist", "a", "b.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": "./dist/*.js", "./special/*": "./src/*.js" } }, { "dist/special/x.js": "a", "src/x.js": "b" });
      expect(resolveNpmJsEntry("pkg/special/x", dir)).toBe(join(pkgDir, "src", "x.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": "./dist/*.js", "./feature": "./exact.js" } }, { "dist/feature.js": "a", "exact.js": "b" });
      expect(resolveNpmJsEntry("pkg/feature", dir)).toBe(join(pkgDir, "exact.js"));
    }
  });

  it("条件键：browser-only / default 优先 / node 优先 / types 兜底 / .d.ts 不可执行 / 嵌套", () => {
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { browser: "./only-browser.js" } } }, { "only-browser.js": "x" });
      expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "only-browser.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { browser: "./browser.js", default: "./default.js" } } }, { "browser.js": "a", "default.js": "b" });
      expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "default.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { browser: "./browser.js", node: "./node.js" } } }, { "browser.js": "a", "node.js": "b" });
      expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "node.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { types: "./index.d.ts", default: "./index.js" } } }, { "index.d.ts": "declare const x: number", "index.js": "x" });
      expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "index.js"));
    }
    {
      const { dir } = makePkg({ exports: { ".": { types: "./index.d.ts" } } }, { "index.d.ts": "declare const x: number" });
      expect(resolveNpmJsEntry("pkg", dir)).toBeNull();
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { node: { require: "./cjs/index.js" }, default: "./esm/index.js" } } }, { "cjs/index.js": "module.exports={}", "esm/index.js": "export default {}" });
      expect(resolveNpmJsEntryDetailed("pkg", dir, "require").path).toBe(join(pkgDir, "cjs", "index.js"));
      expect(resolveNpmJsEntryDetailed("pkg", dir, "import").path).toBe(join(pkgDir, "esm", "index.js"));
    }
  });

  it("数组 fallback：首个合法目标即停（缺失也不跳到下一个）；条件数组", () => {
    {
      const { dir } = makePkg({ exports: { "./f": ["./miss.js", "./hit.js"] } }, { "hit.js": "x" });
      const r = resolveNpmJsEntryDetailed("pkg/f", dir);
      expect(r.path).toBeNull();
      expect(r.exportsUnresolved).toBe(true);
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./f": ["./hit1.js", "./hit2.js"] } }, { "hit1.js": "a", "hit2.js": "b" });
      expect(resolveNpmJsEntry("pkg/f", dir)).toBe(join(pkgDir, "hit1.js"));
    }
    {
      const { dir } = makePkg({ exports: { ".": ["./miss.mjs", "./hit.js"] } }, { "hit.js": "x" });
      expect(resolveNpmJsEntryDetailed("pkg", dir).exportsUnresolved).toBe(true);
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": [{ browser: "./miss-browser.js" }, { default: "./hit.js" }] } }, { "hit.js": "x" });
      expect(resolveNpmJsEntry("pkg", dir)).toBe(join(pkgDir, "hit.js"));
    }
  });

  it("包目录包含性：.. 子路径 / 模式替换逃逸 / 包外目标均拒绝", () => {
    {
      const { dir } = makePkg({ exports: { ".": "./index.js" } }, { "index.js": "x" });
      expect(resolveNpmJsEntryDetailed("pkg/../../evil", dir).path).toBeNull();
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": "./dist/*.js" } }, { "dist/feature.js": "a", "escape.js": "evil" });
      expect(resolveNpmJsEntry("pkg/feature", dir)).toBe(join(pkgDir, "dist", "feature.js"));
      expect(resolveNpmJsEntryDetailed("pkg/feature/../../escape", dir).path).toBeNull();
    }
    {
      const { dir } = makePkg({ exports: { ".": "../outside.js" } }, {});
      writeFileSync(join(dir, "node_modules", "outside.js"), "x");
      const r = resolveNpmJsEntryDetailed("pkg", dir);
      expect(r.path).toBeNull();
      expect(r.exportsUnresolved).toBe(true);
    }
  });

  it("exports miss 不回退 main / 兄弟文件，并报 exportsUnresolved；成功/无 exports 不报", () => {
    {
      const { dir } = makePkg({ main: "index.js", exports: { "./other": "./other.js" } }, { "index.js": "a", "other.js": "b" });
      const r = resolveNpmJsEntryDetailed("pkg/feature", dir);
      expect(r.path).toBeNull();
      expect(r.exportsUnresolved).toBe(true);
    }
    {
      const { dir } = makePkg({ main: "index.js", exports: { "./f": "./missing.js" } }, { "index.js": "a" });
      expect(resolveNpmJsEntryDetailed("pkg/f", dir).exportsUnresolved).toBe(true);
    }
    {
      const { dir } = makePkg({ exports: { "./f": "./dist/f.js" } }, { "f.js": "wrong" });
      expect(resolveNpmJsEntryDetailed("pkg/f", dir).exportsUnresolved).toBe(true);
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./f": "./f.js" } }, { "f.js": "x" });
      const r = resolveNpmJsEntryDetailed("pkg/f", dir);
      expect(r.path).toBe(join(pkgDir, "f.js"));
      expect(r.exportsUnresolved).toBe(false);
    }
    {
      const { dir, pkgDir } = makePkg({ main: "index.js" }, { "index.js": "x" });
      const r = resolveNpmJsEntryDetailed("pkg", dir);
      expect(r.path).toBe(join(pkgDir, "index.js"));
      expect(r.exportsUnresolved).toBe(false);
    }
  });

  it("resolveNpmNudo：嵌套条件 / 数组 / nudo 子条件 / 模式键 / 无 nudo 返回 null", () => {
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { node: { nudo: "./index.nudo.js" }, default: "./index.js" } } }, { "index.nudo.js": "a", "index.js": "b" });
      expect(resolveNpmNudo("pkg", dir)).toBe(join(pkgDir, "index.nudo.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./f": ["./miss.js", { nudo: "./f.nudo.js" }] } }, { "f.nudo.js": "x" });
      expect(resolveNpmNudo("pkg/f", dir)).toBe(join(pkgDir, "f.nudo.js"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { nudo: { import: "./index.nudo.mjs", default: "./index.nudo.js" }, default: "./index.js" } } }, { "index.nudo.mjs": "a", "index.nudo.js": "b", "index.js": "c" });
      expect(resolveNpmNudo("pkg", dir)).toBe(join(pkgDir, "index.nudo.mjs"));
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { "./*": { nudo: "./dist/*.nudo.js" } } }, { "dist/feature.nudo.js": "x" });
      expect(resolveNpmNudo("pkg/feature", dir)).toBe(join(pkgDir, "dist", "feature.nudo.js"));
    }
    {
      const { dir } = makePkg({ exports: { ".": { default: "./index.js" } } }, { "index.js": "x" });
      expect(resolveNpmNudo("pkg", dir)).toBeNull();
    }
  });

  it("fs 错误分类：ENOENT 安静 miss", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const dir = tmpProject("nudo-npm-fs-enoent-");
      expect(resolveNpmJsEntry("pkg", dir)).toBeNull();
      expect(resolveNpmNudo("pkg", dir)).toBeNull();
      expect(errSpy).not.toHaveBeenCalled();
    } finally { vi.restoreAllMocks(); }
  });

  it.runIf(!isRoot)("EACCES 可见且不炸：package.json / legacy main 候选 / nudo 候选", () => {
    {
      const { dir, pkgDir } = makePkg({ main: "index.js" }, { "index.js": "x" });
      chmodSync(pkgDir, 0o000);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let path: string | null = "sentinel";
        expect(() => { path = resolveNpmJsEntry("pkg", dir); }).not.toThrow();
        expect(path).toBeNull();
        const msg = errSpy.mock.calls.map((c) => String(c[0])).join("\\n");
        expect(msg).toContain("[nudo]");
        expect(msg).toContain("package.json");
        expect(msg).toContain("EACCES");
      } finally { chmodSync(pkgDir, 0o755); vi.restoreAllMocks(); }
    }
    {
      const { dir, pkgDir } = makePkg({ main: "./locked/index.js" }, {});
      mkdirSync(join(pkgDir, "locked"), { recursive: true });
      writeFileSync(join(pkgDir, "locked", "index.js"), "x", "utf-8");
      chmodSync(join(pkgDir, "locked"), 0o000);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let result: { path: string | null } | undefined;
        expect(() => { result = resolveNpmJsEntryDetailed("pkg", dir); }).not.toThrow();
        expect(result?.path).toBeNull();
        expect(errSpy.mock.calls.map((c) => String(c[0])).join("\\n")).toContain("EACCES");
      } finally { chmodSync(join(pkgDir, "locked"), 0o755); vi.restoreAllMocks(); }
    }
    {
      const { dir, pkgDir } = makePkg({ exports: { ".": { nudo: "./locked/index.nudo.js" } } }, {});
      mkdirSync(join(pkgDir, "locked"), { recursive: true });
      writeFileSync(join(pkgDir, "locked", "index.nudo.js"), "x", "utf-8");
      chmodSync(join(pkgDir, "locked"), 0o000);
      const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        let path: string | null = "sentinel";
        expect(() => { path = resolveNpmNudo("pkg", dir); }).not.toThrow();
        expect(path).toBeNull();
        expect(String(errSpy.mock.calls[0]?.[0])).toContain("EACCES");
      } finally { chmodSync(join(pkgDir, "locked"), 0o755); vi.restoreAllMocks(); }
    }
  });
});
