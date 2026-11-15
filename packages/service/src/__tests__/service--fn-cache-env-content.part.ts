/**
 * BUG-012 回归：函数级分析缓存的 env 维度必须与另外两层（文件级
 * `analysisFileCacheKey`、求值器 memo）**同口径**——用**内容指纹**，不是 mtime。
 *
 * 改前函数级键只编码 `pathEnvPreloadFingerprint()`（mtime）⇒ `cp -p` / `tar -x`
 * / 同秒编辑（内容变、mtime 不变）时文件级缓存正确失效并重跑，函数级却命中
 * **旧的**推断类型 ⇒ 两层结论不一致。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatShape } from "@nudojs/core";
import { analyzeFileAsync } from "../analyzer.ts";
import { clearFnAnalysisCache } from "../fn-analysis-cache.ts";
import { tmpProject } from "./tmp-project.ts";

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

describe("BUG-012 — 函数级缓存对 env 内容敏感", () => {
  it("env 内容变、mtime 不变 ⇒ 第二次分析必须看到新类型（不得命中函数级旧条目）", async () => {
    const dir = tmpProject("nudo-b012-env-", {
      "package.json": JSON.stringify({ name: "p", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_NUM,
      "main.js": "export function f() { return v; }\n",
    });
    const mainPath = join(dir, "main.js");
    const envPath = join(dir, "env.ts");
    const source = readFileSync(mainPath, "utf-8");

    // 第一次：env 导出 number 1
    expect(await returnShapeOf(mainPath, source)).toBe("1");

    // 改写 env 内容，**保留 mtime**（cp -p / tar -x / 同秒编辑）
    const st = statSync(envPath);
    writeFileSync(envPath, ENV_STR);
    utimesSync(envPath, st.atime, st.mtime);

    // 第二次：同一路径同一源码 ⇒ 函数级缓存键必须因 env 内容变化而 miss
    expect(await returnShapeOf(mainPath, source)).toBe('"hello"');
  });

  it("对照组：env 内容不变 ⇒ 两次结论一致（缓存仍可命中，不引入抖动）", async () => {
    const dir = tmpProject("nudo-b012-stable-", {
      "package.json": JSON.stringify({ name: "p", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_NUM,
      "main.js": "export function f() { return v; }\n",
    });
    const mainPath = join(dir, "main.js");
    const source = readFileSync(mainPath, "utf-8");
    expect(await returnShapeOf(mainPath, source)).toBe("1");
    expect(await returnShapeOf(mainPath, source)).toBe("1");
  });
});
