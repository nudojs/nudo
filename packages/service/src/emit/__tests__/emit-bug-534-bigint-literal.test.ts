/**
 * Bug 534 —— 契约面遇 **bigint 字面量契约** 不得整条命令崩溃。
 *
 * 病灶：`constraintToJson` 用 `JSON.parse(JSON.stringify(c))` 落盘 ⇒ JSON
 * **无法表示 bigint** ⇒ `JSON.stringify` 直接抛 `TypeError: Do not know how
 * to serialize a BigInt` ⇒ `nudo contract` 整条命令 exit 1（裸异常，无文件、
 * 无诊断码）；而 `nudo check` / `health` / `test` 对同一份文件全绿。
 *
 * 本测试钉住：
 * - bigint 字面量契约**正常出结果**（不抛、不崩）；
 * - 缓存落盘用**带类型标签**的编码（bigint 以十进制字符串留存），读回可还原；
 * - 负控制：普通字面量契约的显示与往返不受影响。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { formatInterfaceSurfaceLine, interfaceSurface } from "../interface-surface.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeFixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "nudo-iface-534-"));
  dirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

/** 递归列出目录下的全部文件（缓存分片目录：<root>/<ns>/<xx>/<hash>.json） */
function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(d, name);
      let isDir = false;
      try {
        isDir = statSync(p).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(p);
      else out.push(p);
    }
  };
  walk(dir);
  return out;
}

const SRC_JS = `export function g(n) {
  return n;
}
`;

const BIGINT_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10n) }, lit(10n));
`;

const NUMBER_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(10) }, lit(10));
`;

const INFINITY_NUDO_JS = `
import { fn, lit } from "@nudojs/core";
export const g = fn({ n: lit(Infinity) }, lit(Infinity));
`;

async function runWithCache(
  file: string,
  cacheDir: string,
): Promise<{ lines: string[]; cacheRaw: string }> {
  const prev = process.env.NUDO_CACHE_DIR;
  process.env.NUDO_CACHE_DIR = cacheDir;
  try {
    const entries = await interfaceSurface(file);
    const cacheFiles = collectFiles(cacheDir);
    return {
      lines: entries.map(formatInterfaceSurfaceLine),
      cacheRaw: cacheFiles.map((p) => readFileSync(p, "utf8")).join("\n"),
    };
  } finally {
    if (prev === undefined) delete process.env.NUDO_CACHE_DIR;
    else process.env.NUDO_CACHE_DIR = prev;
  }
}

describe("Bug 534 — bigint 字面量契约不得让契约面崩溃", () => {
  it("bigint 字面量契约正常出结果（改前：抛 Do not know how to serialize a BigInt）", async () => {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": BIGINT_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines).toHaveLength(1);
    expect(cold.lines[0]).toContain("g");
    // bigint 保 `n` 后缀（Bug 361）：`lit(10)` 与 `lit(10n)` 在诊断文本里必须
    // 可区分 —— 否则「expected:」陈述的是**另一条契约**（抄回侧车即得相反契约）。
    // 本用例的诉求是「不崩」，渲染形态按 361 走。
    expect(cold.lines[0]).toContain("n: lit(10n)");

    // 热跑（缓存命中）同样不崩、显示一致
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);

    // 落盘用带类型标签的编码：bigint 以十进制字符串留存（不被 JSON 丢弃/抛错）
    expect(hot.cacheRaw).toContain('"t":"bigint"');
    expect(hot.cacheRaw).toContain('"v":"10"');
  });

  it("往返保真：Infinity 字面量读回仍是 Infinity（改前：JSON ⇒ null ⇒ lit(null)）", async () => {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": INFINITY_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines[0]).toContain("lit(Infinity)");
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.lines[0]).not.toContain("lit(null)");
  });

  it("负控制：普通数字字面量契约显示与往返不变", async () => {
    const root = makeFixture({ "c.js": SRC_JS, "c.nudo.js": NUMBER_NUDO_JS });
    const file = join(root, "c.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines[0]).toContain("n: lit(10)");
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.cacheRaw).not.toContain('"t":"bigint"');
  });
});
