/**
 * Bug 1045 回归：多个 `@nudo:env` 名的合并必须取**并集**（与书写顺序无关）。
 *
 * 病灶（`packages/service/src/evaluator/env-loader.ts` · `applyEnvDefinition`）：
 * 同名全局被**整块替换**（后一个 env 赢）⇒ `@nudo:env node, web` 与
 * `@nudo:env web, node` 得到两张不同的全局表 ⇒ **同一份源码**签名不同、
 * 门禁结论相反（OK vs FAILED）——与文档承诺的 env 名之间是 union 相悖。
 *
 * 修法：合并改为并集——
 * - obj ⊕ obj ⇒ 逐槽并集（同名槽的值域再并集）；
 * - 其余形态 ⇒ 值域并集（sum，成员按结构键排序 ⇒ 可交换 / 可结合）；
 * - 模块侧同名导出名同样取并集。
 *
 * 断言面：
 * 1. env 名顺序互换 ⇒ 签名**逐字相同** + 门禁结论相同（硬判据）；
 * 2. 合并表是**并集**而非「取某一个」（槽位覆盖断言）；
 * 3. `pf()` 两种顺序下都不再判「必抛 TypeError」（`performance.toJSON` 并集后存在）；
 * 4. 负控：单 env（只写 `web`）时全局表与 check 行为**逐字不变**。
 */
import { describe, it, expect } from "vitest";
import {
  absShapeKey,
  checkSource,
  createEnvironment,
  formatAbs,
  pTrue,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  type Abs,
} from "@nudojs/core";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { defineEnv as defineWebEnv } from "@nudojs/env/web";
import { loadEnvs } from "../evaluator/env-loader.ts";

const SRC = `export function mk(x) {
  return Response.json(x);
}
export function pf() {
  return performance.toJSON();
}
`;

/** 一次 check 的可比面：签名串 + 诊断码 + 门禁结论 */
type CheckFace = {
  sigs: string[];
  issues: string[];
  ok: boolean;
};

function checkWith(envGlobals: Record<string, Abs>, file: string): CheckFace {
  resetGeneralizeMemo();
  resetCheckSourceMemo();
  const r = checkSource(file, SRC, pTrue, { inject: { envGlobals } });
  return {
    sigs: r.signatures.map((s) => `${s.name} => ${s.display}`),
    issues: r.issues.map((i) => `${i.severity}:${i.code}:${i.fn ?? ""}`),
    ok: r.ok,
  };
}

/** 走 env-loader（真实路径：env 名 → 解析 → 合并 → 全局表） */
function checkWithEnvNames(envNames: string[], file: string): CheckFace {
  const envGlobals = loadEnvs(envNames, createEnvironment()).globals;
  return checkWith(envGlobals, file);
}

/**
 * 值的「实例面」槽名集合：
 * obj → 自有槽；brand → 内层 obj 槽；fn → 返回面；sum → 各成员并集。
 */
function surfaceSlotNames(a: Abs): Set<string> {
  const out = new Set<string>();
  const visit = (x: Abs): void => {
    const s = x.shape;
    if (s.k === "sum") {
      s.members.forEach(visit);
      return;
    }
    if (s.k === "obj") {
      Object.keys(s.slots).forEach((k) => out.add(k));
      return;
    }
    if (s.k === "brand") {
      visit(s.shape);
      return;
    }
    if (s.k === "fn" && s.returnType !== undefined) {
      visit(s.returnType);
    }
  };
  visit(a);
  return out;
}

/** obj 形状的自有槽名（performance 这类「纯对象」全局） */
function objSlotNames(a: Abs): Set<string> {
  const s = a.shape;
  if (s.k === "obj") return new Set(Object.keys(s.slots));
  return new Set();
}

/** fn 的静态槽名（dual-facet 成员：Response.json / Array.isArray …）；sum ⇒ 各成员并集 */
function staticSlotNames(a: Abs): Set<string> {
  const s = a.shape;
  if (s.k === "sum") {
    const out = new Set<string>();
    s.members.forEach((m) => staticSlotNames(m).forEach((k) => out.add(k)));
    return out;
  }
  if (s.k === "fn" && s.slots) return new Set(Object.keys(s.slots));
  return new Set();
}

