// R2-4 / FIX-J3：gen-api-docs `inject` fail-closed 标记注入。
// 缺/逆/重复 BEGIN…END 标记必须 throw，绝不 append 双标记，也不得写盘或删除内容。
// 对齐 scripts/gen-releases.mjs `inject` 的失败模式。
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const GEN_API_DOCS = join(repoRoot, "scripts/gen-api-docs.mjs");

type InjectFn = (path: string, block: string) => string;

const { inject } = (await import(GEN_API_DOCS)) as unknown as { inject: InjectFn };

const BEGIN = "<!-- NUDO-API-SKELETON:BEGIN -->";
const END = "<!-- NUDO-API-SKELETON:END -->";

const temps: string[] = [];

afterEach(() => {
  while (temps.length) {
    const d = temps.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

function makeFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "gen-api-docs-markers-"));
  temps.push(dir);
  const p = join(dir, "page.md");
  writeFileSync(p, content);
  return p;
}

describe("inject — valid markers", () => {
  it("replaces block between well-ordered pair and preserves outside prose", () => {
    const p = makeFile(
      `# Title\n\nHand-written intro.\n\n${BEGIN}\nOLD\n${END}\n\nHand-written footer.\n`,
    );
    const mode = inject(p, "NEW");
    expect(mode).toBe("injected");
    const src = readFileSync(p, "utf8");
    expect(src).toBe(
      `# Title\n\nHand-written intro.\n\n${BEGIN}\nNEW\n${END}\n\nHand-written footer.\n`,
    );
  });

  it("is idempotent — second run produces identical file", () => {
    const p = makeFile(`intro\n${BEGIN}\nOLD\n${END}\nfooter\n`);
    inject(p, "NEW");
    const first = readFileSync(p, "utf8");
    inject(p, "NEW");
    expect(readFileSync(p, "utf8")).toBe(first);
  });
});

describe("inject — fail-closed on corrupt markers (R2-4 regression)", () => {
  const cases: Array<{ name: string; content: string }> = [
    {
      name: "BEGIN without END (half-matched)",
      content: `intro\n${BEGIN}\nOLD\nfooter\n`,
    },
    {
      name: "END without BEGIN (half-matched)",
      content: `intro\nOLD\n${END}\nfooter\n`,
    },
    {
      name: "END before BEGIN (inverted)",
      content: `intro\n${END}\nOLD\n${BEGIN}\nfooter\n`,
    },
    {
      name: "no markers at all",
      content: `intro\nfooter\n`,
    },
    {
      name: "duplicate BEGIN (previous bad append)",
      content: `intro\n${BEGIN}\nA\n${END}\nprose\n${BEGIN}\nB\n${END}\nfooter\n`,
    },
    {
      name: "duplicate END",
      content: `intro\n${BEGIN}\nA\n${END}\nprose\n${END}\nfooter\n`,
    },
  ];

  for (const { name, content } of cases) {
    it(`${name} → throws, does not write, does not delete content`, () => {
      const p = makeFile(content);
      const before = readFileSync(p, "utf8");
      expect(() => inject(p, "NEW"), name).toThrow(/markers not found/);
      // 关键回归：坏标记不得写盘，也不得删除/改写既有内容。
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(p, "utf8")).toBe(before);
    });
  }

  it("does not append a second BEGIN…END pair on half-matched markers", () => {
    const p = makeFile(`intro\n${BEGIN}\nOLD\nfooter\n`);
    expect(() => inject(p, "NEW")).toThrow(/markers not found/);
    const src = readFileSync(p, "utf8");
    // 只有一个 BEGIN，没有被追加出第二个 pair。
    expect(src.split(BEGIN).length - 1).toBe(1);
    expect(src.includes(END)).toBe(false);
  });
});
