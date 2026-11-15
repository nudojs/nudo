/**
 * Bug 502：@nudo:env 的 globals 必须进入 service 的分析面。
 *
 * 口径：env globals 由 collectEnvGlobals(envNames) 统一物化——
 *   - 命名 env（node / es / web）：同步可见
 *   - path 型 env（`/// @nudo:env ./env.ts`）：需先 preload（analyzeFileAsync
 *     预载后同步面才可见）——同步面看不到时保持"无信息"（fail-closed），
 *     不假装有类型。
 *
 * 本测试锁住：
 *   ① 分析环境（globalEnv → buildNodeTypeMap 的节点类型面）带上 env globals
 *   ② 异步入口（唯一预载 path 型 env 的入口）解析出 env 全局值
 *
 * 注：IDE 诊断面的假红（`nudo:entry-may-throw: may throw ReferenceError`）
 * 根因在 LSP 侧 checkSource 未注入 envGlobals（packages/lsp/src/validation.ts，
 * 归 L 分片）——见本轮报告的越界项。
 */
import { describe, it, expect } from "vitest";
import { analyzeFile, analyzeFileAsync } from "../analyzer.ts";
import { formatAbs } from "@nudojs/core";
import { tmpProject } from "./tmp-project.ts";

const ENV_FILE = `export function defineEnv() {
  return { globals: { MAGIC: 1 } };
}
`;

const MAIN_FILE = `/// @nudo:env ./env.ts
export function useGlobal() {
  return MAGIC;
}
`;

describe("Bug 502 — @nudo:env globals reach the service analysis", () => {
  it("async entry (preloads path env) resolves env globals", async () => {
    const dir = tmpProject("nudo-b502-", { "env.ts": ENV_FILE, "main.js": MAIN_FILE });
    const path = `${dir}/main.js`;
    const r = await analyzeFileAsync(path, MAIN_FILE);
    const fn = r.functions.find((f) => f.name === "useGlobal");
    expect(fn).toBeDefined();
    const c = fn!.cases.find((x) => x.name.startsWith("entry@") || x.name.startsWith("call@"));
    expect(c).toBeDefined();
    expect(formatAbs(c!.abs)).toContain("1");
    expect(formatAbs(c!.abs)).not.toContain("never");
  });

  it("analysis environment carries env globals (node type face)", () => {
    // 命名 env 同步可见；eval 未宿主（顶层抛错 → fail-closed）时走
    // buildNodeTypeMap 面——env 全局按 env.lookup 拿到 Abs 类型
    const src = `/// @nudo:env node
throw new Error("boom");
export function useProcess() { return process.cwd(); }
`;
    const r = analyzeFile("/t/b502/env-globals.js", src);
    const names: string[] = [];
    for (const [node] of r.nodeAbsMap) {
      if (node.type === "Identifier") names.push(node.name);
    }
    expect(names).toContain("process");
  });
});
