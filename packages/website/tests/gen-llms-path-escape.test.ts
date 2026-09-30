// R2B-005 / R2-4：gen-llms slug → 输出路径不得逃逸 build 根。
// 恶意 frontmatter `slug:`（或 blog custom slug）含 `..` 时必须拒绝，
// 不得在 packages/website/build 之外 mkdir/writeFileSync。
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const GEN_LLMS = join(repoRoot, "scripts/gen-llms.mjs");

type LlmsPaths = {
  normalizeSlug: (slug: string) => string;
  safeOutPath: (buildDir: string, route: string) => string;
};

const helpers = (await import(GEN_LLMS)) as unknown as LlmsPaths;

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/** 伪仓库根：packages/website/{docs,blog,build} + zh docs 目录齐全。 */
function makeFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "gen-llms-escape-"));
  temps.push(root);
  for (const d of [
    "packages/website/build",
    "packages/website/docs",
    "packages/website/blog",
    "packages/website/i18n/zh-Hans/docusaurus-plugin-content-docs/current",
  ]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  return root;
}

function writeDoc(root: string, rel: string, slug: string | null, body = "hello\n"): void {
  const p = join(root, "packages/website/docs", rel);
  mkdirSync(dirname(p), { recursive: true });
  const fm = slug === null ? "" : `---\nslug: ${slug}\n---\n`;
  writeFileSync(p, fm + body);
}

function writeBlog(root: string, file: string, slug: string | null): void {
  const p = join(root, "packages/website/blog", file);
  const fm = slug === null ? "" : `---\nslug: ${slug}\n---\n`;
  writeFileSync(p, fm + "post\n");
}

function runGen(root: string): { status: number; stderr: string } {
  try {
    execFileSync(process.execPath, [GEN_LLMS], {
      env: { ...process.env, GEN_LLMS_ROOT: root },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? 1, stderr: String(err.stderr ?? "") };
  }
}

/**
 * root 下「本不该有」的 .md：排除输入源（docs/blog/i18n）与输出 build 根，
 * 剩下的 .md 即逃逸产物（如 <root>/README.md、packages/README.md）。
 */
function mdOutsideBuild(root: string): string[] {
  const allowed = [
    join(root, "packages/website/docs") + sep,
    join(root, "packages/website/blog") + sep,
    join(root, "packages/website/i18n") + sep,
    join(root, "packages/website/build") + sep,
  ];
  const bad: string[] = [];
  const scan = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) scan(p);
      else if (e.name.endsWith(".md") && !allowed.some((a) => p.startsWith(a))) {
        bad.push(p);
      }
    }
  };
  scan(root);
  return bad;
}

describe("normalizeSlug", () => {
  it("keeps normal slugs (leading / stripped, . segments dropped)", () => {
    expect(helpers.normalizeSlug("intro")).toBe("intro");
    expect(helpers.normalizeSlug("/intro")).toBe("intro");
    expect(helpers.normalizeSlug("guides/foo")).toBe("guides/foo");
    expect(helpers.normalizeSlug("a/./b")).toBe("a/b");
    expect(helpers.normalizeSlug("releases-history")).toBe("releases-history");
  });

  it("rejects .. segments (path escape)", () => {
    for (const bad of [
      "..",
      "../..",
      "../../../../README",
      "docs/../../../README",
      "/..",
      "a/../..",
      "..\\..\\pwned",
    ]) {
      expect(() => helpers.normalizeSlug(bad), bad).toThrow(/escapes build root/);
    }
  });

  it("rejects absolute / drive-letter slugs and empty results", () => {
    expect(() => helpers.normalizeSlug("C:\\evil")).toThrow(/absolute slug/);
    expect(() => helpers.normalizeSlug("C:/evil")).toThrow(/absolute slug/);
    expect(() => helpers.normalizeSlug("/")).toThrow(/empty slug/);
    expect(() => helpers.normalizeSlug(".")).toThrow(/empty slug/);
  });
});

describe("safeOutPath", () => {
  it("resolves inside buildDir", () => {
    const buildDir = join(tmpdir(), "gen-llms-build-check");
    expect(helpers.safeOutPath(buildDir, "/docs/intro")).toBe(
      resolve(buildDir, "docs/intro.md"),
    );
  });

  it("rejects routes that leave buildDir after join+resolve", () => {
    const buildDir = join(tmpdir(), "gen-llms-build-check");
    for (const bad of ["/docs/../../pwned", "/docs/../../../etc/passwd", "/../x"]) {
      expect(() => helpers.safeOutPath(buildDir, bad), bad).toThrow(/escapes buildDir/);
    }
  });
});

describe("gen-llms malicious slug cannot write outside build root", () => {
  const malicious = [
    { where: "doc frontmatter", slug: "../../../../README" },
    { where: "doc frontmatter", slug: "docs/../../../README" },
    { where: "doc frontmatter", slug: "../../../../.github/workflows/x" },
    { where: "doc frontmatter", slug: "../../tmp/pwned" },
    { where: "doc frontmatter", slug: ".." },
    { where: "blog custom slug", slug: "../../../../README" },
    { where: "blog custom slug", slug: "../../tmp/pwned" },
  ];

  for (const { where, slug } of malicious) {
    it(`${where} slug ${JSON.stringify(slug)} is rejected and writes nothing outside build`, () => {
      const root = makeFixture();
      if (where === "doc frontmatter") writeDoc(root, "evil.md", slug);
      else writeBlog(root, "2026-01-01-evil.md", slug);

      const { status, stderr } = runGen(root);
      expect(status, stderr).not.toBe(0);
      expect(stderr).toMatch(/slug escapes build root|path escapes buildDir|absolute slug|empty slug/);

      // 关键回归：build 根外不得出现 .md 旁挂产物，也不得留下逃逸 mkdir。
      expect(mdOutsideBuild(root)).toEqual([]);
      expect(existsSync(join(root, "README.md"))).toBe(false);
      expect(existsSync(join(root, "packages/README.md"))).toBe(false);
      expect(existsSync(join(root, "packages/website/tmp"))).toBe(false);
      expect(existsSync(join(root, ".github"))).toBe(false);
    });
  }

  it("honest slugs still land inside buildDir", () => {
    const root = makeFixture();
    writeDoc(root, "intro.md", "/intro");
    writeDoc(root, "guides/start.md", null);
    writeBlog(root, "2026-01-01-hello.md", "/hello");
    writeBlog(root, "2026-01-02-plain.md", null);

    const { status, stderr } = runGen(root);
    expect(status, stderr).toBe(0);
    const build = join(root, "packages/website/build");
    expect(existsSync(join(build, "docs/intro.md"))).toBe(true);
    expect(existsSync(join(build, "docs/guides/start.md"))).toBe(true);
    expect(existsSync(join(build, "blog/hello.md"))).toBe(true);
    expect(existsSync(join(build, "blog/2026/01/02/plain.md"))).toBe(true);
    expect(existsSync(join(build, "llms-full.txt"))).toBe(true);
    expect(mdOutsideBuild(root)).toEqual([]);
  });
});