describe("Bug 1045 · @nudo:env 多名合并取并集（顺序无关）", () => {
  it("env 名顺序互换 ⇒ 签名逐字相同 + 门禁结论相同", () => {
    const a = checkWithEnvNames(["node", "web"], "/t/env-1045-node-web.js");
    const b = checkWithEnvNames(["web", "node"], "/t/env-1045-web-node.js");
    expect(a.sigs).toEqual(b.sigs);
    expect(a.issues).toEqual(b.issues);
    expect(a.ok).toBe(b.ok);
    // 两份源码只差 env 名顺序 ⇒ 诊断集合不得一边有一边无
    expect(a.issues).not.toContain("error:nudo:entry-may-throw:pf");
    expect(b.issues).not.toContain("error:nudo:entry-may-throw:pf");
  });

  it("合并后的 Response 是并集：实例面覆盖 web 侧与 node 侧的全部槽位", () => {
    const merged = loadEnvs(["node", "web"], createEnvironment()).globals;
    const web = loadEnvs(["web"], createEnvironment()).globals;
    const node = loadEnvs(["node"], createEnvironment()).globals;
    const mergedSlots = surfaceSlotNames(merged["Response"]!);
    // 任务书点名的槽位
    expect(mergedSlots.has("type")).toBe(true); // web 侧
    expect(mergedSlots.has("json")).toBe(true); // node 侧
    expect(mergedSlots.has("text")).toBe(true); // node 侧
    expect(mergedSlots.has("bodyUsed")).toBe(true); // node 侧
    // 覆盖两侧的**全部**实例槽（取其中一侧就会缺另一侧的槽 ⇒ 并集可证）
    for (const name of surfaceSlotNames(web["Response"]!)) {
      expect(mergedSlots.has(name), `web 侧槽 ${name}`).toBe(true);
    }
    for (const name of surfaceSlotNames(node["Response"]!)) {
      expect(mergedSlots.has(name), `node 侧槽 ${name}`).toBe(true);
    }
    // 静态槽（Response.json / redirect / error）两侧都有 ⇒ 并集后仍在
    for (const name of staticSlotNames(web["Response"]!)) {
      expect(staticSlotNames(merged["Response"]!).has(name), `静态槽 ${name}`).toBe(true);
    }
  });

  it("合并后的 performance 含 web 侧独有的 toJSON + node 侧槽位（逐槽并集）", () => {
    const merged = loadEnvs(["node", "web"], createEnvironment()).globals;
    const web = loadEnvs(["web"], createEnvironment()).globals;
    const node = loadEnvs(["node"], createEnvironment()).globals;
    const mergedSlots = objSlotNames(merged["performance"]!);
    // web 侧声明的成员（node 侧后来也补了同名成员）⇒ 并集后必须在
    expect(mergedSlots.has("toJSON")).toBe(true);
    for (const name of objSlotNames(web["performance"]!)) {
      expect(mergedSlots.has(name), `web 侧槽 ${name}`).toBe(true);
    }
    for (const name of objSlotNames(node["performance"]!)) {
      expect(mergedSlots.has(name), `node 侧槽 ${name}`).toBe(true);
    }
    // 并集严格大于任一单侧（取一 env 就不成立）
    expect(mergedSlots.size).toBeGreaterThan(objSlotNames(web["performance"]!).size);
    expect(mergedSlots.size).toBeGreaterThan(objSlotNames(node["performance"]!).size);
  });

  it("pf() 两种顺序下都不再判「必抛 TypeError」（toJSON 并集后存在）", () => {
    for (const names of [
      ["node", "web"],
      ["web", "node"],
    ]) {
      const face = checkWithEnvNames(names, `/t/env-1045-pf-${names.join("_")}.js`);
      const pf = face.sigs.find((s) => s.startsWith("pf =>")) ?? "(missing)";
      expect(pf, names.join(",")).not.toContain("never throws TypeError");
      expect(
        face.issues.filter((i) => i.includes("nudo:entry-may-throw")),
        names.join(","),
      ).toEqual([]);
    }
  });

  it("负控：单 env（只写 web）时全局表与 check 行为逐字不变", () => {
    const loaded = loadEnvs(["web"], createEnvironment()).globals;
    const own = defineWebEnv().globals;
    // 全局名集合不变
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(own).sort());
    // 每个全局的形态逐字不变（fn 的静态槽也一并比）
    for (const [key, value] of Object.entries(own)) {
      expect(formatAbs(loaded[key]!), key).toBe(formatAbs(value));
      expect(absShapeKey(loaded[key]!), key).toBe(absShapeKey(value));
      expect([...staticSlotNames(loaded[key]!)].sort(), key).toEqual(
        [...staticSlotNames(value)].sort(),
      );
    }
    // check 结论：走 env-loader 与直接注入 env 自身声明 ⇒ 逐字相同
    const viaLoader = checkWithEnvNames(["web"], "/t/env-1045-single-web.js");
    const viaOwn = checkWith(own, "/t/env-1045-single-web-own.js");
    expect(viaLoader.sigs).toEqual(viaOwn.sigs);
    expect(viaLoader.issues).toEqual(viaOwn.issues);
    expect(viaLoader.ok).toBe(viaOwn.ok);
  });

  it("负控：单 env（只写 node）时全局表与 env 自身声明逐字不变", () => {
    const loaded = loadEnvs(["node"], createEnvironment()).globals;
    const own = defineNodeEnv().globals;
    expect(Object.keys(loaded).sort()).toEqual(Object.keys(own).sort());
    for (const [key, value] of Object.entries(own)) {
      expect(formatAbs(loaded[key]!), key).toBe(formatAbs(value));
      expect(absShapeKey(loaded[key]!), key).toBe(absShapeKey(value));
    }
  });
});
