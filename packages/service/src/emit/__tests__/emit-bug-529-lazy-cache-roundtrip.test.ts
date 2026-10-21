/**
 * Bug 529 —— 契约面磁盘缓存的 `lazy()` 递归约束往返（冷跑/热跑逐字一致）。
 *
 * 病灶：`constraintToJson` 用 `JSON.parse(JSON.stringify(c))` 落盘 ⇒ JSON 遇
 * 函数值属性（`lazy` 槽的 thunk）**静默省略** ⇒ 递归约束退化成「无字段的
 * optional 槽」⇒ 命中缓存后印成 `any().optional()`：冷跑与热跑输出不同，
 * 且热跑比 `nudo check` 门禁面更宽松（跨产物面自相矛盾）。
 *
 * 本测试钉住：
 * - 同一文件冷跑（写缓存）与缓存命中跑**逐字相同**；
 * - 缓存文件里 `lazy` 槽以**节点表引用**留存（不是被 JSON 静默省略）；
 * - 负控制：非 lazy 契约的往返不受影响（无节点表、显示不变）。
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
  const root = mkdtempSync(join(tmpdir(), "nudo-iface-529-"));
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

const LIB_JS = `export function render(node) {
  return String(node);
}
`;

const LAZY_NUDO_JS = `
import { fn, shape, string, lazy } from "@nudojs/core";
const astNode = shape({ type: string(), object: lazy(() => astNode).optional() });
export const render = fn({ node: astNode }, string());
`;

const PLAIN_NUDO_JS = `
import { fn, number } from "@nudojs/core";
export const render = fn({ node: number().gt(0) }, number());
`;

/** 跑一次契约面（缓存开）；返回打印行 + 缓存目录里的全部文件 */
async function runWithCache(
  file: string,
  cacheDir: string,
): Promise<{ lines: string[]; cacheFiles: string[] }> {
  const prev = process.env.NUDO_CACHE_DIR;
  process.env.NUDO_CACHE_DIR = cacheDir;
  try {
    const entries = await interfaceSurface(file);
    return {
      lines: entries.map(formatInterfaceSurfaceLine),
      cacheFiles: collectFiles(cacheDir),
    };
  } finally {
    if (prev === undefined) delete process.env.NUDO_CACHE_DIR;
    else process.env.NUDO_CACHE_DIR = prev;
  }
}

describe("Bug 529 — lazy() 递归约束的磁盘缓存往返", () => {
  it("冷跑与缓存命中跑逐字相同（递归展开不被 any().optional() 取代）", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": LAZY_NUDO_JS });
    const file = join(root, "lib.js");
    const cacheDir = join(root, ".cache");

    // 冷跑：写缓存
    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines).toHaveLength(1);
    expect(cold.lines[0]).toContain("object?: shape({ type: string()");
    // 病灶形态（旧实现）：递归层塌成 any().optional()
    expect(cold.lines[0]).not.toContain("any().optional()");

    // 热跑：命中磁盘缓存
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.lines[0]).not.toContain("any().optional()");

    // 缓存文件里 lazy 槽以节点表引用留存（不是被 JSON 静默省略）
    expect(hot.cacheFiles.length).toBeGreaterThan(0);
    const raw = hot.cacheFiles.map((p) => readFileSync(p, "utf8")).join("\n");
    expect(raw).toContain('"lazy":');
    expect(raw).toContain('"nodes":');
  });

  it("负控制：非 lazy 契约的往返显示不变、缓存无节点表", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": PLAIN_NUDO_JS });
    const file = join(root, "lib.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    expect(cold.lines[0]).toContain("node: number().gt(0)");
    const hot = await runWithCache(file, cacheDir);
    expect(hot.lines).toEqual(cold.lines);

    const raw = hot.cacheFiles.map((p) => readFileSync(p, "utf8")).join("\n");
    expect(raw).not.toContain('"lazy":');
    expect(raw).not.toContain('"nodes":');
  });

  it("旧缓存表（无版本号）整层 miss：不得当命中读出退化约束", async () => {
    const root = makeFixture({ "lib.js": LIB_JS, "lib.nudo.js": LAZY_NUDO_JS });
    const file = join(root, "lib.js");
    const cacheDir = join(root, ".cache");

    const cold = await runWithCache(file, cacheDir);
    const cacheFile = cold.cacheFiles[0]!;
    const parsed = JSON.parse(readFileSync(cacheFile, "utf8")) as { value: { v?: number } };
    // 模拟旧格式缓存（无版本号）
    parsed.value.v = undefined;
    writeFileSync(cacheFile, JSON.stringify(parsed), "utf8");

    const hot = await runWithCache(file, cacheDir);
    // 旧表被忽略 ⇒ 重算 ⇒ 输出仍与冷跑一致（不退化成 any().optional()）
    expect(hot.lines).toEqual(cold.lines);
    expect(hot.lines[0]).not.toContain("any().optional()");
  });
});
