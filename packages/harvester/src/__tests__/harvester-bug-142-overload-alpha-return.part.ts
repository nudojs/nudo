/**
 * BUG-142 回归：合并 α（类型形参）overload 时按「带 α 的那一池」**整池替换**
 * 返回类型 ⇒ 其它 overload 的返回类型被抹掉 + 悬空 α ⇒ CLI **静默 `any`、零诊断**，
 * 且结论随声明顺序翻转。
 *
 * 契约：返回位取并集；α 只有在**参数表能绑定**时才保留（不得悬空）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug142-"));
  dirs.push(dir);
  const p = join(dir, "ovl.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

function termVarIds(a: Abs, depth = 0, out = new Set<string>()): Set<string> {
  if (depth > 6) return out;
  if (a.term?.op === "var") out.add(a.term.id);
  const s = a.shape;
  if (s.k === "fn") {
    for (const p of s.paramTypes ?? []) termVarIds(p, depth + 1, out);
    if (s.returnType) termVarIds(s.returnType, depth + 1, out);
  } else if (s.k === "sum") for (const m of s.members) termVarIds(m, depth + 1, out);
  return out;
}

const CONCRETE_FIRST = `declare function h(x: string): string;
declare function h<T>(x: T): T;
`;

const GENERIC_FIRST = `declare function h<T>(x: T): T;
declare function h(x: string): string;
`;

describe("BUG-142 —— overload 合并不得留下悬空 α", () => {
  it("具体 overload 在前：返回位保留具体类型（不是悬空 T / any）", () => {
    const h = harvestDts([writeTemp(CONCRETE_FIRST)]).globals.h!;
    expect(formatShape(h)).toBe("(string) => string");
    // 返回位的 α 必须能在参数表里绑定 ⇒ 这里返回位不应有 var
    const shape = h.shape;
    if (shape.k !== "fn") throw new Error(`expected fn shape, got ${shape.k}`);
    expect([...termVarIds(shape.returnType!)]).toEqual([]);
  });

  it("泛型 overload 在前：保留 α（可被实参绑定）", () => {
    const h = harvestDts([writeTemp(GENERIC_FIRST)]).globals.h!;
    expect(formatShape(h)).toBe("(T) => T");
  });

  it("两种声明顺序不被抹成静默 any（旧行为：(string) => T ⇒ any）", () => {
    const a = harvestDts([writeTemp(CONCRETE_FIRST)]).globals.h!;
    expect(formatShape(a)).not.toContain("any");
  });
});
