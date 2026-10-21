/**
 * Bug 505 回归：模块解析必须**按加载形态分表**（Node 的两条算法），不再合成一张：
 * - CJS（require）：LOAD_AS_FILE —— 猜扩展名（含 `.json`）+ index 入口；
 * - ESM（import）：ESM_RESOLVE —— **不猜扩展名**（必须写全）+ 不做目录 import。
 *
 * 改前（一张表）：`require("./data")`（同目录有 data.json）被判「文件不存在」并报
 * error 级 nudo:module-missing（假红）；`import "./data"`（只有 data.js）被解析成功
 * （假绿，native 报 ERR_MODULE_NOT_FOUND）。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { moduleResolveCandidates, resolveModuleFile } from "../load-module.ts";
import { tmpProject, writeTmpFiles } from "./tmp-project.ts";

/** CJS 包：package.json type=commonjs；同目录**只有** data.json（Node 的
 *  LOAD_AS_FILE 会试 .json——改前的候选表没有 .json ⇒ 假红「文件不存在」）。 */
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

describe("Bug 505 — CJS / ESM 两条解析算法分表", () => {
  it("CJS 形态：require('./data') 解析到同目录的 data.json（不再是「文件不存在」）", () => {
    const { main } = cjsProject("nudo-505-cjs-");
    expect(resolveModuleFile("./data", main)).toBe(join(main, "..", "data.json"));
  });

  it("ESM 形态：import './data' 不猜扩展名 ⇒ 解析不到（native ERR_MODULE_NOT_FOUND）", () => {
    const { main } = esmProject("nudo-505-esm-");
    expect(resolveModuleFile("./data", main)).toBeUndefined();
  });

  it("ESM 形态：写全扩展名即可解析（import './data.js'）", () => {
    const { dir, main } = esmProject("nudo-505-esm-explicit-");
    expect(resolveModuleFile("./data.js", main)).toBe(join(dir, "data.js"));
  });

  it("候选表：ESM 面只有精确路径；CJS 面含 .json 与 index 入口", () => {
    const { main: cjsMain } = cjsProject("nudo-505-table-cjs-");
    const cjsCands = moduleResolveCandidates("./data", cjsMain);
    const base = join(cjsMain, "..", "data");
    expect(cjsCands).toContain(`${base}.json`);
    expect(cjsCands).toContain(join(base, "index.js"));

    const { main: esmMain } = esmProject("nudo-505-table-esm-");
    const esmCands = moduleResolveCandidates("./data", esmMain);
    expect(esmCands).toEqual([join(esmMain, "..", "data")]);
  });

  it("负控制：显式 './data.json' 在两种形态下都解析得到", () => {
    const { dir: cjsDir, main: cjsMain } = cjsProject("nudo-505-json-cjs-");
    expect(resolveModuleFile("./data.json", cjsMain)).toBe(join(cjsDir, "data.json"));

    const { dir: esmDir, main: esmMain } = esmProject("nudo-505-json-esm-");
    writeTmpFiles(esmDir, { "data.json": '{ "answer": 42 }\n' });
    expect(resolveModuleFile("./data.json", esmMain)).toBe(join(esmDir, "data.json"));
  });

  it("负控制：CJS 面的扩展名顺序同 Node（.js 先于 .json）", () => {
    const dir = tmpProject("nudo-505-order-", {
      "package.json": JSON.stringify({ name: "ord", version: "1.0.0", type: "commonjs" }),
      "data.js": "export const answer = 7;\n",
      "data.json": '{ "answer": 42 }\n',
      "main.js": "const data = require('./data');\nmodule.exports = { data };\n",
    });
    expect(resolveModuleFile("./data", join(dir, "main.js"))).toBe(join(dir, "data.js"));
  });

  it("负控制：TS 导入方保持合并表（目录 import + index 入口仍可解析）", () => {
    const dir = tmpProject("nudo-505-ts-", {
      "utils/index.ts": "export const pad = (s: string) => s;\n",
      "main.ts": "import { pad } from './utils';\nexport const go = pad;\n",
    });
    const main = join(dir, "main.ts");
    expect(resolveModuleFile("./utils", main)).toBe(join(dir, "utils", "index.ts"));
    // 合并表保持旧的扩展名序列（跨 loader 一致性）
    expect(moduleResolveCandidates("./utils", main)).toEqual([
      join(dir, "utils"),
      join(dir, "utils.js"),
      join(dir, "utils.mjs"),
      join(dir, "utils.ts"),
      join(dir, "utils", "index.js"),
      join(dir, "utils", "index.mjs"),
      join(dir, "utils", "index.ts"),
    ]);
  });

  it("负控制：显式形态参数优先于文件推导（调用方知道说明符来源形态时）", () => {
    const { main } = cjsProject("nudo-505-explicit-mode-");
    // CJS 包里的文件按 import 形态解析 → 不猜扩展名
    expect(resolveModuleFile("./data", main, "import")).toBeUndefined();
    expect(resolveModuleFile("./data", main, "require")).toBe(join(main, "..", "data.json"));
  });
});
