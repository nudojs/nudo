/**
 * Bug 990：`collectAbsExports` 的 **re-export 在 `modules` 表缺席时退化成
 * 「本地导出」** ⇒ 凭空造出 named / **default** 导出槽（协议层非法值：
 * default 槽的**存在性**表示「该模块确实有 default 导出」）；同文件的
 * `bindImports` 亦**不查 `mod.default`** ⇒ `import { default as d }` 绑成
 * unknown（与 `import d from` **不等价**）。
 *
 * 根因（abs-modules.ts）：分支条件用「**有没有 `modules` 表**」代替了
 * 「这个 re-export 的来源模块**可达吗**」⇒ `modules` 缺席时落回本地
 * specifier 分支 ⇒ re-export 被误当成本地导出。
 *
 * 钉：
 * - 三形态（modules 未提供 / modules 提供但 mod 不在表里 / modules 提供且
 *   mod 在表里）里，前两者必须**逐字相同**（来源不可达 ⇒ 不产生任何导出槽）。
 * - `export { default } from "./m.js"` 在来源不可达时 ⇒ **default 槽必须缺席**。
 * - `import { default as d } from "./m.js"` ⇒ `d` 必须绑定到 `mod.default`
 *   （与 `import d from` 同口径）。
 */
import { describe, it, expect } from "vitest";
import { collectAbsExports, bindImports } from "../abs-modules.ts";
import { parseSource } from "../parse-source.ts";
import { emptyEnv } from "../ast-env.ts";
import { abs } from "../abs.ts";
import { formatShape } from "../format.ts";
import type { AbsModuleExports } from "../abs-modules.ts";

const num = abs({ k: "prim", type: "number" }, undefined, undefined, "exact");
const str = abs({ k: "prim", type: "string" }, undefined, undefined, "exact");

/** 来源模块（同时有 named.x 与 default） */
const SRC_MOD: AbsModuleExports = { named: { x: str }, default: num };

const MOD_TABLE: Record<string, AbsModuleExports> = { "./m.js": SRC_MOD };
/** modules 提供但来源不在表里 */
const OTHER_TABLE: Record<string, AbsModuleExports> = { "./other.js": { named: {} } };

/** 导出表的形态摘要（named 名单 + default 槽存在性） */
function shapeOf(r: AbsModuleExports): string {
  const named = Object.keys(r.named).sort().join(",");
  return `named={${named}} default=${r.default === undefined ? "absent" : "present"}`;
}

/** 收集某个导出形态在三形态 modules 表下的摘要 */
function threeForms(src: string): [string, string, string] {
  const file = parseSource(src);
  return [
    shapeOf(collectAbsExports(file, emptyEnv())),
    shapeOf(collectAbsExports(file, emptyEnv(), OTHER_TABLE)),
    shapeOf(collectAbsExports(file, emptyEnv(), MOD_TABLE)),
  ];
}

describe("Bug 990：re-export 的分支条件只看 source，不看 modules 表在不在", () => {
  it("`export { a } from './m.js'`：来源不可达时不产生任何导出槽", () => {
    const [noMods, modMissing, modPresent] = threeForms(`export { a } from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 a（named={a}）
    expect(noMods).toBe("named={} default=absent");
    // 来源不可达的两种口径必须一致
    expect(noMods).toBe(modMissing);
    // 来源可达但缺名 ⇒ 留 unknown 槽（可达 ≠ 不可达）
    expect(modPresent).toBe("named={a} default=absent");
  });

  it("`export { default } from './m.js'`：来源不可达时 default 槽必须缺席", () => {
    const [noMods, modMissing, modPresent] = threeForms(`export { default } from "./m.js";`);
    // 修复前：noMods 形态凭空造出 default 槽（协议层非法值）
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    // 来源可达 ⇒ default 槽存在
    expect(modPresent).toBe("named={} default=present");
  });

  it("`export { default as d } from './m.js'`：来源不可达时不产生任何导出槽", () => {
    const [noMods, modMissing, modPresent] = threeForms(`export { default as d } from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 d
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    expect(modPresent).toBe("named={d} default=absent");
  });

  it("`export * as ns from './m.js'`：来源不可达时不产生任何导出槽", () => {
    const [noMods, modMissing] = threeForms(`export * as ns from "./m.js";`);
    // 修复前：noMods 形态凭空登记本地导出 ns
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
  });

  it("`export * from './m.js'`：来源不可达时不产生任何导出槽", () => {
    const [noMods, modMissing, modPresent] = threeForms(`export * from "./m.js";`);
    expect(noMods).toBe("named={} default=absent");
    expect(noMods).toBe(modMissing);
    expect(modPresent).toBe("named={x} default=absent");
  });

  it("本地导出（无 source）不受影响：仍是本地导出表", () => {
    const file = parseSource(`const a = 1;\nexport { a };\n`);
    const r = collectAbsExports(file, emptyEnv(), OTHER_TABLE);
    expect(Object.keys(r.named)).toEqual(["a"]);
  });

  it("bindImports：`import { default as d }` 与 `import d from` 绑定同一个值", () => {
    const bind = (src: string): string => {
      const file = parseSource(src);
      const env = emptyEnv();
      const stmt = file.program.body[0];
      expect(stmt?.type).toBe("ImportDeclaration");
      bindImports(stmt as never, env, MOD_TABLE);
      const out: string[] = [];
      for (const [k, v] of env.vars) out.push(`${k}=${formatShape(v)}`);
      return out.join(",");
    };
    // 修复前：`import { default as d }` 绑成 unknown（与 `import d from` 不等价）
    expect(bind(`import d from "./m.js";`)).toBe("d=number");
    expect(bind(`import { default as d } from "./m.js";`)).toBe("d=number");
    expect(bind(`import { x } from "./m.js";`)).toBe("x=string");
  });
});
