// FIX-J3 residual / FIX-RESIDUAL-2：gen-releases `inject` fail-closed 标记注入。
// 缺/逆/重复 BEGIN…END 标记必须 throw，绝不 append 双标记，也不得写盘或删除内容。
// 对齐 scripts/gen-api-docs.mjs `inject` 的失败模式（J3）。
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const GEN_RELEASES = join(repoRoot, "scripts/gen-releases.mjs");

type InjectFn = (path: string, begin: string, end: string, content: string) => void;

const { inject } = (await import(GEN_RELEASES)) as unknown as { inject: InjectFn };

const B = "<!-- NUDO-VERSIONS:BEGIN -->";
const E = "<!-- NUDO-VERSIONS:END -->";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function makeFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gen-releases-markers-"));
  temps.push(dir);
  const p = join(dir, "page.md");
  writeFileSync(p, content);
  return p;
}

describe("inject — valid markers", () => {
  it("replaces block between well-ordered pair and preserves outside prose", () => {
    const p = makeFile(`# Title\n\nHand-written intro.\n\n${B}\nOLD\n${E}\n\nHand-written footer.\n`);
    inject(p, B, E, "NEW");
    const src = readFileSync(p, "utf8");
    expect(src).toBe(
      `# Title\n\nHand-written intro.\n\n${B}\nNEW\n${E}\n\nHand-written footer.\n`,
    );
  });

  it("is idempotent — second run produces identical file", () => {
    const p = makeFile(`intro\n${B}\nOLD\n${E}\nfooter\n`);
    inject(p, B, E, "NEW");
    const first = readFileSync(p, "utf8");
    inject(p, B, E, "NEW");
    expect(readFileSync(p, "utf8")).toBe(first);
  });

  it("injects independent marker pairs in the same file without cross-talk", () => {
    const A = "<!-- A:BEGIN -->";
    const AE = "<!-- A:END -->";
    const p = makeFile(`${B}\nOLD-VERSIONS\n${E}\nmid\n${A}\nOLD-ECO\n${AE}\n`);
    inject(p, B, E, "NEW-VERSIONS");
    inject(p, A, AE, "NEW-ECO");
    const src = readFileSync(p, "utf8");
    expect(src).toContain("NEW-VERSIONS");
    expect(src).toContain("NEW-ECO");
  });
});

describe("inject — fail-closed on corrupt markers (J3 regression)", () => {
  const cases: Array<{ name: string; content: string }> = [
    {
      name: "BEGIN without END (half-matched)",
      content: `intro\n${B}\nOLD\nfooter\n`,
    },
    {
      name: "END without BEGIN (half-matched)",
      content: `intro\nOLD\n${E}\nfooter\n`,
    },
    {
      name: "END before BEGIN (inverted)",
      content: `intro\n${E}\nOLD\n${B}\nfooter\n`,
    },
    {
      name: "no markers at all",
      content: `intro\nfooter\n`,
    },
    {
      name: "duplicate BEGIN (previous bad append)",
      content: `intro\n${B}\nA\n${E}\nprose\n${B}\nB\n${E}\nfooter\n`,
    },
    {
      name: "duplicate END",
      content: `intro\n${B}\nA\n${E}\nprose\n${E}\nfooter\n`,
    },
  ];

  for (const { name, content } of cases) {
    it(`${name} → throws, does not write, does not delete content`, () => {
      const p = makeFile(content);
      const before = readFileSync(p, "utf8");
      expect(() => inject(p, B, E, "NEW"), name).toThrow(/markers not found/);
      // 关键回归：坏标记不得写盘，也不得删除/改写既有内容。
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, "utf8")).toBe(before);
    });
  }

  it("does not append a second BEGIN…END pair on half-matched markers", () => {
    const p = makeFile(`intro\n${B}\nOLD\nfooter\n`);
    expect(() => inject(p, B, E, "NEW")).toThrow(/markers not found/);
    const src = readFileSync(p, "utf8");
    // 只有一个 BEGIN，没有被追加出第二个 pair。
    expect(src.split(B).length - 1).toBe(1);
    expect(src.includes(E)).toBe(false);
  });
});
