/**
 * Bug 811 回归（harvester 落盘面）：`emitAbs` 的 `case "any"` 分支**丢掉泛型 α
 * 的 var term** ⇒ 落盘 env 模块**整体失去泛型性**（内存 `number` vs 产物
 * `unknown`）。
 *
 * oracle（`tsc --strict`）：`declare function first<T>(x: T[]): T` 完全合法 ⇒
 * 收割器不得把 α 降级成 unknown。
 *
 * 内存面（harvestDts）已经是对的：`first: (arr(T)) => T`，返回位的 term 是
 * `{ op: "var", id: "T" }`。**落盘面**（`emitEnvModule` 的产物）此前是：
 *
 *   first: relationFn([makeAbs({ k: "arr", element: absUnknown }, …)], absUnknown, { conf: "exact" })
 *
 * ⇒ α 的 var term 整个没了 ⇒ 同一个 harvest 结果，**内存与产物两个不同类型**
 * ⇒ 引擎在调用点绑不上 α ⇒ 假 `nudo:unknown-inference`。
 *
 * ⚠️ **本片不修**：`emitAbs` / `emitEnvModule` 在 `harvest-dts.ts` 的
 * 1208–1290（**H6 的区间**）⇒ 本分片只读它，**把精确改法写进交付报告**
 * 交主 agent 接线。本文件是**钉**：接线前红、接线后绿。
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatShape, type Abs } from "@nudojs/core";
import { harvestDts, emitEnvModule } from "../harvest-dts.ts";

const dirs: string[] = [];
const generatedFiles: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const f of generatedFiles) rmSync(f, { force: true });
});

function writeTemp(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-harvest-bug811-"));
  dirs.push(dir);
  const p = join(dir, name);
  writeFileSync(p, content, "utf-8");
  return p;
}

const fx = writeTemp(
  "fx.d.ts",
  `export declare function first<T>(x: T[]): T;
`,
);

const env = harvestDts([fx]);
const code = emitEnvModule(env, "fx");

/** fn Abs 的返回位 / 形参位里的 α var term id */
function varTermIds(a: unknown): string[] {
  const shape = (a as {
    shape: { k: string; paramTypes?: unknown[]; returnType?: unknown };
  }).shape;
  const out: string[] = [];
  const push = (x: unknown): void => {
    const t = (x as { term?: { op: string; id?: string } })?.term;
    if (t?.op === "var" && t.id) out.push(t.id);
  };
  for (const p of shape.paramTypes ?? []) push(p);
  push(shape.returnType);
  return out;
}

/** 数组元素位上的 α var term id */
function arrElemVarIds(a: unknown): string[] {
  const shape = (a as { shape: { k: string; paramTypes?: unknown[]; element?: unknown } }).shape;
  const out: string[] = [];
  for (const p of shape.paramTypes ?? []) {
    const el = (p as { shape: { k: string; element?: unknown } })?.shape;
    if (el?.k !== "arr") continue;
    const t = (el.element as { term?: { op: string; id?: string } })?.term;
    if (t?.op === "var" && t.id) out.push(t.id);
  }
  return out;
}

describe("Bug 811 —— 落盘产物保留泛型 α 的 var term（不被降级成 unknown）", () => {
  it("内存面：α 的 var term 在位（对照基准）", () => {
    expect(varTermIds(env.globals.first)).toEqual(["T"]);
    expect(arrElemVarIds(env.globals.first)).toEqual(["T"]);
    expect(formatShape(env.globals.first)).toBe("(arr(T)) => T");
  });

  it("emitEnvModule 源码保留 α 的 var term（不再退化成 absUnknown）", () => {
    // α 的身份必须被发射出去（termVar(...) 或等价的 { op: "var", id } 字面量）
    expect(code).toMatch(/termVar\(\s*"T"\s*\)|op:\s*"var"/);
    const line = code.split("\n").find((l) => l.trim().startsWith("first:")) ?? "";
    expect(line).not.toContain("element: absUnknown");
    expect(line).not.toMatch(/,\s*absUnknown\s*,\s*\{\s*conf/);
  });

  it("落盘产物求值后与内存收割同口径（α 仍是 α，不是 unknown）", async () => {
    const generatedPath = fileURLToPath(
      new URL("./generated-env-bug811.tmp.ts", import.meta.url),
    );
    writeFileSync(generatedPath, code, "utf-8");
    generatedFiles.push(generatedPath);
    const mod = await import("./generated-env-bug811.tmp.ts");
    const evaluated = mod.defineEnv();
    // α 的 var term 必须在产物里活着（否则落盘 env 整体失去泛型性）
    expect(varTermIds(evaluated.globals.first)).toEqual(["T"]);
    expect(arrElemVarIds(evaluated.globals.first)).toEqual(["T"]);
    expect(formatShape(evaluated.globals.first as Abs)).toBe(formatShape(env.globals.first));
  });
});
