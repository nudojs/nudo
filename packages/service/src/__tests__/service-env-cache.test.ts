/**
 * 模块套件：service env/cache/exports/resolve 面。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { checkSource, pTrue, extractFileEnvNames, resetCheckSourceMemo, resetGeneralizeMemo, formatShape, type RunTranspiledOptions, absShapeKey, createEnvironment, formatAbs, type Abs, runTranspiled, callTranspiledExportFull, numLit, bindingsOf, pureFnNameOf } from "@nudojs/core";
import { collectEnvGlobals, collectEnvModules, tryRunEval, tryEvalCallFull } from "../eval-run.ts";
import { readFileSync, statSync, utimesSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { analyzeFileAsync, analysisFileCacheKey, analyzeFile } from "../analyzer.ts";
import { clearFnAnalysisCache } from "../fn-analysis-cache.ts";
import { tmpProject, writeTmpFile, writeTmpFiles, tmpProject as makeTmpProject } from "./tmp-project.ts";
import { isNudoTargetPath } from "../target-path.ts";
import { defineEnv as defineNodeEnv } from "@nudojs/env/node";
import { defineEnv as defineWebEnv } from "@nudojs/env/web";
import { loadEnvs, clearPathEnvCaches, preloadPathEnvs, getPathEnvLoadErrors } from "../evaluator/env-loader.ts";
import { DIAG } from "@nudojs/core/internal";
import { collectCheckSupplementIssues } from "../check-issues.ts";
import type { AnalysisResult } from "../analyzer-types.ts";
import { runCheck } from "nudojs/commands/check.ts";
import { evalAbsModuleGraph, clearAbsModuleCache } from "../abs-modules-graph.ts";
import { resolveNpmJsEntryDetailed, resolveNpmJsEntry, resolveNpmNudo } from "../evaluator/resolve-npm.ts";
import { buildModuleGraph, computeDirtySet } from "../analyzer-module-load.ts";
import { checkCacheKey, contractCacheKey } from "../disk-cache.ts";
import { findProjectConfig, evictProjectConfigMemo, diskCacheRoot, contractConfig, applyBForkBudgetFromConfig, currentBForkBudgetLimit, analysisConfig, effectiveMaxForks, checkConfig } from "../evaluator/config.ts";
import { contractSurface } from "../emit/contract-surface.ts";
import { analyzeFileAsync as analyzeFileAsync___nudojs_service, clearEvalCache } from "@nudojs/service";
import { moduleResolveCandidates, resolveModuleFile } from "../load-module.ts";

// ---------------------------------------------------------------------------
// env 模块的 ESM 默认导入（service 侧 env 模块表）
// ---------------------------------------------------------------------------
describe("env 模块的 ESM 默认导入（service 侧 env 模块表）", () => {
/**
 * env 模块的 ESM **默认导入**（`import fs from "node:fs"`）
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
 * `unknown`（口径：模块表有该 mod 但没有 default ⇒ 就是没有 default）。
 *
 * 钉：
 * - env 表的 `node:fs` 必须有 default 槽（= 命名空间）+ 互操作标记；
 * - 默认导入与命名空间导入给出**同一个**签名（`number` + throws Error），
 * 且**不再**有那条假的 `nudo:unknown-inference`；
 * - **负控制**：env 表的具名导出槽不得被 default 槽污染。
 */




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

describe("env 模块的 ESM 默认导入（service 侧 env 模块表）", () => {
  const cliLikeEnvOpts = (source: string) => {
    const envNames = extractFileEnvNames(source);
    const inject: RunTranspiledOptions = { envGlobals: collectEnvGlobals(envNames), modules: collectEnvModules(envNames) };
    return { modules: inject.modules, inject };
  };
  const DEFAULT_SRC = `/// @nudo:env node
import fs from "node:fs";
export function gateDefault() { return fs.readFileSync("/x").length; }
`;
  const NAMESPACE_SRC = `/// @nudo:env node
import * as fs from "node:fs";
export function gateNamespace() { return fs.readFileSync("/x").length; }
`;
  beforeEach(() => { resetCheckSourceMemo(); resetGeneralizeMemo(); });
  it("default 槽 + interop 标记；默认/命名空间同签名；无假 unknown-inference；具名槽不污染", () => {
    const mods = collectEnvModules(["node"]);
    const fsMod = mods["node:fs"]!;
    expect(fsMod.default).toBeDefined();
    expect(fsMod.interopDefault).toBe(true);
    expect(fsMod.default!.shape.k).toBe("obj");
    const slots = fsMod.default!.shape.k === "obj" ? (fsMod.default!.shape.slots ?? {}) : {};
    expect(Object.keys(slots)).toContain("readFileSync");

    const rDef = checkSource("/t/env-default.js", DEFAULT_SRC, pTrue, cliLikeEnvOpts(DEFAULT_SRC));
    const rNs = checkSource("/t/env-namespace.js", NAMESPACE_SRC, pTrue, cliLikeEnvOpts(NAMESPACE_SRC));
    const sigDef = rDef.signatures.find((s) => s.name === "gateDefault")!;
    const sigNs = rNs.signatures.find((s) => s.name === "gateNamespace")!;
    expect(formatShape(sigDef.abs)).toBe(formatShape(sigNs.abs));
    expect(formatShape(sigDef.abs)).toBe("number");
    expect(rDef.issues.filter((i) => i.code === "nudo:unknown-inference")).toEqual([]);
    expect(fsMod.named.readFileSync!.shape.k).toBe("fn");
  });
});
;
});

