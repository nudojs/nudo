/**
 * Bug 796 回归（harvester 收割面）：`declare class` 的**实例成员整体丢失**，且
 * `const p: Point` 这个**绑定从 globals 里彻底消失**。
 *
 * oracle（`tsc --strict`，见 tmp/probe/fix-r27/h5/e2e/cls/）：
 * - `export declare class Point { x: number; y: number; … }` + `export declare const p: Point;`
 *   ⇒ `p` 是 `Point` 的实例（`p.x` 是 number），`dist(a, b)` 的参数面是 `Point`；
 *   `tsc --strict` exit 0。
 *
 * 收割侧契约：
 *   1. `declare class` 的**实例成员**进实例面（属性 / 方法 / 访问器；`static` 不进）；
 *   2. `const p: Point` 这个**绑定保留**在 globals 里（类型是 `Point` 的实例面）；
 *   3. 以类名做参数类型时，参数面是 `Point`（不是 unknown）。
 *
 * 改前（实测）：`globals = ["Point", "dist"]`（`p` 整个不见了），
 * `Point: () => unknown`（空壳），`dist: (unknown, unknown) => number`。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { harvestDts } from "../harvest-dts.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug796-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const CLS = `export declare class Point {
  x: number;
  y: number;
  label: string;
  move(dx: number, dy: number): void;
  origin(): Point;
}
export declare const p: Point;
export declare function dist(a: Point, b: Point): number;
`;

/** brand / obj 形状的槽位名（brand 的内层是 obj 的 Abs） */
function slotNames(a: unknown): string[] {
  const s = (a as { shape?: Record<string, unknown> }).shape;
  if (!s) return [];
  if (s["k"] === "obj") {
    const slots = s["slots"] as Record<string, unknown> | undefined;
    return slots ? Object.keys(slots) : [];
  }
  if (s["k"] === "brand") {
    const inner = (s["shape"] as { shape?: { slots?: Record<string, unknown> } } | undefined)?.shape;
    return inner?.slots ? Object.keys(inner.slots) : [];
  }
  return [];
}

describe("Bug 796 —— declare class 的实例成员不再整体丢失，绑定不再消失", () => {
  it("`const p: Point` 绑定保留在 globals 里（改前整个消失）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(env.globals["p"]).toBeDefined();
    expect(Object.hasOwn(env.globals, "p")).toBe(true);
  });

  it("`p` 的类型是 Point 的实例面（不是 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["p"]!)).toBe("Point");
  });

  it("实例成员进实例面（x / y / label / move / origin）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    const inst = env.globals["p"]!;
    expect(slotNames(inst)).toEqual(expect.arrayContaining(["x", "y", "label", "move", "origin"]));
  });

  it("以类名做参数类型时参数面是 Point（改前退化成 unknown）", () => {
    const p = writeTemp("fx.d.ts", CLS);
    const env = harvestDts([p]);
    expect(formatShape(env.globals["dist"]!)).toBe("(Point, Point) => number");
  });

  it("静态成员不进实例面", () => {
    const p = writeTemp(
      "fx.d.ts",
      `export declare class WithStatic {
  static counter: number;
  value: number;
}
export declare const w: WithStatic;
`,
    );
    const env = harvestDts([p]);
    const names = slotNames(env.globals["w"]!);
    expect(names).toContain("value");
    expect(names).not.toContain("counter");
  });
});
