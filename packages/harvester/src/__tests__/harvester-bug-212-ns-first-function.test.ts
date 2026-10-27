/**
 * BUG-212 回归：`nsSlotsByName` 的 set / get 键不对称（写带 `\0` 分隔符、读漏掉）
 * ⇒ `.d.ts` 里 **namespace 先声明**、同名 function 后声明时**函数被整条丢弃**
 * ⇒ 调用它被判 `throws TypeError` ⇒ L2 假红（tsc 判绿、宿主可调用）。
 *
 * 契约：两种声明顺序给出**同一个**可调用函数（命名空间成员挂成静态槽）。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape, type Abs, type Slot } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug212-"));
  dirs.push(dir);
  const p = join(dir, "index.d.ts");
  writeFileSync(p, content, "utf-8");
  return p;
}

const NS_FIRST = `export declare namespace helper {
  function extra(): number;
}
export declare function helper(s: string): number;
`;

const FN_FIRST = `export declare function helper(s: string): number;
export declare namespace helper {
  function extra(): number;
}
`;

function helperOf(dts: string): Abs {
  return harvestDts([writeTemp(dts)]).globals.helper!;
}

function staticSlots(a: Abs): Record<string, Slot> {
  const s = a.shape;
  return s.k === "fn" ? (s.slots ?? {}) : {};
}

describe("BUG-212 —— namespace 先声明时函数不得被丢弃", () => {
  it("ns-first：helper 是可调用函数（不是命名空间对象）", () => {
    const h = helperOf(NS_FIRST);
    expect(h.shape.k).toBe("fn");
    expect(formatShape(h)).toContain("=> number");
    // 命名空间成员挂成静态槽
    expect(Object.keys(staticSlots(h))).toEqual(["extra"]);
  });

  it("两种声明顺序给出同一个形态", () => {
    const a = helperOf(NS_FIRST);
    const b = helperOf(FN_FIRST);
    expect(a.shape.k).toBe(b.shape.k);
    expect(formatShape(a)).toBe(formatShape(b));
    expect(Object.keys(staticSlots(a))).toEqual(Object.keys(staticSlots(b)));
  });
});