// ---------------------------------------------------------------------------
// 函数级缓存对 env 内容敏感
// ---------------------------------------------------------------------------
describe("函数级缓存对 env 内容敏感", () => {
/**
 * 回归：函数级分析缓存的 env 维度必须与另外两层（文件级
 * `analysisFileCacheKey`、求值器 memo）**同口径**——用**内容指纹**，不是 mtime。
 *
 * 改前函数级键只编码 `pathEnvPreloadFingerprint()`（mtime）⇒ `cp -p` / `tar -x`
 * / 同秒编辑（内容变、mtime 不变）时文件级缓存正确失效并重跑，函数级却命中
 * **旧的**推断类型 ⇒ 两层结论不一致。
 */








/** 项目级 env 文件：`defineEnv()` 返回 `{ globals }`。 */
const ENV_NUM = "export function defineEnv() {\n  return { globals: { v: 1 } };\n}\n";
const ENV_STR = 'export function defineEnv() {\n  return { globals: { v: "hello" } };\n}\n';

/** 入口函数的推断返回面。 */
async function returnShapeOf(filePath: string, source: string): Promise<string> {
  const r = await analyzeFileAsync(filePath, source);
  const fn = r.functions.find((f) => f.name === "f");
  expect(fn?.combinedAbs).toBeDefined();
  return formatShape(fn!.combinedAbs!);
}

beforeEach(() => {
  clearFnAnalysisCache();
});

describe("函数级缓存对 env 内容敏感", () => {
  const ENV_NUM = "export function defineEnv() {\n  return { globals: { v: 1 } };\n}\n";
  const ENV_STR = 'export function defineEnv() {\n  return { globals: { v: "hello" } };\n}\n';
  const returnShapeOf = async (filePath: string, source: string): Promise<string> => {
    const r = await analyzeFileAsync(filePath, source);
    const fn = r.functions.find((f) => f.name === "f");
    expect(fn?.combinedAbs).toBeDefined();
    return formatShape(fn!.combinedAbs!);
  };
  beforeEach(() => { clearFnAnalysisCache(); });
  it("env 内容变 mtime 不变 ⇒ 必须 miss；内容不变两次一致", async () => {
    const dir = tmpProject("nudo-b012-env-", {
      "package.json": JSON.stringify({ name: "p", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_NUM,
      "main.js": "export function f() { return v; }\n",
    });
    const mainPath = join(dir, "main.js");
    const envPath = join(dir, "env.ts");
    const source = readFileSync(mainPath, "utf-8");
    expect(await returnShapeOf(mainPath, source)).toBe("1");
    const st = statSync(envPath);
    writeFileSync(envPath, ENV_STR);
    utimesSync(envPath, st.atime, st.mtime);
    expect(await returnShapeOf(mainPath, source)).toBe('"hello"');

    const stableDir = tmpProject("nudo-b012-stable-", {
      "package.json": JSON.stringify({ name: "p", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_NUM,
      "main.js": "export function f() { return v; }\n",
    });
    const stablePath = join(stableDir, "main.js");
    const stableSource = readFileSync(stablePath, "utf-8");
    expect(await returnShapeOf(stablePath, stableSource)).toBe("1");
    expect(await returnShapeOf(stablePath, stableSource)).toBe("1");
  });
});
;
});

// ---------------------------------------------------------------------------
// 目录目标扩展名集合
// ---------------------------------------------------------------------------
describe("目录目标扩展名集合", () => {
/**
 * 回归：`nudo check` 的目录目标判定必须覆盖与 `migrate verify`
 * 一致的文件集，否则 `migrate retire` 装出的门禁 `nudo check .` 在该包上
 * **恒红**（对目标目录返回空集 ⇒ `nudo:path-empty-dir` ⇒ exit 1）。
 *
 * 改前只认 `.js/.mjs/.ts` ⇒ `.mts`/`.cts`/`.cjs` 包装上就是红的。
 */



describe("目录目标扩展名集合", () => {
  it("覆盖 .js/.mjs/.cjs/.ts/.mts/.cts；排除声明/侧车/draft/JSX", () => {
    for (const p of ["a.js", "a.mjs", "a.cjs", "a.ts", "a.mts", "a.cts", "src/lib.MTS"]) expect(isNudoTargetPath(p), p).toBe(true);
    for (const p of ["a.d.ts", "a.d.mts", "a.d.cts", "a.nudo.js", "a.nudo.ts", "a.nudo.draft.js", "a.tsx", "a.jsx"]) expect(isNudoTargetPath(p), p).toBe(false);
  });
});
;
});

// ---------------------------------------------------------------------------
// @nudo:env 多名合并取并集（顺序无关）
// ---------------------------------------------------------------------------
describe("@nudo:env 多名合并取并集（顺序无关）", () => {
/**
 * 回归：多个 `@nudo:env` 名的合并必须取**并集**（与书写顺序无关）。
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

describe("@nudo:env 多名合并取并集（顺序无关）", () => {
  const SRC = `export function mk(x) {
  return Response.json(x);
}
export function pf() {
  return performance.toJSON();
}
`;
  const checkWith = (envGlobals: Record<string, Abs>, file: string) => {
    resetGeneralizeMemo();
    resetCheckSourceMemo();
    const r = checkSource(file, SRC, pTrue, { inject: { envGlobals } });
    return { sigs: r.signatures.map((s) => `${s.name} => ${s.display}`), issues: r.issues.map((i) => `${i.severity}:${i.code}:${i.fn ?? ""}`), ok: r.ok };
  };
  const checkWithEnvNames = (envNames: string[], file: string) => checkWith(loadEnvs(envNames, createEnvironment()).globals, file);
  const surfaceSlotNames = (a: Abs): Set<string> => {
    const out = new Set<string>();
    const visit = (x: Abs): void => {
      const s = x.shape;
      if (s.k === "sum") { s.members.forEach(visit); return; }
      if (s.k === "obj") { Object.keys(s.slots).forEach((k) => out.add(k)); return; }
      if (s.k === "brand") { visit(s.shape); return; }
      if (s.k === "fn" && s.returnType !== undefined) visit(s.returnType);
    };
    visit(a);
    return out;
  };
  const objSlotNames = (a: Abs): Set<string> => (a.shape.k === "obj" ? new Set(Object.keys(a.shape.slots)) : new Set());
  const staticSlotNames = (a: Abs): Set<string> => {
    const s = a.shape;
    if (s.k === "sum") { const out = new Set<string>(); s.members.forEach((m) => staticSlotNames(m).forEach((k) => out.add(k))); return out; }
    if (s.k === "fn" && s.slots) return new Set(Object.keys(s.slots));
    return new Set();
  };
  it("顺序无关；Response/performance 并集；pf 不判必抛；单 env 负控", () => {
    const a = checkWithEnvNames(["node", "web"], "/t/e-node-web.js");
    const b = checkWithEnvNames(["web", "node"], "/t/e-web-node.js");
    expect(a.sigs).toEqual(b.sigs);
    expect(a.issues).toEqual(b.issues);
    expect(a.ok).toBe(b.ok);
    expect(a.issues).not.toContain("error:nudo:entry-may-throw:pf");

    const merged = loadEnvs(["node", "web"], createEnvironment()).globals;
    const web = loadEnvs(["web"], createEnvironment()).globals;
    const node = loadEnvs(["node"], createEnvironment()).globals;
    const mergedSlots = surfaceSlotNames(merged["Response"]!);
    for (const name of ["type", "json", "text", "bodyUsed"]) expect(mergedSlots.has(name), name).toBe(true);
    for (const name of surfaceSlotNames(web["Response"]!)) expect(mergedSlots.has(name), `web ${name}`).toBe(true);
    for (const name of surfaceSlotNames(node["Response"]!)) expect(mergedSlots.has(name), `node ${name}`).toBe(true);
    for (const name of staticSlotNames(web["Response"]!)) expect(staticSlotNames(merged["Response"]!).has(name), `static ${name}`).toBe(true);

    const mergedPerf = objSlotNames(merged["performance"]!);
    expect(mergedPerf.has("toJSON")).toBe(true);
    for (const name of objSlotNames(web["performance"]!)) expect(mergedPerf.has(name), `web ${name}`).toBe(true);
    for (const name of objSlotNames(node["performance"]!)) expect(mergedPerf.has(name), `node ${name}`).toBe(true);
    expect(mergedPerf.size).toBeGreaterThan(objSlotNames(web["performance"]!).size);
    expect(mergedPerf.size).toBeGreaterThan(objSlotNames(node["performance"]!).size);

    for (const names of [["node", "web"], ["web", "node"]]) {
      const face = checkWithEnvNames(names, `/t/e-pf-${names.join("_")}.js`);
      expect(face.sigs.find((s) => s.startsWith("pf =>")), names.join(",")).not.toContain("never throws TypeError");
    }

    const webLoaded = loadEnvs(["web"], createEnvironment()).globals;
    const webOwn = defineWebEnv().globals;
    expect(Object.keys(webLoaded).sort()).toEqual(Object.keys(webOwn).sort());
    for (const [key, value] of Object.entries(webOwn)) {
      expect(formatAbs(webLoaded[key]!), key).toBe(formatAbs(value));
      expect(absShapeKey(webLoaded[key]!), key).toBe(absShapeKey(value));
    }
    expect(checkWithEnvNames(["web"], "/t/e-single-web.js").sigs).toEqual(checkWith(webOwn, "/t/e-single-web-own.js").sigs);
    const nodeLoaded = loadEnvs(["node"], createEnvironment()).globals;
    const nodeOwn = defineNodeEnv().globals;
    expect(Object.keys(nodeLoaded).sort()).toEqual(Object.keys(nodeOwn).sort());
    for (const [key, value] of Object.entries(nodeOwn)) {
      expect(formatAbs(nodeLoaded[key]!), key).toBe(formatAbs(value));
      expect(absShapeKey(nodeLoaded[key]!), key).toBe(absShapeKey(value));
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 项目级 path env 必须按项目根解析（文件级按文件目录）
// ---------------------------------------------------------------------------
describe("项目级 path env 必须按项目根解析（文件级按文件目录）", () => {
/**
 * （重犯 ）—— 项目级 path env 被按「**被分析文件所在目录**」
 * 解析 ⇒ agent 面（`collectCheckSupplementIssues`）两种错都犯：
 *
 * - **假阳**：项目级 env 文件明明在**项目根**存在，却被报成
 * `path env not found: <proj>/src/env.ts`——那个路径**根本不存在**；
 * - **假阴**：项目级 env 的**真实加载失败**（如不导出 `defineEnv`）记在
 * **项目根**基准下（CLI 按项目根预载），而本模块只按文件目录取
 * ⇒ 取不到 ⇒ **零诊断**（真实失败被静默丢弃）。
 *
 * 口径（与 CLI `assembleEnvs` 同源，见 `packages/nudojs/src/commands/check.ts`）：
 * **项目级**（`package.json#nudo.env`）按**项目根**解析；**文件级**
 * （`/// @nudo:env`）按**被分析文件所在目录**解析。
 */







/** env-unresolved 通道的消息（其它通道的诊断不算）。 */
function envMessages(filePath: string, source: string): string[] {
  return collectCheckSupplementIssues(filePath, source)
    .filter((i) => i.code === DIAG.envUnresolved)
    .map((i) => i.message);
}

const ENV_OK = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }\n`;
/** 没有 defineEnv 导出 ⇒ 加载「成功」但不是合法 env ⇒ 真实加载失败。 */
const ENV_NO_DEFINE = `export const notDefineEnv = 1;\n`;
const APP_SRC = `export function f() { return 1; }\n`;

describe("项目级 path env 必须按项目根解析（文件级按文件目录）", () => {
  const envMessages = (filePath: string, source: string) => collectCheckSupplementIssues(filePath, source).filter((i) => i.code === DIAG.envUnresolved).map((i) => i.message);
  const ENV_OK = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }
`;
  const ENV_NO_DEFINE = `export const notDefineEnv = 1;
`;
  const APP_SRC = `export function f() { return 1; }
`;
  beforeEach(() => { clearPathEnvCaches(); });
  it("项目级 env 按项目根：存在不假阳、加载失败可见；文件级仍按文件目录", async () => {
    const okDir = tmpProject("nudo-1081-env-", { "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }), "env.ts": ENV_OK, "src/app.js": APP_SRC });
    expect(envMessages(join(okDir, "src/app.js"), APP_SRC)).toEqual([]);

    const failDir = tmpProject("nudo-1081-env-fail-", { "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }), "env.ts": ENV_NO_DEFINE, "src/app.js": APP_SRC });
    await preloadPathEnvs(["./env.ts"], failDir);
    const msgs = envMessages(join(failDir, "src/app.js"), APP_SRC);
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join("\n")).toContain(join(failDir, "env.ts"));
    expect(msgs.join("\n")).not.toContain(join(failDir, "src", "env.ts"));

    const fileDir = tmpProject("nudo-1081-file-env-", { "package.json": JSON.stringify({ name: "proj" }), "src/app.js": `/// @nudo:env ./missing.ts\n${APP_SRC}` });
    const fileSrc = `/// @nudo:env ./missing.ts\n${APP_SRC}`;
    const fileMsgs = envMessages(join(fileDir, "src/app.js"), fileSrc);
    expect(fileMsgs).toHaveLength(1);
    expect(fileMsgs[0]).toContain(join(fileDir, "src", "missing.ts"));
  });
});
;
});

// ---------------------------------------------------------------------------
// 项目级 path env 的内容指纹必须按项目根解析
// ---------------------------------------------------------------------------
describe("项目级 path env 的内容指纹必须按项目根解析", () => {
/**
 * 整文件分析缓存键里新增的「项目级 path env **内容**」维度用错了
 * **基准目录**。
 *
 * 修前：`analysisFileCacheKey` 用 `pathEnvContentFingerprint(projectEnvNames,
 * dirname(filePath))` ⇒ 项目级 env（`package.json#nudo.env: ["./env.ts"]`，文件
 * 在**项目根**）在被分析文件位于子目录（`src/app.js`）时，指纹读的是**不存在**
 * 的 `<proj>/src/env.ts` ⇒ 内容退化成 `"<unreadable>"` 的常量哈希 ⇒ 键对该 env
 * 的内容**实际不敏感**（想要的「env 文件内容进键」在项目根以外的文件上
 * 失效）。
 *
 * 修后：项目级 env 名按**项目根**解析（与 CLI `assembleEnvs` 同一口径）⇒
 * 指纹读的是真正的 env 文件 ⇒ 内容变 ⇒ 键 miss。
 */





const CFG = {
  mode: "directives",
  evalMissingSlot: "off",
  callSiteBudget: 3,
  diagnostics: "errors",
  maxForks: 5000,
};

const ENV_V1 = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }\n`;
const ENV_V2 = `export function defineEnv() { return { globals: { MAGIC: 2 } }; }\n`;

describe("项目级 path env 的内容指纹必须按项目根解析", () => {
  const CFG = { mode: "directives", evalMissingSlot: "off", callSiteBudget: 3, diagnostics: "errors", maxForks: 5000 };
  const ENV_V1 = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }
`;
  const ENV_V2 = `export function defineEnv() { return { globals: { MAGIC: 2 } }; }
`;
  it("子目录文件与同目录文件：改 env 内容都必须 miss", () => {
    const dir = tmpProject("nudo-1083-env-fp-", { "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }), "env.ts": ENV_V1, "src/app.js": `export function f() { return MAGIC; }
` });
    const app = join(dir, "src/app.js");
    const src = `export function f() { return MAGIC; }
`;
    const k1 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    writeTmpFile(dir, "env.ts", ENV_V2);
    const k2 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    expect(k1.noCache).toBeFalsy();
    expect(k1.auxKey).not.toBe(k2.auxKey);

    const sameDir = tmpProject("nudo-1083-env-fp-same-", { "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }), "env.ts": ENV_V1, "app.js": `export function f() { return MAGIC; }
` });
    const sameApp = join(sameDir, "app.js");
    const s1 = analysisFileCacheKey(sameApp, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    writeTmpFile(sameDir, "env.ts", ENV_V2);
    const s2 = analysisFileCacheKey(sameApp, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    expect(s1.auxKey).not.toBe(s2.auxKey);
  });
});
;
});

// ---------------------------------------------------------------------------
// 项目级 path env 必须对分析器通道可见（文件带 @nudo:env 时也不丢）
// ---------------------------------------------------------------------------
describe("项目级 path env 必须对分析器通道可见（文件带 @nudo:env 时也不丢）", () => {
/**
 * 项目级 path env（`package.json#nudo.env`）在**分析器通道**
 * 对「声明了任何 `@nudo:env` 的文件」**完全不可见**（假阳 + 假绿 + 口径分裂）。
 *
 * 机制（同一根因的两面）：
 * - 预载侧（`analyzeFileAsync`）把项目级 env 的相对说明符按**项目根**绝对化
 * 后登记 ⇒ 注册表 key = `<proj>/env.mjs`；
 * - 收集侧（`analyzeFileUncachedInner`）却仍用**原始相对名**（`./env.mjs`）
 * 查表，而查表基准 = 「最后一次 preload 的目录」= **文件目录**（文件级 env
 * 预载在后）⇒ 相对说明符的**唯一候选** = `<proj>/src/env.mjs` ⇒ 与预载登记
 * 的 key 不匹配 ⇒ **查表落空** ⇒ env 全局丢失。
 *
 * 后果（实测）：
 * - **假阳**：被分析文件只要声明了**任何** `@nudo:env`（哪怕内建名 `node`），
 * 返回面退化成 `never`（ReferenceError: MAGIC is not defined）+
 * `nudo:builtin-unknown` 警告（IDE 面直接发布 ⇒ 假阳告警 + hover 显示 never）；
 * - **假绿**：env 缺失 ⇒ 大量 unknown/never ⇒ check 的 analyzer 通道弱化判定；
 * - **口径分裂**：同一文件 CLI `nudo check` 显示 `f() => 42`，IDE 通道显示 never。
 *
 * 钉：
 * ① 文件带 `/// @nudo:env node` ⇒ 项目级 env 仍可见（返回面不是 never、
 * 无 `nudo:builtin-unknown` 假阳）；
 * ② 文件不带 `@nudo:env` ⇒ 行为不回退（仍能解析项目级 env）；
 * ③ 分析器通道与 CLI `nudo check` 结论一致（都 `f() => 42`）。
 */








// CLI 面是**只读参照**（正确实现）：本测试用它钉「IDE 通道 ≡ CLI 结论」。


/** 项目级 env（项目根）：MAGIC = 42。 */
const ENV_MJS = `export function defineEnv() {
  return { globals: { MAGIC: 42 } };
}
`;

/** 被分析文件**带**文件级 env（内建名）——修前项目级 env 对它完全不可见。 */
const APP_WITH_FILE_ENV = `/// @nudo:env node
export function f() { return MAGIC; }
`;

/** 被分析文件**不带** `@nudo:env`（基线：项目级 env 恰好可见）。 */
const APP_NO_FILE_ENV = `export function f() { return MAGIC; }
`;

/** 项目（项目级 env 在项目根，被分析文件在 src/ 子目录）。 */
function project(files: Record<string, string>): string {
  return tmpProject("nudo-1098-env-", {
    "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.mjs"] } }),
    "env.mjs": ENV_MJS,
    ...files,
  });
}

/** 函数的 entry/call 返回面（人类可读串）。 */
function fnReturn(result: AnalysisResult, name: string): string {
  const fn = result.functions.find((f) => f.name === name);
  expect(fn).toBeDefined();
  const c = fn!.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"));
  expect(c).toBeDefined();
  return formatAbs(c!.abs);
}

/** CLI `nudo check --json` 的机器面（签名 + issues）。 */
async function cliCheckJson(file: string): Promise<{
  signatures: Array<{ name: string; display: string; abs: string }>;
  issues: Array<{ code?: string; message: string }>;
}> {
  const logs: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  const prevExit = process.exitCode;
  try {
    await runCheck(file, { json: true });
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    process.exitCode = prevExit;
  }
  const jsonText = logs.find((l) => l.trimStart().startsWith("{"));
  expect(jsonText).toBeDefined();
  return JSON.parse(jsonText!);
}

describe("项目级 path env 必须对分析器通道可见（文件带 @nudo:env 时也不丢）", () => {
  beforeEach(() => {
    // 进程级 live 记录是全局的 ⇒ 每例前清干净（否则跨例串台）
    clearPathEnvCaches();
  });

  afterEach(() => {
    clearPathEnvCaches();
    process.exitCode = undefined;
  });

  it("① 文件带 @nudo:env node ⇒ 项目级 env 仍可见（不是 never、无 builtin-unknown 假阳）", async () => {
    const dir = project({ "src/app.js": APP_WITH_FILE_ENV });
    const app = join(dir, "src/app.js");

    const r = await analyzeFileAsync(app, APP_WITH_FILE_ENV);
    const ret = fnReturn(r, "f");
    expect(ret).toContain("42");
    expect(ret).not.toContain("never");
    // 假阳告警：`MAGIC` 是 env 全局 ⇒ 不得报「内建 API 未覆盖」
    expect(r.diagnostics.map((d) => d.code)).not.toContain(DIAG.builtinUnknown);
  });

  it("② 文件不带 @nudo:env ⇒ 行为不回退（仍能解析项目级 env）", async () => {
    const dir = project({ "src/app.js": APP_NO_FILE_ENV });
    const app = join(dir, "src/app.js");

    const r = await analyzeFileAsync(app, APP_NO_FILE_ENV);
    const ret = fnReturn(r, "f");
    expect(ret).toContain("42");
    expect(ret).not.toContain("never");
    expect(r.diagnostics.map((d) => d.code)).not.toContain(DIAG.builtinUnknown);
  });

  it("③ 分析器通道与 CLI `nudo check` 结论一致（都 f() => 42）", async () => {
    const dir = project({ "src/app.js": APP_WITH_FILE_ENV });
    const app = join(dir, "src/app.js");

    const serviceRet = fnReturn(await analyzeFileAsync(app, APP_WITH_FILE_ENV), "f");
    const cli = await cliCheckJson(app);
    const sig = cli.signatures.find((s) => s.name === "f");
    expect(sig).toBeDefined();
    expect(sig!.display).toContain("42");
    expect(sig!.abs).toContain("42");
    // 两面同源：服务通道不得比 CLI 面更弱（env 丢失 ⇒ never/unknown）
    expect(serviceRet).toContain("42");
    expect(serviceRet).not.toContain("never");
    expect(serviceRet).not.toContain("unknown");
  });
});
});

// ---------------------------------------------------------------------------
// env constructor arity gate
// ---------------------------------------------------------------------------
describe("env constructor arity gate", () => {
/**
 * `instantiateReturn` 无视关系元数 / 构造性 ⇒ 无参 `new Event()`
 * 之类被误判。修复：关系 arity 门 + `shape.ctor === true` + 声明可选性。
 *
 * 该 bug 的可见面在 env 注入之后（env 里的构造器），因此按 node / web 两张
 * env 表分别对拍。
 */




const NODE_SRC = `
/// @nudo:env node
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return new MessageEvent(); }
export function e() { return new CloseEvent(); }
`;

const WEB_SRC = `
/// @nudo:env web
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return document.querySelector(); }
`;

function sig(src: string, env: string[], name: string): string {
  const r = checkSource(`/t/bug-162-${env.join("+")}.js`, src, pTrue, {
    inject: { envGlobals: collectEnvGlobals(env) },
  });
  return r.signatures.find((s) => s.name === name)?.display ?? "(missing)";
}

describe("env constructor arity gate", () => {
  const NODE_SRC = `
/// @nudo:env node
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return new MessageEvent(); }
export function e() { return new CloseEvent(); }
`;
  const WEB_SRC = `
/// @nudo:env web
export function a() { return new Event(); }
export function b() { return new CustomEvent(); }
export function c() { return new Request(); }
export function d() { return document.querySelector(); }
`;
  const sig = (src: string, env: string[], name: string): string => {
    const r = checkSource(`/t/b162-${env.join("+")}.js`, src, pTrue, { inject: { envGlobals: collectEnvGlobals(env) } });
    return r.signatures.find((s) => s.name === name)?.display ?? "(missing)";
  };
  it("web 构造器保留品牌；node 非法无参构造 may-throw TypeError", () => {
    for (const [name, expected] of [["a", "Event"], ["b", "CustomEvent"], ["c", "Request"]] as const) {
      expect(sig(WEB_SRC, ["web"], name)).toBe(expected);
    }
    for (const name of ["a", "b", "c", "d", "e"]) expect(sig(NODE_SRC, ["node"], name)).toBe("never throws TypeError");
  });
});
;
});

// ---------------------------------------------------------------------------
// 裸包消费形态透传
// ---------------------------------------------------------------------------
describe("裸包消费形态透传", () => {
/**
 * 回归：裸包的**消费形态**（ESM `import` / CJS `require`）必须透传到
 * `exports` 条件解析——dual package 的 `require` 消费方要拿 `require` 构建。
 *
 * 改前 `importSpecs` 把说明符压成 `string[]`（形态在类型上就消失）⇒ 一律按
 * auto 顺序先试 `import` ⇒ require 消费方被解析到 ESM 构建 ⇒ 与宿主结论相反。
 */






function project(): string {
  return tmpProject("nudo-238-", {
    "node_modules/dualpkg/package.json": JSON.stringify({
      name: "dualpkg",
      version: "1.0.0",
      exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } },
    }),
    "node_modules/dualpkg/esm.mjs": 'export const kind = "esm";\n',
    "node_modules/dualpkg/cjs.cjs": 'exports.kind = "cjs";\n',
  });
}

/** 消费方的 modules 表里裸包入口导出的 `kind`（字符串 Abs 的显示形态）。 */
function kindSeenBy(dir: string, file: string, source: string): string {
  const graph = evalAbsModuleGraph(source, join(dir, file), {});
  const mod = graph.modules["dualpkg"];
  expect(mod).toBeDefined();
  const kind = mod!.named["kind"];
  expect(kind).toBeDefined();
  return formatShape(kind!);
}

beforeEach(() => {
  clearAbsModuleCache();
});

describe("裸包消费形态透传", () => {
  const project = () => tmpProject("nudo-238-", {
    "node_modules/dualpkg/package.json": JSON.stringify({ name: "dualpkg", version: "1.0.0", exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" } } }),
    "node_modules/dualpkg/esm.mjs": 'export const kind = "esm";\n',
    "node_modules/dualpkg/cjs.cjs": 'exports.kind = "cjs";\n',
  });
  const kindSeenBy = (dir: string, file: string, source: string): string => {
    const graph = evalAbsModuleGraph(source, join(dir, file), {});
    const mod = graph.modules["dualpkg"]!;
    expect(mod).toBeDefined();
    const kind = mod.named["kind"]!;
    expect(kind).toBeDefined();
    return formatShape(kind);
  };
  beforeEach(() => { clearAbsModuleCache(); });
  it("require 消费取 require 构建；import 消费取 import 构建", () => {
    const dir = project();
    expect(kindSeenBy(dir, "consumer.cjs", 'const { kind } = require("dualpkg");\nmodule.exports = { kind };\n')).toBe('"cjs"');
    expect(kindSeenBy(dir, "consumer.mjs", 'import { kind } from "dualpkg";\nexport const k = kind;\n')).toBe('"esm"');
  });
});
;
});

// ---------------------------------------------------------------------------
// exports 条件键按声明顺序挑选
// ---------------------------------------------------------------------------
describe("exports 条件键按声明顺序挑选", () => {
/**
 * 回归：`exports` 条件对象必须按 **package.json 的声明顺序**取首个
 * 命中的条件（Node `PACKAGE_TARGET_RESOLVE`），而不是按固定优先级表。
 *
 * 改前按表序（`import` 先于 `default`）⇒ `{ default, import }` 这种声明顺序下
 * 引擎取 `import` 构建、宿主取 `default` 构建 ⇒ 双向判反（假绿 + 假红）。
 */





function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-239-");
  writeTmpFiles(dir, {
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/dual/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "dual") };
}

describe("exports 条件键按声明顺序挑选", () => {
  const makePkg = (exportsField: unknown, files: Record<string, string>) => {
    const dir = tmpProject("nudo-239-");
    writeTmpFiles(dir, {
      "node_modules/dual/package.json": JSON.stringify({ name: "dual", exports: exportsField }),
      ...Object.fromEntries(Object.entries(files).map(([rel, content]) => [`node_modules/dual/${rel}`, content])),
    });
    return { dir, pkgDir: join(dir, "node_modules", "dual") };
  };
  it("default 先声明取 default；import 先声明取 import；require 面同序", () => {
    const a = makePkg({ ".": { default: "./default.js", import: "./esm.mjs" } }, { "default.js": "module.exports = {};\n", "esm.mjs": "export default {};\n" });
    expect(resolveNpmJsEntryDetailed("dual", a.dir, "import").path).toBe(join(a.pkgDir, "default.js"));
    const b = makePkg({ ".": { import: "./esm.mjs", default: "./default.js" } }, { "default.js": "module.exports = {};\n", "esm.mjs": "export default {};\n" });
    expect(resolveNpmJsEntryDetailed("dual", b.dir, "import").path).toBe(join(b.pkgDir, "esm.mjs"));
    const c = makePkg({ ".": { default: "./default.js", require: "./cjs.cjs" } }, { "default.js": "module.exports = {};\n", "cjs.cjs": "module.exports = {};\n" });
    expect(resolveNpmJsEntryDetailed("dual", c.dir, "require").path).toBe(join(c.pkgDir, "default.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// 裸包依赖进依赖图（脏传播不缺边）
// ---------------------------------------------------------------------------
describe("裸包依赖进依赖图（脏传播不缺边）", () => {
/**
 * 回归：依赖图里**裸包说明符也必须成边**。
 *
 * 改前 `extractImportEdges` 直接丢弃裸包说明符 ⇒ `dependents` 缺边 ⇒
 * `computeDirtySet` 拿不到裸包消费者的路径 ⇒ watch / LSP 增量轮整轮跳过
 * （消费者永不重算）。相对依赖与裸包依赖在宿主侧取到同一实现，脏传播口径
 * 必须等价。
 */





function project(): { dir: string; consumer: string; pkgEntry: string } {
  const dir = tmpProject("nudo-240-", {
    "node_modules/barepkg/package.json": JSON.stringify({
      name: "barepkg",
      version: "1.0.0",
      main: "./index.js",
    }),
    "node_modules/barepkg/index.js": 'exports.v = "world";\n',
    "consumer.js": 'const { v } = require("barepkg");\nmodule.exports = { v };\n',
    "rel-consumer.js": 'const { v } = require("./local.js");\nmodule.exports = { v };\n',
    "local.js": 'exports.v = "world";\n',
  });
  return {
    dir,
    consumer: join(dir, "consumer.js"),
    pkgEntry: join(dir, "node_modules", "barepkg", "index.js"),
  };
}

describe("裸包依赖进依赖图（脏传播不缺边）", () => {
  const project = () => {
    const dir = tmpProject("nudo-240-", {
      "node_modules/barepkg/package.json": JSON.stringify({ name: "barepkg", version: "1.0.0", main: "./index.js" }),
      "node_modules/barepkg/index.js": 'exports.v = "world";\n',
      "consumer.js": 'const { v } = require("barepkg");\nmodule.exports = { v };\n',
      "rel-consumer.js": 'const { v } = require("./local.js");\nmodule.exports = { v };\n',
      "local.js": 'exports.v = "world";\n',
    });
    return { dir, consumer: join(dir, "consumer.js"), pkgEntry: join(dir, "node_modules", "barepkg", "index.js") };
  };
  it("裸包入口变更消费者进脏集；相对依赖同口径；解析不到不进边", () => {
    const { dir, consumer, pkgEntry } = project();
    const graph = buildModuleGraph([consumer]);
    expect(graph.dependents.get(pkgEntry)?.has(consumer)).toBe(true);
    expect(computeDirtySet(graph.dependents, pkgEntry)).toContain(consumer);
    const relConsumer = join(dir, "rel-consumer.js");
    const both = buildModuleGraph([consumer, relConsumer]);
    expect(both.dependents.get(pkgEntry)?.has(consumer)).toBe(true);
    expect(both.dependents.get(join(dir, "local.js"))?.has(relConsumer)).toBe(true);
    const missDir = tmpProject("nudo-240-miss-", { "consumer.js": 'require("not-installed-anywhere");\n' });
    const miss = buildModuleGraph([join(missDir, "consumer.js")]);
    expect(miss.imports.get(join(missDir, "consumer.js"))?.size ?? 0).toBe(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// 缓存键路径维含项目身份
// ---------------------------------------------------------------------------
describe("缓存键路径维含项目身份", () => {
/**
 * 回归：`check` 磁盘缓存键的路径维必须带**项目身份**。
 *
 * 改前树内文件只取相对项目根的路径 ⇒ 共享 `NUDO_CACHE_DIR` 下两个 checkout
 * 的 `src/a.js` 得到同一个键 ⇒ 互相污染（命中另一份 checkout 的报告，
 * `file` 字段指向那边的文件；`--gitlab` 的 location.path / fingerprint 同样错位）。
 */



const SOURCE = "export function f(a) { return a + 1; }\n";

describe("缓存键路径维含项目身份", () => {
  const SOURCE = "export function f(a) { return a + 1; }\n";
  it("不同项目根不同键（check/contract）；同根同键；键无明文路径", () => {
    const a = checkCacheKey("/checkout1/src/a.js", SOURCE, { autoBind: false, projectDir: "/checkout1" });
    const b = checkCacheKey("/checkout2/src/a.js", SOURCE, { autoBind: false, projectDir: "/checkout2" });
    expect(a).not.toBe(b);
    const ca = contractCacheKey("/checkout1/src/a.js", SOURCE, { autoBind: false, projectDir: "/checkout1" });
    const cb = contractCacheKey("/checkout2/src/a.js", SOURCE, { autoBind: false, projectDir: "/checkout2" });
    expect(ca).not.toBe(cb);
    expect(checkCacheKey("/checkout1/src/a.js", SOURCE, { autoBind: false, projectDir: "/checkout1" })).toBe(a);
    expect(a).not.toContain("checkout1");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
;
});

// ---------------------------------------------------------------------------
// exports 模式键 tie-break（PATTERN_KEY_COMPARE）
// ---------------------------------------------------------------------------
describe("exports 模式键 tie-break（PATTERN_KEY_COMPARE）", () => {
/**
 * 回归：`exports` 模式键的 tie-break 必须按 Node `PATTERN_KEY_COMPARE`
 * ——**前缀长度平手时比整键长度**（更长者胜），且结论不得随 package.json 里的
 * 声明顺序变化。
 *
 * 改前只比前缀长度且用严格大于 ⇒ 平手保留先声明者，宿主却取更长的键
 * ⇒ 引擎解析到另一个文件（假红 / 假绿 + 自信的错值）。
 */





function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-267-");
  writeTmpFiles(dir, {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      type: "module",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/pkg/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "pkg") };
}

describe("exports 模式键 tie-break（PATTERN_KEY_COMPARE）", () => {
  const makePkg = (exportsField: unknown, files: Record<string, string>) => {
    const dir = tmpProject("nudo-267-");
    writeTmpFiles(dir, {
      "node_modules/pkg/package.json": JSON.stringify({ name: "pkg", type: "module", exports: exportsField }),
      ...Object.fromEntries(Object.entries(files).map(([rel, content]) => [`node_modules/pkg/${rel}`, content])),
    });
    return { dir, pkgDir: join(dir, "node_modules", "pkg") };
  };
  it("前缀平手取整键更长；前缀更长优先；#imports 同口径", () => {
    const longFirst = makePkg({ "./x/*b": "./special/*.js", "./x/*": "./dist/*.js" }, { "special/a.js": "export const v = 1;", "dist/ab.js": "export const v = 2;" });
    const shortFirst = makePkg({ "./x/*": "./dist/*.js", "./x/*b": "./special/*.js" }, { "special/a.js": "export const v = 1;", "dist/ab.js": "export const v = 2;" });
    expect(resolveNpmJsEntry("pkg/x/ab", longFirst.dir)).toBe(join(longFirst.pkgDir, "special", "a.js"));
    expect(resolveNpmJsEntry("pkg/x/ab", shortFirst.dir)).toBe(join(shortFirst.pkgDir, "special", "a.js"));
    const prefix = makePkg({ "./x/*bcd": "./short/*.js", "./x/y/*": "./deep/*.js" }, { "short/a.js": "export const v = 1;", "deep/abcd.js": "export const v = 2;" });
    expect(resolveNpmJsEntry("pkg/x/y/abcd", prefix.dir)).toBe(join(prefix.pkgDir, "deep", "abcd.js"));
    const dir = tmpProject("nudo-267-imports-");
    writeTmpFiles(dir, { "package.json": JSON.stringify({ name: "app", type: "module", imports: { "#x/*b": "./special/*.js", "#x/*": "./dist/*.js" } }), "special/a.js": "export const v = 1;", "dist/ab.js": "export const v = 2;" });
    expect(resolveNpmJsEntry("#x/ab", dir)).toBe(join(dir, "special", "a.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// 最近的包 exports 拒绝 ⇒ 不得上溯到同名副本
// ---------------------------------------------------------------------------
describe("最近的包 exports 拒绝 ⇒ 不得上溯到同名副本", () => {
/**
 * 回归：包目录遍历必须区分「本层**没有**该包」（可继续向上）与
 * 「本层**有**该包但 `exports` 不认这个子路径」（Node 直接
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`，**不得**继续向上找同名副本）。
 *
 * 改前继续向上 ⇒ 解析到运行时永不加载的父级副本 ⇒ 门禁假绿，且
 * `exportsUnresolved` 被清零 ⇒ `nudo:exports-unresolved` 诊断被吞。
 */






function nested(nearExports: Record<string, string>, parentHasSub: boolean): string {
  const dir = tmpProject("nudo-268-");
  const parentExports: Record<string, string> = { ".": "./index.js" };
  if (parentHasSub) parentExports["./sub"] = "./sub.js";
  writeTmpFiles(dir, {
    "app/node_modules/nearpkg/package.json": JSON.stringify({
      name: "nearpkg",
      type: "module",
      exports: nearExports,
    }),
    "app/node_modules/nearpkg/index.js": "export const v = 'NEAR';\n",
    "node_modules/nearpkg/package.json": JSON.stringify({
      name: "nearpkg",
      type: "module",
      exports: parentExports,
    }),
    "node_modules/nearpkg/index.js": "export const v = 'PARENT';\n",
    "node_modules/nearpkg/sub.js": "export const v = 'PARENT';\n",
    "app/probe.mjs": "import v from 'nearpkg/sub';\nexport function use() { return v; }\n",
  });
  return dir;
}

describe("最近的包 exports 拒绝 ⇒ 不得上溯到同名副本", () => {
  const nested = (nearExports: Record<string, string>, parentHasSub: boolean): string => {
    const dir = tmpProject("nudo-268-");
    const parentExports: Record<string, string> = { ".": "./index.js" };
    if (parentHasSub) parentExports["./sub"] = "./sub.js";
    writeTmpFiles(dir, {
      "app/node_modules/nearpkg/package.json": JSON.stringify({ name: "nearpkg", type: "module", exports: nearExports }),
      "app/node_modules/nearpkg/index.js": "export const v = 'NEAR';\n",
      "node_modules/nearpkg/package.json": JSON.stringify({ name: "nearpkg", type: "module", exports: parentExports }),
      "node_modules/nearpkg/index.js": "export const v = 'PARENT';\n",
      "node_modules/nearpkg/sub.js": "export const v = 'PARENT';\n",
      "app/probe.mjs": "import v from 'nearpkg/sub';\nexport function use() { return v; }\n",
    });
    return dir;
  };
  it("近层拒绝不上溯；本层无包可上溯；近层命中胜出", () => {
    const dir = nested({ ".": "./index.js" }, true);
    const r = resolveNpmJsEntryDetailed("nearpkg/sub", join(dir, "app"));
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
    rmSync(join(dir, "app", "node_modules", "nearpkg"), { recursive: true, force: true });
    const up = resolveNpmJsEntryDetailed("nearpkg/sub", join(dir, "app"));
    expect(up.path).toBe(join(dir, "node_modules", "nearpkg", "sub.js"));
    expect(up.exportsUnresolved).toBe(false);
    const near = nested({ ".": "./index.js", "./sub": "./index.js" }, true);
    expect(resolveNpmJsEntryDetailed("nearpkg/sub", join(near, "app")).path).toBe(join(near, "app", "node_modules", "nearpkg", "index.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// exports 目标数组：只有非法目标才回退
// ---------------------------------------------------------------------------
describe("exports 目标数组：只有非法目标才回退", () => {
/**
 * 回归：`exports` **目标数组**的回退判据只能是「目标**非法**」
 * （Node `ERR_INVALID_PACKAGE_TARGET`），**不得**用「文件是否存在」。
 *
 * Node 语义：目标合法但文件缺失时解析就停在这个目标上，随后装载阶段抛
 * `ERR_MODULE_NOT_FOUND`；旧实现跳过缺失目标、取下一个存在的文件
 * ⇒ 解析到与宿主不同的文件 ⇒ 门禁假绿 + 自信的错值。
 */





function makePkg(exportsField: unknown, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-270-");
  writeTmpFiles(dir, {
    "node_modules/vp/package.json": JSON.stringify({
      name: "vp",
      type: "module",
      exports: exportsField,
    }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content]),
    ),
    "probe.mjs": "import v from 'vp/sub';\nexport function use() { return v; }\n",
  });
  return { dir, pkgDir: join(dir, "node_modules", "vp") };
}

describe("exports 目标数组：只有非法目标才回退", () => {
  const makePkg = (exportsField: unknown, files: Record<string, string>) => {
    const dir = tmpProject("nudo-270-");
    writeTmpFiles(dir, {
      "node_modules/vp/package.json": JSON.stringify({ name: "vp", type: "module", exports: exportsField }),
      ...Object.fromEntries(Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content])),
      "probe.mjs": "import v from 'vp/sub';\nexport function use() { return v; }\n",
    });
    return { dir, pkgDir: join(dir, "node_modules", "vp") };
  };
  it("合法但缺失即停；条件内数组同款；非法目标回退；首目标存在取首", () => {
    const miss = makePkg({ "./sub": ["./missing.js", "./real.js"] }, { "real.js": "export const v = 'ARRAY_REAL';\nexport default v;\n" });
    const r = resolveNpmJsEntryDetailed("vp/sub", miss.dir);
    expect(r.path).toBeNull();
    expect(r.exportsUnresolved).toBe(true);
    const nested = makePkg({ "./sub": { import: ["./missing.js", "./real.js"], default: "./real.js" } }, { "real.js": "export const v = 'REAL';\nexport default v;\n" });
    expect(resolveNpmJsEntryDetailed("vp/sub", nested.dir).path).toBeNull();
    const illegal = makePkg({ "./sub": ["../outside.js", "./real.js"] }, { "real.js": "export const v = 'ARRAY_REAL';\nexport default v;\n" });
    const ir = resolveNpmJsEntryDetailed("vp/sub", illegal.dir);
    expect(ir.path).toBe(join(illegal.pkgDir, "real.js"));
    expect(ir.exportsUnresolved).toBe(false);
    const hit = makePkg({ "./sub": ["./a.js", "./b.js"] }, { "a.js": "export const v = 'A';\n", "b.js": "export const v = 'B';\n" });
    expect(resolveNpmJsEntryDetailed("vp/sub", hit.dir).path).toBe(join(hit.pkgDir, "a.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// ESM 下禁止目录导入（不补 index 候选）
// ---------------------------------------------------------------------------
describe("ESM 下禁止目录导入（不补 index 候选）", () => {
/**
 * 回归：包内文件候选**不能**无条件补 `index.*`。
 *
 * Node 的 **ESM** 装载器从不做目录 / index 解析 ⇒ `exports` 目标或旧式子路径
 * 指向目录时宿主抛 `ERR_UNSUPPORTED_DIR_IMPORT`（模块根本加载不上）；
 * 只有 **legacy `main`** 语境允许 index 解析。
 *
 * 改前一律补 index 候选 ⇒ 引擎解析到 `dir/index.js` ⇒ 门禁假绿 + 自信的错值。
 */





function makePkg(pkgJson: Record<string, unknown>, files: Record<string, string>): {
  dir: string;
  pkgDir: string;
} {
  const dir = tmpProject("nudo-273-");
  writeTmpFiles(dir, {
    "node_modules/vp/package.json": JSON.stringify({ name: "vp", type: "module", ...pkgJson }),
    ...Object.fromEntries(
      Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content]),
    ),
  });
  return { dir, pkgDir: join(dir, "node_modules", "vp") };
}

describe("ESM 下禁止目录导入（不补 index 候选）", () => {
  const makePkg = (pkgJson: Record<string, unknown>, files: Record<string, string>) => {
    const dir = tmpProject("nudo-273-");
    writeTmpFiles(dir, {
      "node_modules/vp/package.json": JSON.stringify({ name: "vp", type: "module", ...pkgJson }),
      ...Object.fromEntries(Object.entries(files).map(([rel, content]) => [`node_modules/vp/${rel}`, content])),
    });
    return { dir, pkgDir: join(dir, "node_modules", "vp") };
  };
  it("exports/旧式子路径指向目录不可用；显式文件与 legacy main 可解析", () => {
    const exp = makePkg({ exports: { ".": "./dir" } }, { "dir/index.js": "export const v = 'DIRIDX';\n" });
    const er = resolveNpmJsEntryDetailed("vp", exp.dir);
    expect(er.path).toBeNull();
    expect(er.exportsUnresolved).toBe(true);
    const sub = makePkg({ main: "./index.js" }, { "index.js": "export const v = 1;\n", "dir/index.js": "export const v = 'DIRIDX';\n" });
    expect(resolveNpmJsEntryDetailed("vp/dir", sub.dir).path).toBeNull();
    const file = makePkg({ exports: { ".": "./dir/index.js" } }, { "dir/index.js": "export const v = 'DIRIDX';\n" });
    expect(resolveNpmJsEntryDetailed("vp", file.dir).path).toBe(join(file.pkgDir, "dir", "index.js"));
    const legacy = makePkg({ main: "./dir" }, { "dir/index.js": "export const v = 'DIRIDX';\n" });
    expect(resolveNpmJsEntryDetailed("vp", legacy.dir).path).toBe(join(legacy.pkgDir, "dir", "index.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// ESM import 环：环内调用恒定值
// ---------------------------------------------------------------------------
describe("ESM import 环：环内调用恒定值", () => {
/**
 * ESM import 环（a ⇄ b）——环内第一次调用恒定值、同一导出按调用次序不再漂移。
 *
 * 原生 oracle（node ESM）：probe(2) → 0（a(2) → b(1) → a(0) → 0），连续三次都是 0。
 * 改前：环内先求值的一侧（b）绑定到 unknown（a 尚未求值）⇒ 第一次调用得 unknown，
 * 第二次起才正确（同一导出按调用次序给出不同结果）。
 */






const A = `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`;
const B = `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`;
const ENTRY = `import { a } from "./a.js";
export function probe() { return a(2); }
`;

function tmpProject(files: Record<string, string>): string {
  return makeTmpProject("nudo-b456-", files);
}

/** 入口导出连调三次的返回值（原生 oracle：0 / 0 / 0） */
function callProbeThrice(dir: string): Abs[] {
  const file = join(dir, "index.js");
  const graph = evalAbsModuleGraph(ENTRY, file);
  const run = runTranspiled(ENTRY, { mode: "analyze", modules: graph.modules as never });
  return [0, 1, 2].map(() => callTranspiledExportFull(run, "probe", []).result);
}

describe("ESM import 环：环内调用恒定值", () => {
  const A = `import { b } from "./b.js";
export function a(n) { return n <= 0 ? 0 : b(n - 1); }
`;
  const B = `import { a } from "./a.js";
export function b(n) { return n <= 0 ? 1 : a(n - 1); }
`;
  const ENTRY = `import { a } from "./a.js";
export function probe() { return a(2); }
`;
  const tmpProject = (files: Record<string, string>) => makeTmpProject("nudo-b456-", files);
  const callProbeThrice = (dir: string): Abs[] => {
    const file = join(dir, "index.js");
    const graph = evalAbsModuleGraph(ENTRY, file);
    const run = runTranspiled(ENTRY, { mode: "analyze", modules: graph.modules as never });
    return [0, 1, 2].map(() => callTranspiledExportFull(run, "probe", []).result);
  };
  it("首次即 0、三次不漂移、环仍报告；非环与显式实参负控", () => {
    const dir = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    clearAbsModuleCache();
    const results = callProbeThrice(dir);
    for (const r of results) {
      expect(r.shape.k).not.toBe("unknown");
      expect(r.term).toEqual({ op: "lit", value: 0 });
    }
    const graph = evalAbsModuleGraph(ENTRY, join(dir, "index.js"));
    expect(graph.issues.some((i) => i.kind === "cycle")).toBe(true);

    const plain = tmpProject({ "math.js": "export function double(x) { return x * 2; }\n", "index.js": 'import { double } from "./math.js";\nexport function probe() { return double(21); }\n' });
    clearAbsModuleCache();
    const plainSrc = 'import { double } from "./math.js";\nexport function probe() { return double(21); }\n';
    const plainFile = join(plain, "index.js");
    const plainGraph = evalAbsModuleGraph(plainSrc, plainFile);
    const plainRun = runTranspiled(plainSrc, { mode: "analyze", modules: plainGraph.modules as never });
    expect(callTranspiledExportFull(plainRun, "probe", []).result.term).toEqual({ op: "lit", value: 42 });

    clearAbsModuleCache();
    const dir2 = tmpProject({ "a.js": A, "b.js": B, "index.js": ENTRY });
    const g2 = evalAbsModuleGraph(ENTRY, join(dir2, "index.js"));
    const r2 = runTranspiled(ENTRY, { mode: "analyze", modules: g2.modules as never });
    expect(callTranspiledExportFull(r2, "probe", [numLit(2)]).result.term).toEqual({ op: "lit", value: 0 });
  });
});
;
});

// ---------------------------------------------------------------------------
// JSON 依赖装载
// ---------------------------------------------------------------------------
describe("JSON 依赖装载", () => {
/**
 * JSON 依赖（`.json`）——此前一律当 JS 转译（`{"a": 1}` 不是合法 JS
 * 表达式语句）→ fail-closed 空导出表且**零诊断** ⇒ 值被静默丢弃。
 *
 * 原生 oracle（node）：
 * - `require("./data.json").a` → 1；
 * - `import d from "./data.json"`（带 import attribute）→ d.a → 1；
 * - `import { a } from "./data.json"` → 原生报错（JSON 模块没有具名导出）。
 */






const DATA = `{"a": 1, "b": "x"}\n`;

function callGetA(dir: string, src: string): { value: unknown; issues: string[] } {
  const file = join(dir, "main.js");
  clearAbsModuleCache();
  const graph = evalAbsModuleGraph(src, file);
  const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
  const r = callTranspiledExportFull(run, "getA", []);
  return { value: r.result.term, issues: graph.issues.map((i) => `${i.kind}: ${i.label}`) };
}

describe("JSON 依赖装载", () => {
  const DATA = `{"a": 1, "b": "x"}\n`;
  const callGetA = (dir: string, src: string) => {
    const file = join(dir, "main.js");
    clearAbsModuleCache();
    const graph = evalAbsModuleGraph(src, file);
    const run = runTranspiled(src, { mode: "analyze", modules: graph.modules as never });
    const r = callTranspiledExportFull(run, "getA", []);
    return { value: r.result.term, issues: graph.issues.map((i) => `${i.kind}: ${i.label}`) };
  };
  it("require/default import 取值；具名导入缺名；非法 JSON 专用诊断；JS 依赖负控", () => {
    const dir = makeTmpProject("nudo-b457-", { "data.json": DATA });
    expect(callGetA(dir, 'const d = require("./data.json");\nexport function getA() { return d.a; }\n').value).toEqual({ op: "lit", value: 1 });
    expect(callGetA(dir, 'import d from "./data.json";\nexport function getA() { return d.a; }\n').value).toEqual({ op: "lit", value: 1 });
    const named = callGetA(dir, 'import { a } from "./data.json";\nexport function getA() { return a; }\n');
    expect(named.issues.some((i) => i.startsWith("missing-export"))).toBe(true);

    const badDir = makeTmpProject("nudo-b457-bad-", { "data.json": "{ not json" });
    const bad = callGetA(badDir, 'const d = require("./data.json");\nexport function getA() { return d.a; }\n');
    expect(bad.issues.some((i) => i.startsWith("json-invalid"))).toBe(true);
    expect(bad.issues.some((i) => i.startsWith("missing"))).toBe(false);

    const jsDir = makeTmpProject("nudo-b457-js-", { "mod.js": "export const a = 7;\n" });
    const js = callGetA(jsDir, 'import { a } from "./mod.js";\nexport function getA() { return a; }\n');
    expect(js.value).toEqual({ op: "lit", value: 7 });
    expect(js.issues).toEqual([]);
  });
});
;
});

// ---------------------------------------------------------------------------
// @nudo:pure marker lands on the call-site function value
// ---------------------------------------------------------------------------
describe("@nudo:pure marker lands on the call-site function value", () => {
/**
 * @nudo:pure 的纯度标记必须落在**调用点真正解析到的那个函数值**上。
 *
 * memo 以**对象身份**为键（pureCallMemo / pureMemo：WeakMap<fnObj, argsKey, …>），
 * 标记到"等价但不同一"的对象上不命中。修复前 service 从 globalEnv 取标记对象，
 * 而 globalEnv 从未绑定任何函数（collectBindings 只写 bindings 表）⇒ 标记从未
 * 落下，@nudo:pure 恒为空转（纯函数指令无任何求值语义）。
 *
 * 本测试锁住：
 * ① 纯函数（无副作用）：加不加指令结果一致（文档承诺："analysis results
 * stay correct with or without the directive"）
 * ② 纯度标记落在**分析实例的函数值**上（宿主 JS 函数对象 / Abs fn 值两种形态）
 *
 * 注：端到端的「同实参二次调用命中缓存」还要求**调用面用的实例**也带标记——
 * 调用面当前按用例新建独立模块实例（的 fresh 设计），落点在
 * eval-run 的调用面 / core 转译面（见本轮报告的越界项）。本测试锁住
 * service 侧可独立保证的那一段（标记确实落下）。
 */





/** 纯函数：指令不应改变结果 */
const PURE_FN = `/**
 * @nudo:pure
 */
export function double(n) { return n * 2; }
export function useDouble() { return double(21) + double(21); }
`;
const PURE_FN_NO_DIRECTIVE = PURE_FN.replace("@nudo:pure", "");

/** 顶层函数声明（转译面提升为 export → 宿主 JS 函数对象） */
const DECL_FN = `let k = 0;
/**
 * @nudo:pure
 */
function next() { k = k + 1; return k; }
export function use() { const a = next(); const b = next(); return a + b; }
`;

/** const 函数表达式（recordBinding 记录 → Abs fn 值） */
const ARROW_FN = `let k = 0;
/**
 * @nudo:pure
 */
const next = () => { k = k + 1; return k; };
export function use() { const a = next(); const b = next(); return a + b; }
`;

describe("@nudo:pure marker lands on the call-site function value", () => {
  const PURE_FN = `/**
 * @nudo:pure
 */
export function double(n) { return n * 2; }
export function useDouble() { return double(21) + double(21); }
`;
  const PURE_FN_NO_DIRECTIVE = PURE_FN.replace("@nudo:pure", "");
  const DECL_FN = `let k = 0;
/**
 * @nudo:pure
 */
function next() { k = k + 1; return k; }
export function use() { const a = next(); const b = next(); return a + b; }
`;
  const ARROW_FN = `let k = 0;
/**
 * @nudo:pure
 */
const next = () => { k = k + 1; return k; };
export function use() { const a = next(); const b = next(); return a + b; }
`;
  it("指令不改变结果；标记落分析实例；调用面命中 memo", () => {
    const pick = (r: ReturnType<typeof analyzeFile>) => {
      const fn = r.functions.find((f) => f.name === "useDouble");
      const c = fn?.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"));
      return c ? formatAbs(c.abs) : "<none>";
    };
    const withDir = pick(analyzeFile("/t/b462/pure-with.js", PURE_FN));
    const without = pick(analyzeFile("/t/b462/pure-without.js", PURE_FN_NO_DIRECTIVE));
    expect(withDir).toBe(without);
    expect(withDir).toContain("84");

    const declPath = "/t/b462/marker-decl.js";
    analyzeFile(declPath, DECL_FN);
    const run = tryRunEval(DECL_FN, declPath, { envNames: [], mocks: {} })!;
    expect(run).toBeDefined();
    const fnVal = run.exports["next"];
    expect(typeof fnVal).toBe("function");
    expect((fnVal as { _memoize?: string })._memoize).toBe("next");

    const arrowPath = "/t/b462/marker-arrow.js";
    analyzeFile(arrowPath, ARROW_FN);
    const arrowRun = tryRunEval(ARROW_FN, arrowPath, { envNames: [], mocks: {} })!;
    expect(arrowRun).toBeDefined();
    const absVal = bindingsOf(arrowRun.exports)?.get("next");
    expect(absVal).toBeDefined();
    expect(pureFnNameOf(absVal)).toBe("next");

    const full = tryEvalCallFull(DECL_FN, "/t/b462/fresh-memo.js", "use", [], { envNames: [], mocks: {} });
    expect(full).toBeDefined();
    expect(formatAbs(full!.result)).toMatch(/^2(\s|$)/);
    const noDirective = DECL_FN.replace("@nudo:pure", "");
    const full2 = tryEvalCallFull(noDirective, "/t/b462/fresh-memo.js", "use", [], { envNames: [], mocks: {} });
    expect(full2).toBeDefined();
    expect(formatAbs(full2!.result)).toMatch(/^3(\s|$)/);
  });
});
;
});

// ---------------------------------------------------------------------------
// nudo 键形状非法必须可观测且不得谎报成配置
// ---------------------------------------------------------------------------
describe("nudo 键形状非法必须可观测且不得谎报成配置", () => {
/**
 * `package.json#nudo` 键**值不是对象**时被静默忽略：
 * 零诊断（用户零线索），且真值型非对象还**抑制 onboarding 提示**
 * （下游 check.ts 的 filesWithConfig++ 以「找到了真值 nudo 键」为判据）。
 *
 * 根因（config.ts findProjectConfig）：配置层对 `nudo` 键**零形状校验**，
 * 非对象值被谎报成 NudoConfig。
 *
 * 修法：形状校验（非数组对象才合法）；非法形状 → 一条 stderr 诊断 +
 * 按「无配置」处理（不继承祖先配置；onboarding 不再被抑制）。
 */






function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

/** 根包带 nudo 配置（用于验证「非法 nudo 键不得继承祖先配置」） */
function rootWithConfig(): string {
  const root = tmpProject("nudo-bug468-root-", {
    "package.json": JSON.stringify({
      name: "root",
      nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] },
    }),
  });
  return root;
}

describe("nudo 键形状非法必须可观测且不得谎报成配置", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  const rootWithConfig = () => tmpProject("nudo-b468-root-", { "package.json": JSON.stringify({ name: "root", nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] } }) });
  const subWith = (root: string, nudo: unknown) => {
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify(nudo === undefined ? { name: "sub" } : { name: "sub", nudo }));
    return sub;
  };
  beforeEach(() => { evictProjectConfigMemo(); });
  it("非对象诊断且无配置；空对象遮断；合法对象/无键负控", () => {
    for (const [label, raw] of [["string", "adoption"], ["bool", true], ["array", []]] as const) {
      const root = rootWithConfig();
      const sub = subWith(root, raw);
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      const out = captureStderr(() => { found = findProjectConfig(sub); });
      expect(found, label).toBeNull();
      expect(out, label).toContain('invalid "nudo" key');
      expect(out, label).toContain(join(sub, "package.json"));
      expect(out, label).toContain("no nudo config");
    }
    {
      const root = rootWithConfig();
      const sub = subWith(root, "adoption");
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      captureStderr(() => { found = findProjectConfig(sub); });
      expect(found).toBeNull();
      expect(found?.config).toBeUndefined();
    }
    {
      const root = tmpProject("nudo-b468-ok-", { "package.json": JSON.stringify({ name: "m", nudo: { contract: { autoBind: false } } }) });
      const found = findProjectConfig(root);
      expect(found?.projectDir).toBe(root);
      expect(found?.config.contract?.autoBind).toBe(false);
    }
    {
      const root = rootWithConfig();
      const sub = subWith(root, {});
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      const out = captureStderr(() => { found = findProjectConfig(sub); });
      expect(found?.projectDir).toBe(sub);
      expect(found?.config).toEqual({});
      expect(out).toBe("");
    }
    {
      const root = rootWithConfig();
      const sub = subWith(root, undefined);
      const found = findProjectConfig(sub);
      expect(found?.projectDir).toBe(root);
      expect(found?.config.check?.ignoreThrows).toEqual(["SyntaxError"]);
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 未知名 env 不得静默忽略
// ---------------------------------------------------------------------------
describe("未知名 env 不得静默忽略", () => {
/**
 * `@nudo:env <未知名>`（bogus / nodejs / Node）被静默忽略：
 * 零诊断、env 不生效、分析退化。
 *
 * 契约：未知名 env 必须产出一条**可见**诊断（nudo:env-unresolved 通道，
 * CLI check/test 与 LSP 同源消费），不得静默 `continue`；
 * 合法内建名（es / web / node）不受影响（负控制）。
 */





beforeEach(() => {
  clearPathEnvCaches();
});

describe("未知名 env 不得静默忽略", () => {
  beforeEach(() => { clearPathEnvCaches(); });
  it("未知名/原型键可见诊断；合法内建名与依赖展开零诊断", async () => {
    for (const name of ["bogus", "nodejs", "Node"]) {
      const dir = tmpProject("nudo-b470-");
      const loaded = loadEnvs([name], createEnvironment(), dir);
      expect(Object.keys(loaded.globals)).toHaveLength(0);
      const errs = getPathEnvLoadErrors(dir);
      expect(errs).toHaveLength(1);
      expect(errs[0]!.error).toContain(`unknown env name "${name}"`);
      expect(errs[0]!.error).toContain("es, web, node");
    }
    const pre = tmpProject("nudo-b470-preload-");
    await preloadPathEnvs(["bogus"], pre);
    const preErrs = getPathEnvLoadErrors(pre);
    expect(preErrs).toHaveLength(1);
    expect(preErrs[0]!.error).toContain('unknown env name "bogus"');
    expect(preErrs[0]!.baseDir).toBe(pre);
    const proto = tmpProject("nudo-b470-proto-");
    const protoLoaded = loadEnvs(["constructor"], createEnvironment(), proto);
    expect(Object.keys(protoLoaded.globals)).toHaveLength(0);
    expect(getPathEnvLoadErrors(proto)[0]!.error).toContain('unknown env name "constructor"');

    const ok = tmpProject("nudo-b470-ok-");
    expect(Object.keys(loadEnvs(["node"], createEnvironment(), ok).globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(ok)).toHaveLength(0);
    expect(Object.keys(loadEnvs(["es"], createEnvironment(), ok).globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(ok)).toHaveLength(0);
    expect(Object.keys(loadEnvs(["web"], createEnvironment(), ok).globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(ok)).toHaveLength(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// 显式 nudo.cache 值一律压过 NUDO_CACHE_DIR
// ---------------------------------------------------------------------------
describe("显式 nudo.cache 值一律压过 NUDO_CACHE_DIR", () => {
/**
 * `nudo.cache: ""`（**显式**空串）不压过 `NUDO_CACHE_DIR`
 * → 缓存目录仍被创建 → 违反 config.md 明文优先级
 * 「any explicit `nudo.cache` value (including `false`) wins over
 * `NUDO_CACHE_DIR`; the env var is only consulted when `nudo.cache` is unset」。
 *
 * 根因（config.ts diskCacheRoot）：用「**值的形状**」而不是「**键是否被设置**」
 * 判断优先级 —— `false` 有专门早退分支，`""` 没有 ⇒ 空串被当作「未设置」。
 *
 * 修法：先判键是否存在（`cache !== undefined`），再按值分派。
 */



const ENV_KEY = "NUDO_CACHE_DIR";
let saved: string | undefined;

afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

function withEnv(value: string | undefined, fn: () => void): void {
  saved = process.env[ENV_KEY];
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
  fn();
}

describe("显式 nudo.cache 值一律压过 NUDO_CACHE_DIR", () => {
  const ENV_KEY = "NUDO_CACHE_DIR";
  let saved: string | undefined;
  afterEach(() => { if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved; });
  const withEnv = (value: string | undefined, fn: () => void) => { saved = process.env[ENV_KEY]; if (value === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = value; fn(); };
  it("显式 \"\"/false/true/相对路径压过 env；未设才读 env；off/0 关闭", () => {
    let root: string | undefined;
    withEnv("/tmp/nudo-cache-env", () => { root = diskCacheRoot({ cache: "" }, "/proj"); });
    expect(root).toBeUndefined();
    withEnv("/tmp/nudo-cache-env", () => { root = diskCacheRoot({ cache: false }, "/proj"); });
    expect(root).toBeUndefined();
    withEnv("/tmp/nudo-cache-env", () => { root = diskCacheRoot({ cache: true }, "/proj"); });
    expect(root).toBe("/proj/.nudo/cache");
    withEnv("/tmp/nudo-cache-env", () => { root = diskCacheRoot({ cache: "custom/dir" }, "/proj"); });
    expect(root).toBe("/proj/custom/dir");
    withEnv("/tmp/nudo-cache-env", () => { root = diskCacheRoot({}, "/proj"); });
    expect(root).toBe("/tmp/nudo-cache-env");
    withEnv(undefined, () => { root = diskCacheRoot(undefined, "/proj"); });
    expect(root).toBeUndefined();
    withEnv("off", () => { root = diskCacheRoot({}, "/proj"); });
    expect(root).toBeUndefined();
    withEnv("0", () => { root = diskCacheRoot({}, "/proj"); });
    expect(root).toBeUndefined();
  });
});
;
});

// ---------------------------------------------------------------------------
// exports 条件键按消费形态分表
// ---------------------------------------------------------------------------
describe("exports 条件键按消费形态分表", () => {
/**
 * 回归：裸包 `exports` 的**条件键必须按消费形态选**
 * （ESM `import` → "import" 条件；CJS `require` → "require" 条件）。
 *
 * 改前：一张固定顺序的表把 "require" 排在 "import" 前 ⇒ ESM import 解析到
 * 包的 CommonJS 构建（原生 5 / 引擎 {default:10,named:"cjs"}）。
 */





/** dual package：同一包发 .mjs（ESM 面）与 .cjs（CJS 面）两套构建。 */
function dualPkg(prefix: string): { dir: string; pkgDir: string } {
  const dir = tmpProject(prefix);
  writeTmpFiles(dir, {
    "node_modules/dual/package.json": JSON.stringify({
      name: "dual",
      version: "1.0.0",
      exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs", default: "./esm.mjs" } },
    }),
    "node_modules/dual/esm.mjs": "export default 5; export const named = 'esm';\n",
    "node_modules/dual/cjs.cjs": "module.exports = { default: 10, named: 'cjs' };\n",
  });
  return { dir, pkgDir: join(dir, "node_modules", "dual") };
}

describe("exports 条件键按消费形态分表", () => {
  const dualPkg = (prefix: string) => {
    const dir = tmpProject(prefix);
    writeTmpFiles(dir, {
      "node_modules/dual/package.json": JSON.stringify({ name: "dual", version: "1.0.0", exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs", default: "./esm.mjs" } } }),
      "node_modules/dual/esm.mjs": "export default 5; export const named = 'esm';\n",
      "node_modules/dual/cjs.cjs": "module.exports = { default: 10, named: 'cjs' };\n",
    });
    return { dir, pkgDir: join(dir, "node_modules", "dual") };
  };
  it("import/require/auto 分表；仅 require 与无条件键负控", () => {
    const imp = dualPkg("nudo-477-import-");
    expect(resolveNpmJsEntryDetailed("dual", imp.dir, "import").path).toBe(join(imp.pkgDir, "esm.mjs"));
    expect(resolveNpmJsEntryDetailed("dual", imp.dir, "import").exportsUnresolved).toBe(false);
    const req = dualPkg("nudo-477-require-");
    expect(resolveNpmJsEntryDetailed("dual", req.dir, "require").path).toBe(join(req.pkgDir, "cjs.cjs"));
    const auto = dualPkg("nudo-477-auto-");
    expect(resolveNpmJsEntryDetailed("dual", auto.dir).path).toBe(join(auto.pkgDir, "esm.mjs"));

    const onlyDir = tmpProject("nudo-477-requireonly-");
    writeTmpFiles(onlyDir, {
      "node_modules/onlyreq/package.json": JSON.stringify({ name: "onlyreq", version: "1.0.0", exports: { ".": { require: "./index.cjs" } } }),
      "node_modules/onlyreq/index.cjs": "module.exports = 1;\n",
    });
    expect(resolveNpmJsEntryDetailed("onlyreq", onlyDir).path).toBe(join(onlyDir, "node_modules", "onlyreq", "index.cjs"));
    const strict = resolveNpmJsEntryDetailed("onlyreq", onlyDir, "import");
    expect(strict.path).toBeNull();
    expect(strict.exportsUnresolved).toBe(true);

    const plainDir = tmpProject("nudo-477-default-");
    writeTmpFiles(plainDir, {
      "node_modules/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0", exports: { ".": "./index.js" } }),
      "node_modules/plain/index.js": "export const x = 1;\n",
    });
    for (const mode of ["import", "require"] as const) {
      expect(resolveNpmJsEntryDetailed("plain", plainDir, mode).path).toBe(join(plainDir, "node_modules", "plain", "index.js"));
    }
  });
});
;
});

// ---------------------------------------------------------------------------
// 相对 path env 按发起方目录解析
// ---------------------------------------------------------------------------
describe("相对 path env 按发起方目录解析", () => {
/**
 * 相对路径 `@nudo:env` 按**进程级全局 baseDir 注册表**解析：
 * 先预载的 `./env.ts` 赢下所有同名拼写 ⇒ 别的目录拿到别人的 env（错值 + 零诊断）。
 *
 * 契约：相对说明符（`./env.js`）只按**发起方文件的目录**解析；
 * 同一进程内两个目录各有自己的 `./env.js` 时必须各取各的。
 */





/** env 文件用 @nudojs/core 的裸说明符（装载器会重写为绝对路径后导入） */
const envFile = (n: number): string => `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(${n}) } };
}
`;

beforeEach(() => {
  clearPathEnvCaches();
});

describe("相对 path env 按发起方目录解析", () => {
  const envFile = (n: number) => `import { numLit } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: numLit(${n}) } };
}
`;
  beforeEach(() => { clearPathEnvCaches(); });
  it("两目录各取各的（预载顺序无关）；同目录稳定；绝对路径照旧", async () => {
    const x = tmpProject("nudo-b478-x-", { "env.js": envFile(11) });
    const y = tmpProject("nudo-b478-y-", { "env.js": envFile(22) });
    await preloadPathEnvs(["./env.js"], x);
    await preloadPathEnvs(["./env.js"], y);
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), x).globals.MAGIC!)).toBe("11");
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), y).globals.MAGIC!)).toBe("22");

    const x2 = tmpProject("nudo-b478-x2-", { "env.js": envFile(11) });
    const y2 = tmpProject("nudo-b478-y2-", { "env.js": envFile(22) });
    await preloadPathEnvs(["./env.js"], y2);
    await preloadPathEnvs(["./env.js"], x2);
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), x2).globals.MAGIC!)).toBe("11");
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), y2).globals.MAGIC!)).toBe("22");

    const same = tmpProject("nudo-b478-same-", { "env.js": envFile(11) });
    await preloadPathEnvs(["./env.js"], same);
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), same).globals.MAGIC!)).toBe("11");
    expect(formatShape(loadEnvs(["./env.js"], createEnvironment(), same).globals.MAGIC!)).toBe("11");

    const absDir = tmpProject("nudo-b478-abs-", { "env.js": envFile(11) });
    const abs = `${absDir}/env.js`;
    await preloadPathEnvs([abs], absDir);
    expect(formatShape(loadEnvs([abs], createEnvironment(), absDir).globals.MAGIC!)).toBe("11");
    expect(getPathEnvLoadErrors(absDir)).toHaveLength(0);
  });
});
;
});

// ---------------------------------------------------------------------------
// autoBind 归一成布尔（三面同口径）
// ---------------------------------------------------------------------------
describe("autoBind 归一成布尔（三面同口径）", () => {
/**
 * `nudo.contract.autoBind` 写成**非布尔值**时，check 与
 * contract / export **三面分裂**（一边说「绑侧车」、一边说「不绑」），
 * 且磁盘缓存会把结论**投毒**到另一种取值上。
 *
 * 根因（config.ts contractConfig）：`autoBind: config?.contract?.autoBind ?? true`
 * **不校验类型**、原样透传 ⇒ check 面（`=== false` 判「关」）与 contract/export
 * 面（core `sidecarAutoBindAllowed` 把非 true/非函数读成「关」）结论相反。
 *
 * 修法：在**唯一归一点**（contractConfig）把 autoBind 归一成布尔：
 * 非法值按 config.md「invalid values fall back to the default」回落默认
 * `true` + 一条 stderr 提示 ⇒ 三面读同一个归一值，缓存键也分得清取值。
 */







function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const LIB_JS = `export function needsPositive(x) { return x > 0 ? x : 0; }\n`;
const LIB_NUDO_JS = `import { fn, number } from "@nudojs/core";
export const needsPositive = fn({ x: number().gt(0) }, number());
`;

function projectWithAutoBind(autoBind: unknown): string {
  const root = tmpProject("nudo-bug487-", {
    "package.json": JSON.stringify({ name: "t", type: "module", nudo: { contract: { autoBind } } }),
    "lib.js": LIB_JS,
    "lib.nudo.js": LIB_NUDO_JS,
  });
  return root;
}

describe("autoBind 归一成布尔（三面同口径）", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  const LIB_JS = "export function needsPositive(x) { return x > 0 ? x : 0; }\n";
  const LIB_NUDO_JS = 'import { fn, number } from "@nudojs/core";\nexport const needsPositive = fn({ x: number().gt(0) }, number());\n';
  const projectWithAutoBind = (autoBind: unknown) => tmpProject("nudo-b487-", {
    "package.json": JSON.stringify({ name: "t", type: "module", nudo: { contract: { autoBind } } }),
    "lib.js": LIB_JS,
    "lib.nudo.js": LIB_NUDO_JS,
  });
  beforeEach(() => { evictProjectConfigMemo(); });
  it("非法值回默认 true + 提示；严格布尔；contract 面绑侧车；合法 false 不绑；合法值不告警", async () => {
    for (const raw of ["false", 0, { a: 1 }]) {
      evictProjectConfigMemo();
      let out = "";
      let value: boolean | undefined;
      out += captureStderr(() => { value = contractConfig({ contract: { autoBind: raw } as never }).autoBind; });
      expect(value, String(raw)).toBe(true);
      expect(out, String(raw)).toContain("nudo.contract.autoBind: invalid value");
      expect(out, String(raw)).toContain("using true");
    }
    const cfg = contractConfig({ contract: { autoBind: "false" } as never });
    expect(typeof cfg.autoBind).toBe("boolean");
    expect(cfg.autoBind === false).toBe(false);
    expect(cfg.autoBind !== true).toBe(false);

    const root = projectWithAutoBind("false");
    const entries = await contractSurface(join(root, "lib.js"));
    expect(entries.find((e) => e.fn === "needsPositive")!.source).toBe("handwritten");
    const rootFalse = projectWithAutoBind(false);
    const falseEntries = await contractSurface(join(rootFalse, "lib.js"));
    expect(falseEntries.find((e) => e.fn === "needsPositive")!.source).toBe("implicit");

    let out = "";
    out += captureStderr(() => { expect(contractConfig({ contract: { autoBind: true } }).autoBind).toBe(true); });
    out += captureStderr(() => { expect(contractConfig({ contract: { autoBind: false } }).autoBind).toBe(false); });
    out += captureStderr(() => { expect(contractConfig({ contract: {} }).autoBind).toBe(true); });
    out += captureStderr(() => { expect(contractConfig(undefined).autoBind).toBe(true); });
    expect(out).toBe("");
    const proj = findProjectConfig(root);
    expect(contractConfig(proj?.config).autoBind).toBe(true);
    expect(typeof contractConfig(proj?.config).autoBind).toBe("boolean");
  });
});
;
});

// ---------------------------------------------------------------------------
// 非法 NUDO_MAX_FORKS 回默认（不是配置键）
// ---------------------------------------------------------------------------
describe("非法 NUDO_MAX_FORKS 回默认（不是配置键）", () => {
/**
 * `NUDO_MAX_FORKS` 给了**非法值**时，实现让
 * `nudo.analysis.maxForks` 顶上来；而文档与**源码自己的注释**都写
 * 「非法值回**默认**（5000）」——实现与二者都不符。
 *
 * 根因（config.ts applyBForkBudgetFromConfig）：`parseMaxForks` 把「非法」
 * 折成 `undefined`，与「**没设**」同值 ⇒ `??` 链无法区分「env 非法
 * （应回默认）」与「env 未设（应看配置）」。
 *
 * 修法：区分「env 未设（缺席 / 空串）」与「env 设了但非法」；后者直接回
 * 默认 5000 并给一条 stderr 提示（用户至少知道自己没在用配置值）。
 */



function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const CFG_200 = { analysis: { maxForks: 200 } };

describe("非法 NUDO_MAX_FORKS 回默认（不是配置键）", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  const CFG_200 = { analysis: { maxForks: 200 } };
  beforeEach(() => { evictProjectConfigMemo(); });
  it("非法 env 回默认并提示；合法 env 压配置；未设看配置；空串当未设；配置非法回默认", () => {
    let eff: number | undefined;
    const out = captureStderr(() => { eff = applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "abc" }); });
    expect(eff).toBe(5000);
    expect(currentBForkBudgetLimit()).toBe(5000);
    expect(out).toContain("NUDO_MAX_FORKS: invalid value");
    expect(out).toContain("using 5000");
    for (const raw of ["0", "-5", "abc", "1e"]) {
      evictProjectConfigMemo();
      let v: number | undefined;
      captureStderr(() => { v = applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: raw }); });
      expect(v, raw).toBe(5000);
    }
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "999" })).toBe(999);
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "1" })).toBe(1);
    expect(applyBForkBudgetFromConfig(CFG_200, {})).toBe(200);
    expect(applyBForkBudgetFromConfig(undefined, {})).toBe(5000);
    expect(applyBForkBudgetFromConfig(CFG_200, { NUDO_MAX_FORKS: "" })).toBe(200);
    expect(applyBForkBudgetFromConfig({ analysis: { maxForks: 0 } }, {})).toBe(5000);
    expect(applyBForkBudgetFromConfig({ analysis: { maxForks: -1 } }, {})).toBe(5000);
  });
});
;
});

// ---------------------------------------------------------------------------
// #imports（包内子路径映射）
// ---------------------------------------------------------------------------
describe("#imports（包内子路径映射）", () => {
/**
 * 回归：Node 的 `#imports`（**导入方** package.json 的 imports 字段）
 * 必须被解析——改前 `#helper` 被当成「包名」⇒ `node_modules/#helper` 必 miss
 * ⇒ 跨模块值塌成 unknown 且零诊断。
 */





describe("#imports（包内子路径映射）", () => {
  it("精确/模式/条件/外部包/缺失/裸包负控", () => {
    const exact = tmpProject("nudo-498-exact-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module", imports: { "#helper": "./helper.js" } }), "helper.js": "export function h() { return 42; }\n" });
    const er = resolveNpmJsEntryDetailed("#helper", exact);
    expect(er.path).toBe(join(exact, "helper.js"));
    expect(er.exportsUnresolved).toBe(false);

    const pattern = tmpProject("nudo-498-pattern-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module", imports: { "#internal/*": "./src/*.js" } }), "src/a.js": "export const a = 1;\n" });
    expect(resolveNpmJsEntryDetailed("#internal/a", pattern).path).toBe(join(pattern, "src", "a.js"));

    const cond = tmpProject("nudo-498-cond-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module", imports: { "#dual": { import: "./esm.mjs", require: "./cjs.cjs" } } }), "esm.mjs": "export default 1;\n", "cjs.cjs": "module.exports = 2;\n" });
    expect(resolveNpmJsEntryDetailed("#dual", cond, "import").path).toBe(join(cond, "esm.mjs"));
    expect(resolveNpmJsEntryDetailed("#dual", cond, "require").path).toBe(join(cond, "cjs.cjs"));

    const external = tmpProject("nudo-498-external-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module", imports: { "#dep": "dep" } }), "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", exports: { ".": "./index.js" } }), "node_modules/dep/index.js": "export const x = 1;\n" });
    expect(resolveNpmJsEntryDetailed("#dep", external).path).toBe(join(external, "node_modules", "dep", "index.js"));

    const miss = tmpProject("nudo-498-miss-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module", imports: { "#helper": "./helper.js" } }), "helper.js": "export const x = 1;\n" });
    const mr = resolveNpmJsEntryDetailed("#nope", miss);
    expect(mr.path).toBeNull();
    expect(mr.exportsUnresolved).toBe(true);

    const bare = tmpProject("nudo-498-bare-", { "package.json": JSON.stringify({ name: "app", version: "1.0.0", type: "module" }), "node_modules/plain/package.json": JSON.stringify({ name: "plain", version: "1.0.0", exports: { ".": "./index.js" } }), "node_modules/plain/index.js": "export const x = 1;\n" });
    expect(resolveNpmJsEntryDetailed("plain", bare).path).toBe(join(bare, "node_modules", "plain", "index.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// node_modules 逐级向上查找
// ---------------------------------------------------------------------------
describe("node_modules 逐级向上查找", () => {
/**
 * 回归：裸包 `node_modules` 查找必须**逐级向上**
 * （Node 语义：每层 node_modules 都试一遍，包不在本层就继续往上）——
 * 改前只取「第一个存在的 node_modules 目录」，包只装在父级时 JS 入口不解析
 * ⇒ 回落 @types harvest ⇒ L2 门禁由红转绿。
 */





/** 父级安装：app/node_modules 存在但**不含**该包；包在上一级 node_modules。 */
function parentInstall(prefix: string): { dir: string; appDir: string; pkgDir: string } {
  const dir = tmpProject(prefix);
  writeTmpFiles(dir, {
    "node_modules/mypkg/package.json": JSON.stringify({
      name: "mypkg",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/mypkg/index.js": "export function hello() { throw new Error('boom'); }\n",
    "app/node_modules/.keep": "",
    "app/main.js": "import { hello } from 'mypkg';\nexport function go() { return hello(); }\n",
  });
  return {
    dir,
    appDir: join(dir, "app"),
    pkgDir: join(dir, "node_modules", "mypkg"),
  };
}

describe("node_modules 逐级向上查找", () => {
  const parentInstall = (prefix: string) => {
    const dir = tmpProject(prefix, {
      "node_modules/mypkg/package.json": JSON.stringify({ name: "mypkg", version: "1.0.0", type: "module", main: "index.js" }),
      "node_modules/mypkg/index.js": "export function hello() { throw new Error('boom'); }\n",
      "app/node_modules/.keep": "",
      "app/main.js": "import { hello } from 'mypkg';\nexport function go() { return hello(); }\n",
    });
    return { dir, appDir: join(dir, "app"), pkgDir: join(dir, "node_modules", "mypkg") };
  };
  it("父级安装可解析；就近优先；侧车同口径；未安装 miss 不报 unresolved", () => {
    const parent = parentInstall("nudo-500-parent-");
    const r = resolveNpmJsEntryDetailed("mypkg", parent.appDir);
    expect(r.path).toBe(join(parent.pkgDir, "index.js"));
    expect(r.exportsUnresolved).toBe(false);

    const near = parentInstall("nudo-500-nearest-");
    writeTmpFiles(near.dir, {
      "app/node_modules/mypkg/package.json": JSON.stringify({ name: "mypkg", version: "1.0.0", type: "module", main: "index.js" }),
      "app/node_modules/mypkg/index.js": "export function hello() { return 42; }\n",
    });
    expect(resolveNpmJsEntryDetailed("mypkg", near.appDir).path).toBe(join(near.appDir, "node_modules", "mypkg", "index.js"));

    const side = tmpProject("nudo-500-nudo-");
    writeTmpFiles(side, {
      "node_modules/side/package.json": JSON.stringify({ name: "side", version: "1.0.0", exports: { ".": { nudo: "./index.nudo.js" } } }),
      "node_modules/side/index.nudo.js": "export const x = 1;\n",
      "app/node_modules/.keep": "",
    });
    expect(resolveNpmNudo("side", join(side, "app"))).toBe(join(side, "node_modules", "side", "index.nudo.js"));

    const absent = tmpProject("nudo-500-absent-");
    writeTmpFiles(absent, { "app/main.js": "export const x = 1;\n" });
    const miss = resolveNpmJsEntryDetailed("nosuchpkg", join(absent, "app"));
    expect(miss.path).toBeNull();
    expect(miss.exportsUnresolved).toBe(false);
  });
});
;
});

// ---------------------------------------------------------------------------
// 项目级 path env 的内容进缓存键
// ---------------------------------------------------------------------------
describe("项目级 path env 的内容进缓存键", () => {
/**
 * 项目级 path env 的**文件内容**是缓存键的维度。
 *
 * 改前：分析缓存键（analysisFileCacheKey 的 envSeg）与 evaluator memo 键
 * （tryRunEval 的 envKey）只编码 env **名字** ⇒ 同一个 env 名指向的文件
 * 内容改了，缓存照样命中 → 类型面停在旧值。
 *
 * 原生真值：env 文件是普通模块——内容改了，import 它的一方看到的就是新值。
 * 文件级 `/// @nudo:env` 的同款维度已由 dep 指纹覆盖（本就正确）——负控制。
 */







function envFile(fn: string, value: string): string {
  return `import { ${fn} } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: ${value} } };
}
`;
}

async function magicShape(file: string, source: string): Promise<string> {
  const result = await analyzeFileAsync___nudojs_service(file, source);
  const fn = result.functions.find((f) => f.name === "getMagic");
  return fn ? formatShape(fn.cases[0].abs) : "<no-fn>";
}

describe("项目级 path env 的内容进缓存键", () => {
  const envFile = (fn: string, value: string) => `import { ${fn} } from "@nudojs/core";
export function defineEnv() {
  return { globals: { MAGIC: ${value} } };
}
`;
  const magicShape = async (file: string, source: string) => {
    const result = await analyzeFileAsync___nudojs_service(file, source);
    const fn = result.functions.find((f) => f.name === "getMagic");
    return fn ? formatShape(fn.cases[0].abs) : "<no-fn>";
  };
  it("改项目级 env 内容类型面跟着变；文件级同款；内容不变稳定", async () => {
    clearEvalCache();
    const dir = tmpProject("nudo-b501-", { "package.json": JSON.stringify({ name: "b501", type: "module", nudo: { env: ["./env.ts"] } }), "env.ts": envFile("numLit", "numLit(1)"), "main.js": "export function getMagic() {\n  return MAGIC;\n}\n" });
    const main = join(dir, "main.js");
    const src = "export function getMagic() {\n  return MAGIC;\n}\n";
    expect(await magicShape(main, src)).toBe("1");
    writeFileSync(join(dir, "env.ts"), envFile("strLit", 'strLit("hello")'), "utf-8");
    expect(await magicShape(main, src)).toBe('"hello"');

    clearEvalCache();
    const fileDir = tmpProject("nudo-b501-file-", { "env.ts": envFile("numLit", "numLit(1)"), "main.js": "/// @nudo:env ./env.ts\n\nexport function getMagic() {\n  return MAGIC;\n}\n" });
    const fileMain = join(fileDir, "main.js");
    const fileSrc = "/// @nudo:env ./env.ts\n\nexport function getMagic() {\n  return MAGIC;\n}\n";
    expect(await magicShape(fileMain, fileSrc)).toBe("1");
    writeFileSync(join(fileDir, "env.ts"), envFile("strLit", 'strLit("hello")'), "utf-8");
    expect(await magicShape(fileMain, fileSrc)).toBe('"hello"');

    clearEvalCache();
    const stable = tmpProject("nudo-b501-stable-", { "package.json": JSON.stringify({ name: "b501-stable", type: "module", nudo: { env: ["./env.ts"] } }), "env.ts": envFile("numLit", "numLit(1)"), "main.js": "export function getMagic() {\n  return MAGIC;\n}\n" });
    const stableMain = join(stable, "main.js");
    expect(await magicShape(stableMain, src)).toBe("1");
    expect(await magicShape(stableMain, src)).toBe("1");
  });
});
;

/** 负控制：不该被这条修复波及的邻近形态 */
;
});

// ---------------------------------------------------------------------------
// @nudo:env globals reach the service analysis
// ---------------------------------------------------------------------------
describe("@nudo:env globals reach the service analysis", () => {
/**
 * @nudo:env 的 globals 必须进入 service 的分析面。
 *
 * 口径：env globals 由 collectEnvGlobals(envNames) 统一物化——
 * - 命名 env（node / es / web）：同步可见
 * - path 型 env（`/// @nudo:env ./env.ts`）：需先 preload（analyzeFileAsync
 * 预载后同步面才可见）——同步面看不到时保持"无信息"（fail-closed），
 * 不假装有类型。
 *
 * 本测试锁住：
 * ① 分析环境（globalEnv → buildNodeTypeMap 的节点类型面）带上 env globals
 * ② 异步入口（唯一预载 path 型 env 的入口）解析出 env 全局值
 *
 * 注：IDE 诊断面的假红（`nudo:entry-may-throw: may throw ReferenceError`）
 * 根因在 LSP 侧 checkSource 未注入 envGlobals（packages/lsp/src/validation.ts，
 * 归 L 分片）——见本轮报告的越界项。
 */





const ENV_FILE = `export function defineEnv() {
  return { globals: { MAGIC: 1 } };
}
`;

const MAIN_FILE = `/// @nudo:env ./env.ts
export function useGlobal() {
  return MAGIC;
}
`;

describe("@nudo:env globals reach the service analysis", () => {
  const ENV_FILE = "export function defineEnv() {\n  return { globals: { MAGIC: 1 } };\n}\n";
  const MAIN_FILE = "/// @nudo:env ./env.ts\nexport function useGlobal() {\n  return MAGIC;\n}\n";
  it("async 预载后解析 env 全局；分析环境带 env globals", async () => {
    const dir = tmpProject("nudo-b502-", { "env.ts": ENV_FILE, "main.js": MAIN_FILE });
    const r = await analyzeFileAsync(`${dir}/main.js`, MAIN_FILE);
    const fn = r.functions.find((f) => f.name === "useGlobal")!;
    const c = fn.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"))!;
    expect(formatAbs(c.abs)).toContain("1");
    expect(formatAbs(c.abs)).not.toContain("never");

    const src = '/// @nudo:env node\nthrow new Error("boom");\nexport function useProcess() { return process.cwd(); }\n';
    const nodeResult = analyzeFile("/t/b502/env-globals.js", src);
    const names: string[] = [];
    for (const [node] of nodeResult.nodeAbsMap) if (node.type === "Identifier") names.push(node.name);
    expect(names).toContain("process");
  });
});
;
});

// ---------------------------------------------------------------------------
// CJS / ESM 两条解析算法分表
// ---------------------------------------------------------------------------
describe("CJS / ESM 两条解析算法分表", () => {
/**
 * 回归：模块解析必须**按加载形态分表**（Node 的两条算法），不再合成一张：
 * - CJS（require）：LOAD_AS_FILE —— 猜扩展名（含 `.json`）+ index 入口；
 * - ESM（import）：ESM_RESOLVE —— **不猜扩展名**（必须写全）+ 不做目录 import。
 *
 * 改前（一张表）：`require("./data")`（同目录有 data.json）被判「文件不存在」并报
 * error 级 nudo:module-missing（假红）；`import "./data"`（只有 data.js）被解析成功
 * （假绿，native 报 ERR_MODULE_NOT_FOUND）。
 */





/** CJS 包：package.json type=commonjs；同目录**只有** data.json（Node 的
 * LOAD_AS_FILE 会试 .json——改前的候选表没有 .json ⇒ 假红「文件不存在」）。 */
function cjsProject(prefix: string): { dir: string; main: string } {
  const dir = tmpProject(prefix, {
    "package.json": JSON.stringify({ name: "cjsapp", version: "1.0.0", type: "commonjs" }),
    "data.json": '{ "answer": 42 }\n',
    "main.js": "const data = require('./data');\nmodule.exports = { data };\n",
  });
  return { dir, main: join(dir, "main.js") };
}

/** ESM 包：package.json type=module。 */
function esmProject(prefix: string): { dir: string; main: string } {
  const dir = tmpProject(prefix, {
    "package.json": JSON.stringify({ name: "esmapp", version: "1.0.0", type: "module" }),
    "data.js": "export const answer = 7;\n",
    "main.js": "import { answer } from './data';\nexport function f() { return answer; }\n",
  });
  return { dir, main: join(dir, "main.js") };
}

describe("CJS / ESM 两条解析算法分表", () => {
  const cjsProject = (prefix: string) => {
    const dir = tmpProject(prefix, { "package.json": JSON.stringify({ name: "cjsapp", version: "1.0.0", type: "commonjs" }), "data.json": '{ "answer": 42 }\n', "main.js": "const data = require('./data');\nmodule.exports = { data };\n" });
    return { dir, main: join(dir, "main.js") };
  };
  const esmProject = (prefix: string) => {
    const dir = tmpProject(prefix, { "package.json": JSON.stringify({ name: "esmapp", version: "1.0.0", type: "module" }), "data.js": "export const answer = 7;\n", "main.js": "import { answer } from './data';\nexport function f() { return answer; }\n" });
    return { dir, main: join(dir, "main.js") };
  };
  it("CJS 猜扩展名含 .json/index；ESM 不猜；显式扩展名两态可解析；TS 合并表；CJS .js 优先", () => {
    const cjs = cjsProject("nudo-505-cjs-");
    expect(resolveModuleFile("./data", cjs.main)).toBe(join(cjs.main, "..", "data.json"));
    const esm = esmProject("nudo-505-esm-");
    expect(resolveModuleFile("./data", esm.main)).toBeUndefined();
    const esmExplicit = esmProject("nudo-505-esm-explicit-");
    expect(resolveModuleFile("./data.js", esmExplicit.main)).toBe(join(esmExplicit.dir, "data.js"));

    const cjsBase = join(cjs.main, "..", "data");
    const cjsCands = moduleResolveCandidates("./data", cjs.main);
    expect(cjsCands).toContain(`${cjsBase}.json`);
    expect(cjsCands).toContain(join(cjsBase, "index.js"));
    expect(moduleResolveCandidates("./data", esm.main)).toEqual([join(esm.main, "..", "data")]);

    const cjsJson = cjsProject("nudo-505-json-cjs-");
    expect(resolveModuleFile("./data.json", cjsJson.main)).toBe(join(cjsJson.dir, "data.json"));
    writeTmpFiles(esm.dir, { "data.json": '{ "answer": 42 }\n' });
    expect(resolveModuleFile("./data.json", esm.main)).toBe(join(esm.dir, "data.json"));

    const order = tmpProject("nudo-505-order-", { "package.json": JSON.stringify({ name: "ord", version: "1.0.0", type: "commonjs" }), "data.js": "export const answer = 7;\n", "data.json": '{ "answer": 42 }\n', "main.js": "const data = require('./data');\nmodule.exports = { data };\n" });
    expect(resolveModuleFile("./data", join(order, "main.js"))).toBe(join(order, "data.js"));

    const ts = tmpProject("nudo-505-ts-", { "utils/index.ts": "export const pad = (s: string) => s;\n", "main.ts": "import { pad } from './utils';\nexport const go = pad;\n" });
    const tsMain = join(ts, "main.ts");
    expect(resolveModuleFile("./utils", tsMain)).toBe(join(ts, "utils", "index.ts"));
    expect(moduleResolveCandidates("./utils", tsMain)).toContain(join(ts, "utils", "index.js"));
  });
});
;
});

// ---------------------------------------------------------------------------
// effectiveMaxForks —— env 优先的 fork 预算生效值
// ---------------------------------------------------------------------------
describe("effectiveMaxForks —— env 优先的 fork 预算生效值", () => {
/**
 * 回归：fork 预算的**生效值**（env `NUDO_MAX_FORKS` 优先）必须进
 * 磁盘缓存键。
 *
 * 病灶：缓存键（`checkCacheKey` 的 `analysisCfg.maxForks`）喂的是
 * `analysisConfig(config).maxForks`，而它**只认 package.json**；真正生效的
 * 上限来自 env（`applyBForkBudgetFromConfig` 同口径：env > config > 5000）
 * ⇒ 改 env 不改键 ⇒ 命中轮返回**上一轮**的陈旧 budget（反向：新预算
 * **根本没执行**，`nudo:fork-truncated` 缺失）。
 *
 * 修法（packages/service/src/evaluator/config.ts）：新增纯函数
 * `effectiveMaxForks(config, env)`，`analysisConfig()` 的 `maxForks`
 * 改用它 ⇒ 键随 env 变。
 *
 * 负控制：config-only 维度（无 env）行为不变；非法 env 仍回落默认 5000。
 */




const ENV_KEY = "NUDO_MAX_FORKS";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV_KEY];
});
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe("effectiveMaxForks —— env 优先的 fork 预算生效值", () => {
  const ENV_KEY = "NUDO_MAX_FORKS";
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV_KEY]; });
  afterEach(() => { if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved; });
  it("env 优先；无 env 看配置/默认；非法回默认；小数取整；空串当未设；显式 env 参数优先", () => {
    process.env[ENV_KEY] = "7";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(7);
    delete process.env[ENV_KEY];
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(100);
    expect(effectiveMaxForks(undefined)).toBe(5000);
    expect(effectiveMaxForks({})).toBe(5000);
    for (const bad of ["abc", "0", "-3"]) {
      process.env[ENV_KEY] = bad;
      expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(5000);
    }
    process.env[ENV_KEY] = "1.5";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(1);
    process.env[ENV_KEY] = "";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } })).toBe(100);
    process.env[ENV_KEY] = "7";
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } }, {})).toBe(100);
    expect(effectiveMaxForks({ analysis: { maxForks: 100 } }, { NUDO_MAX_FORKS: "9" })).toBe(9);
  });
});
;

describe("analysisConfig().maxForks 是 env 生效值（缓存键的输入）", () => {
  const ENV_KEY = "NUDO_MAX_FORKS";
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV_KEY]; });
  afterEach(() => { if (saved === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = saved; });
  it("env 改预算配置随之变；缓存键随 env 翻转（含调用方陈旧 maxForks）", () => {
    delete process.env[ENV_KEY];
    expect(analysisConfig({ analysis: { maxForks: 100 } }).maxForks).toBe(100);
    process.env[ENV_KEY] = "3";
    expect(analysisConfig({ analysis: { maxForks: 100 } }).maxForks).toBe(3);

    const cfg = { analysis: { maxForks: 100 } };
    const src = "export function pick(a, b, c) { return a + b + c; }\n";
    const keyOf = () => checkCacheKey("/tmp/nudo-b636/lib.js", src, { autoBind: true, analysisCfg: { mode: "exports", evalMissingSlot: "off", callSiteBudget: 3, entryThrows: "error", ignoreThrows: "", maxForks: analysisConfig(cfg).maxForks } });
    delete process.env[ENV_KEY];
    const noEnv = keyOf();
    process.env[ENV_KEY] = "1";
    expect(keyOf()).not.toBe(noEnv);

    const keyWith = (maxForks: number) => checkCacheKey("/tmp/nudo-b636/lib.js", src, { autoBind: true, analysisCfg: { mode: "exports", evalMissingSlot: "off", callSiteBudget: 3, entryThrows: "error", ignoreThrows: "", maxForks } });
    delete process.env[ENV_KEY];
    const staleNoEnv = keyWith(5000);
    process.env[ENV_KEY] = "1";
    expect(keyWith(5000)).not.toBe(staleNoEnv);
  });
});
;
});

// ---------------------------------------------------------------------------
// env 项元素级校验（非字符串元素不得裸崩）
// ---------------------------------------------------------------------------
describe("env 项元素级校验（非字符串元素不得裸崩）", () => {
/**
 * `package.json#nudo.env` 的**数组元素**不是字符串（[42] / [null] /
 * [{}] / [[]]）⇒ service 层 `isPathEnvName` 裸崩（name.includes is not a
 * function / Cannot read properties of null）⇒ 影响所有消费者。
 *
 * 契约：元素级校验必须存在——非法元素**丢弃 + 可见告警**，不得裸崩；
 * 合法元素（["node"]）照常生效（负控制）。
 */







beforeEach(() => {
  clearPathEnvCaches();
});

/** 捕获 stderr（项目配置诊断走 stderr，与 config.ts 其余诊断同风格） */
function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

const BAD_ELEMENTS: unknown[] = [42, null, {}, []];

describe("env 项元素级校验（非字符串元素不得裸崩）", () => {
  beforeEach(() => { clearPathEnvCaches(); });
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  const BAD = [42, null, {}, []];
  it("四种非法元素不崩且有告警；preload 不冒泡；合法元素/字符串 path 负控", async () => {
    const dir = tmpProject("nudo-b935-load-");
    const env = createEnvironment();
    for (const el of BAD) expect(Object.keys(loadEnvs([el] as unknown as string[], env, dir).globals)).toHaveLength(0);
    const errs = getPathEnvLoadErrors(dir);
    expect(errs).toHaveLength(BAD.length);
    for (const e of errs) expect(e.error).toContain("invalid env entry");

    const pre = tmpProject("nudo-b935-preload-");
    await expect(preloadPathEnvs([42] as unknown as string[], pre)).resolves.toBeUndefined();
    const preErrs = getPathEnvLoadErrors(pre);
    expect(preErrs.length).toBeGreaterThanOrEqual(1);
    expect(preErrs[0]!.error).toContain("invalid env entry");
    expect(preErrs[0]!.error).toContain("expected a string");

    const ok = tmpProject("nudo-b935-ok-");
    expect(Object.keys(loadEnvs(["node"], createEnvironment(), ok).globals).length).toBeGreaterThan(0);
    expect(getPathEnvLoadErrors(ok)).toHaveLength(0);
    const pathOk = tmpProject("nudo-b935-path-");
    await preloadPathEnvs(["node"], pathOk);
    expect(getPathEnvLoadErrors(pathOk)).toHaveLength(0);
  });
});
;

describe("项目级 package.json#nudo.env 的元素级校验", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  it("非字符串元素丢弃 + 诊断；env 非数组整项丢弃 + 诊断；合法列表零诊断", () => {
    const mixed = tmpProject("nudo-b935-proj-", { "package.json": JSON.stringify({ name: "p935", nudo: { env: ["node", 42, null] } }) });
    let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    const err = captureStderr(() => { found = findProjectConfig(mixed); });
    expect(found?.config.env).toEqual(["node"]);
    expect(err).toContain("nudo.env");
    expect(err).toContain("non-string");

    const shape = tmpProject("nudo-b935-proj-shape-", { "package.json": JSON.stringify({ name: "p935b", nudo: { env: "node" } }) });
    let shapeFound: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    const shapeErr = captureStderr(() => { shapeFound = findProjectConfig(shape); });
    expect(shapeFound?.config.env).toEqual([]);
    expect(shapeErr).toContain("nudo.env");

    const ok = tmpProject("nudo-b935-proj-ok-", { "package.json": JSON.stringify({ name: "p935c", nudo: { env: ["node", "es"] } }) });
    let okFound: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
    const okErr = captureStderr(() => { okFound = findProjectConfig(ok); });
    expect(okFound?.config.env).toEqual(["node", "es"]);
    expect(okErr).toBe("");
  });
});
;
});

// ---------------------------------------------------------------------------
// 假值 nudo 键遮断祖先配置（存在性 ≠ 真值性）
// ---------------------------------------------------------------------------
describe("假值 nudo 键遮断祖先配置（存在性 ≠ 真值性）", () => {
/**
 * 子包 `package.json` 的 **`"nudo"` 键是假值**
 * （`false` / `null` / `0` / `""`）⇒ **不遮断**祖先包配置 ⇒ 子包**静默继承**
 * 根包的 `check.ignoreThrows`（把 L2 error 吞掉 ⇒ 门禁假绿）与 `nudo.env`
 * （跨包串味）——与文档「uses the **nearest** `package.json` that contains a
 * `nudo` key」直接冲突。
 *
 * 根因（config.ts findProjectConfig）：`if (nudo)` 用**真值**判定代替
 * 「**键是否存在**」⇒ 假值 nudo 键被当成「这个包没有 nudo 键」⇒ 搜索不截断。
 *
 * 修法：存在性判定（hasOwnProperty）—— 键存在即截断搜索；假值 nudo 键 =
 * 「本包显式不配置」⇒ 回落默认（不继承祖先）+ 一条 stderr 提示（不静默）。
 */






function captureStderr(fn: () => void): string {
  const writes: string[] = [];
  const orig = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return writes.join("");
}

/** 根包：ignoreThrows + env（子包若继承 ⇒ L2 被吞 + env 串味） */
function rootWithConfig(): string {
  return tmpProject("nudo-bug936-root-", {
    "package.json": JSON.stringify({
      name: "root",
      type: "module",
      nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] },
    }),
  });
}

function subPackage(root: string, nudo: unknown): string {
  const sub = join(root, "sub");
  mkdirSync(sub, { recursive: true });
  writeFileSync(
    join(sub, "package.json"),
    JSON.stringify({ name: "sub", type: "module", ...(nudo === undefined ? {} : { nudo }) }),
  );
  return sub;
}

describe("假值 nudo 键遮断祖先配置（存在性 ≠ 真值性）", () => {
  const captureStderr = (fn: () => void): string => {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((chunk: string | Uint8Array) => { writes.push(String(chunk)); return true; }) as typeof process.stderr.write;
    try { fn(); } finally { process.stderr.write = orig; }
    return writes.join("");
  };
  const rootWithConfig = () => tmpProject("nudo-b936-root-", { "package.json": JSON.stringify({ name: "root", type: "module", nudo: { check: { ignoreThrows: ["SyntaxError"] }, env: ["node"] } }) });
  const subPackage = (root: string, nudo: unknown) => {
    const sub = join(root, "sub");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, "package.json"), JSON.stringify({ name: "sub", type: "module", ...(nudo === undefined ? {} : { nudo }) }));
    return sub;
  };
  beforeEach(() => { evictProjectConfigMemo(); });
  it("假值键遮断 + 提示；ignoreThrows/env 不继承；空对象/无键/无 package 负控", () => {
    for (const raw of [false, null, 0, ""]) {
      evictProjectConfigMemo();
      const root = rootWithConfig();
      const sub = subPackage(root, raw);
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      const out = captureStderr(() => { found = findProjectConfig(sub); });
      expect(found, JSON.stringify(raw)).toBeNull();
      expect(out, JSON.stringify(raw)).toContain('falsy "nudo" key');
      expect(out, JSON.stringify(raw)).toContain("ancestor configs are not inherited");
    }
    {
      const root = rootWithConfig();
      const sub = subPackage(root, false);
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      captureStderr(() => { found = findProjectConfig(sub); });
      expect(checkConfig(found?.config).ignoreThrows).toEqual([]);
      expect(checkConfig(found?.config).entryThrows).toBe("error");
      expect(found?.config.env).toBeUndefined();
    }
    {
      const root = rootWithConfig();
      const sub = subPackage(root, {});
      let found: ReturnType<typeof findProjectConfig> = null as ReturnType<typeof findProjectConfig>;
      const out = captureStderr(() => { found = findProjectConfig(sub); });
      expect(found?.projectDir).toBe(sub);
      expect(found?.config).toEqual({});
      expect(out).toBe("");
    }
    {
      const root = rootWithConfig();
      const sub = subPackage(root, undefined);
      const found = findProjectConfig(sub);
      expect(found?.projectDir).toBe(root);
      expect(found?.config.check?.ignoreThrows).toEqual(["SyntaxError"]);
      expect(found?.config.env).toEqual(["node"]);
    }
    {
      const root = rootWithConfig();
      const sub = join(root, "no-pkg");
      mkdirSync(sub, { recursive: true });
      expect(findProjectConfig(sub)?.projectDir).toBe(root);
    }
  });
});
;
});
