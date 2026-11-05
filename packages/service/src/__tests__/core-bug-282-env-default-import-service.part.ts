/**
 * Bug 282 —— env 模块的 ESM **默认导入**（`import fs from "node:fs"`）
 * 此前全量降级 `unknown` + **假** `nudo:unknown-inference` + 门禁**假绿**
 * （与同一模块的命名空间导入门禁结论相反）。
 *
 * 根因（service 侧）：`collectEnvModules` 构造 env 模块表时**只装 named、
 * 不装 default 槽** ⇒ core 的 `bindImport` 在 `name === "default"` 分支取不到
 * 值 ⇒ 折 `unknown`。
 *
 * 修法：env 模块是 **CJS 互操作**模块（Node 的 `node:fs` 默认导出就是模块
 * 对象本身，具名导出挂在它上面）⇒ env 表补 `default` 槽（= 该模块的命名空间
 * Abs）并打 `interopDefault` 标记（core 侧默认导入绑定的单一事实源
 * `defaultImportBindingOf` 据此回退）。
 *
 * 口径边界：**只装在 env 表上**——用户模块表不动 ⇒ 用户模块缺 default 仍是
 * `unknown`（Bug 990 口径：模块表有该 mod 但没有 default ⇒ 就是没有 default）。
 *
 * 钉：
 * - env 表的 `node:fs` 必须有 default 槽（= 命名空间）+ 互操作标记；
 * - 默认导入与命名空间导入给出**同一个**签名（`number` + throws Error），
 *   且**不再**有那条假的 `nudo:unknown-inference`；
 * - **负控制**：env 表的具名导出槽不得被 default 槽污染。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  pTrue,
  extractFileEnvNames,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  formatShape,
  type RunTranspiledOptions,
} from "@nudojs/core";
import { collectEnvGlobals, collectEnvModules } from "../eval-run.ts";

/** 与 CLI buildCheckInjection 同口径：文件 env 名 → envGlobals + env 模块表注入 */
function cliLikeEnvOpts(source: string): {
  modules: RunTranspiledOptions["modules"];
  inject: RunTranspiledOptions;
} {
  const envNames = extractFileEnvNames(source);
  const inject: RunTranspiledOptions = {
    envGlobals: collectEnvGlobals(envNames),
    modules: collectEnvModules(envNames),
  };
  return { modules: inject.modules, inject };
}

const DEFAULT_SRC = `/// @nudo:env node
import fs from "node:fs";
export function gateDefault() { return fs.readFileSync("/x").length; }
`;
const NAMESPACE_SRC = `/// @nudo:env node
import * as fs from "node:fs";
export function gateNamespace() { return fs.readFileSync("/x").length; }
`;

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

describe("Bug 282：env 模块的 ESM 默认导入（service 侧 env 模块表）", () => {
  it("env 模块表补 default 槽（= 命名空间）+ 互操作标记", () => {
    const mods = collectEnvModules(["node"]);
    const fsMod = mods["node:fs"];
    expect(fsMod).toBeDefined();
    expect(fsMod!.default).toBeDefined();
    expect(fsMod!.interopDefault).toBe(true);
    // default 槽 = 该模块的命名空间（全部具名导出）
    expect(fsMod!.default!.shape.k).toBe("obj");
    const slots = fsMod!.default!.shape.k === "obj" ? (fsMod!.default!.shape.slots ?? {}) : {};
    expect(Object.keys(slots)).toContain("readFileSync");
  });

  it("默认导入与命名空间导入给出同一个签名（不再是 unknown）", () => {
    const rDef = checkSource("/t/env-default.js", DEFAULT_SRC, pTrue, cliLikeEnvOpts(DEFAULT_SRC));
    const rNs = checkSource("/t/env-namespace.js", NAMESPACE_SRC, pTrue, cliLikeEnvOpts(NAMESPACE_SRC));
    const sigDef = rDef.signatures.find((s) => s.name === "gateDefault");
    const sigNs = rNs.signatures.find((s) => s.name === "gateNamespace");
    expect(sigDef).toBeDefined();
    expect(sigNs).toBeDefined();
    // 修复前：默认导入侧签名塌 unknown（命名空间侧是 number）
    expect(formatShape(sigDef!.abs)).toBe(formatShape(sigNs!.abs));
    expect(formatShape(sigDef!.abs)).toBe("number");
  });

  it("默认导入侧不再产出那条假的 nudo:unknown-inference", () => {
    const r = checkSource("/t/env-default.js", DEFAULT_SRC, pTrue, cliLikeEnvOpts(DEFAULT_SRC));
    expect(r.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
  });

  it("负控制：env 表的具名导出槽不被 default 槽污染", () => {
    const mods = collectEnvModules(["node"]);
    const named = mods["node:fs"]!.named;
    expect(named.readFileSync).toBeDefined();
    // 具名槽仍是 env 声明的 fn Abs（不是命名空间对象）
    expect(named.readFileSync!.shape.k).toBe("fn");
  });
});
