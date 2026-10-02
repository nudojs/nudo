/**
 * DESIGN-001：emit 四出口（absToTSType / absToSchemaNode / denoteGuard via
 * generateGuardFunction / serializeCaseArg）对环与超深 Abs 的截断。
 *
 * e2e 锚点：evaluator 对真实用户代码 `const a = {}; a.self = a;
 * export default a` 产出**真环**（slot.value 与导出是同一 Abs 对象）——
 * 修复前 formatShape 直接 RangeError（见 core projection-budget-cycle
 * 测试的 fix 前证据），本文件钉住四个出口全部有界且截断可观测：
 *
 * - absToTSType：`/* nudo:truncated:* *\/ unknown`（合法 TS，过 tsc 门）
 * - absToSchemaNode：unknown 节点 + dropped 台账记 truncated
 * - denoteGuard：`/* nudo:truncated:* *\/ true`（合法 JS，new Function 可编译）
 * - serializeCaseArg：null（既有「不可表达」信号）
 */
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abs as makeAbs, num, runTranspiled, formatShape, type Abs } from "@nudojs/core";
import { absToTSType } from "../dts-generator.ts";
import { absToSchemaNode } from "../schema-generator.ts";
import { generateGuardFunctionFromAbs } from "../guard-generator.ts";
import { serializeCaseArg } from "../case-emitter.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** dts-projection-quality 同款 tsc 门：截断标记必须是合法 TS */
function tscNoEmit(dts: string): { ok: boolean; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-trunc-"));
  dirs.push(dir);
  const p = join(dir, "mod.d.ts");
  writeFileSync(p, dts.endsWith("\n") ? dts : dts + "\n", "utf-8");
  try {
    execFileSync("pnpm", ["exec", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--ignoreConfig", p], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, stderr: "" };
  } catch (e) {
    const err = e as { stderr?: string; stdout?: string; message?: string };
    return { ok: false, stderr: `${err.stderr ?? ""}${err.stdout ?? err.message ?? ""}` };
  }
}

/** evaluator 产出真环：`const a = {}; a.self = a; export default a` */
function evaluatorCyclicAbs(): Abs {
  const src = `const a = {};
a.self = a;
export default a;
`;
  const exp = runTranspiled(src, {}) as { default: Abs };
  return exp.default;
}

/** n 层嵌套 obj（无环） */
function deepObjAbs(depth: number): Abs {
  let a: Abs = num();
  for (let i = 0; i < depth; i++) {
    a = makeAbs({ k: "obj", slots: { v: { value: a } } }, undefined, undefined, "exact");
  }
  return a;
}

describe("cyclic Abs (evaluator-produced, DESIGN-001)", () => {
  it("is genuinely cyclic (identity back-edge in the shape graph)", () => {
    const a = evaluatorCyclicAbs();
    const slot = (a.shape as { slots: Record<string, { value: Abs }> }).slots.self;
    expect(slot.value).toBe(a);
  });

  it("absToTSType truncates with a legal, observable TS marker", () => {
    const ts = absToTSType(evaluatorCyclicAbs());
    expect(ts).toContain("/* nudo:truncated:cycle */ unknown");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("absToSchemaNode records the truncation in the dropped ledger", () => {
    const { node, dropped } = absToSchemaNode(evaluatorCyclicAbs());
    expect(dropped.some((d) => d.includes("truncated (cycle)"))).toBe(true);
    // 截断子树折叠为 unknown 节点，可被 zod / standard 渲染
    expect(node.k).toBe("obj");
    const selfSlot = (node as { slots: Array<{ key: string; node: SchemaNodeLike }> }).slots.find(
      (s) => s.key === "self",
    );
    expect(selfSlot?.node.k).toBe("unknown");
  });

  it("guard source stays syntactically valid with a truncation comment", () => {
    const src = generateGuardFunctionFromAbs("isA", evaluatorCyclicAbs());
    expect(src).toContain("/* nudo:truncated:cycle */ true");
    expect(() => new Function("data", src.replace(/^export function \w+/, "function guard"))).not.toThrow();
  });

  it("serializeCaseArg returns null (grammar cannot express a cycle)", () => {
    expect(serializeCaseArg(evaluatorCyclicAbs())).toBeNull();
  });

  it("formatShape renders an explicit cycle marker (no RangeError)", () => {
    expect(formatShape(evaluatorCyclicAbs())).toBe("{ self: …cycle }");
  });
});

describe("deep-but-acyclic Abs (200 levels, DESIGN-001)", () => {
  it("absToTSType truncates with a legal depth marker", () => {
    const ts = absToTSType(deepObjAbs(200));
    expect(ts).toContain("/* nudo:truncated:depth */ unknown");
    expect(ts).not.toContain("truncated:cycle");
    const check = tscNoEmit(`export type T = ${ts};`);
    expect(check.ok, check.stderr).toBe(true);
  });

  it("absToSchemaNode records the depth truncation in the dropped ledger", () => {
    const { dropped } = absToSchemaNode(deepObjAbs(200));
    expect(dropped.some((d) => d.includes("truncated (depth)"))).toBe(true);
  });

  it("guard source stays syntactically valid", () => {
    const src = generateGuardFunctionFromAbs("isDeep", deepObjAbs(200));
    expect(src).toContain("/* nudo:truncated:depth */ true");
    expect(() => new Function("data", src.replace(/^export function \w+/, "function guard"))).not.toThrow();
  });

  it("serializeCaseArg returns null beyond the budget", () => {
    expect(serializeCaseArg(deepObjAbs(200))).toBeNull();
    // 预算内（60 层）仍可完整序列化
    expect(serializeCaseArg(deepObjAbs(60))).not.toBeNull();
  });
});

type SchemaNodeLike = { k: string };
