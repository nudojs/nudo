/**
 * Bug 1083 —— 整文件分析缓存键里新增的「项目级 path env **内容**」维度用错了
 * **基准目录**。
 *
 * 修前：`analysisFileCacheKey` 用 `pathEnvContentFingerprint(projectEnvNames,
 * dirname(filePath))` ⇒ 项目级 env（`package.json#nudo.env: ["./env.ts"]`，文件
 * 在**项目根**）在被分析文件位于子目录（`src/app.js`）时，指纹读的是**不存在**
 * 的 `<proj>/src/env.ts` ⇒ 内容退化成 `"<unreadable>"` 的常量哈希 ⇒ 键对该 env
 * 的内容**实际不敏感**（Bug 501 想要的「env 文件内容进键」在项目根以外的文件上
 * 失效）。
 *
 * 修后：项目级 env 名按**项目根**解析（与 CLI `assembleEnvs` 同一口径）⇒
 * 指纹读的是真正的 env 文件 ⇒ 内容变 ⇒ 键 miss。
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { analysisFileCacheKey } from "../analyzer.ts";
import { tmpProject, writeTmpFile } from "./tmp-project.ts";

const CFG = {
  mode: "directives",
  evalMissingSlot: "off",
  callSiteBudget: 3,
  diagnostics: "errors",
  maxForks: 5000,
};

const ENV_V1 = `export function defineEnv() { return { globals: { MAGIC: 1 } }; }\n`;
const ENV_V2 = `export function defineEnv() { return { globals: { MAGIC: 2 } }; }\n`;

describe("Bug 1083: 项目级 path env 的内容指纹必须按项目根解析", () => {
  it("env 文件在项目根、被分析文件在子目录 ⇒ 改 env 内容必须 miss", () => {
    const dir = tmpProject("nudo-1083-env-fp-", {
      "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_V1,
      "src/app.js": `export function f() { return MAGIC; }\n`,
    });
    const app = join(dir, "src/app.js");
    const src = `export function f() { return MAGIC; }\n`;

    const k1 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    writeTmpFile(dir, "env.ts", ENV_V2);
    const k2 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);

    expect(k1.noCache).toBeFalsy();
    expect(k1.auxKey).not.toBe(k2.auxKey);
  });

  it("负控制：env 文件与被分析文件同目录（项目根 = 文件目录）时同样必须 miss", () => {
    const dir = tmpProject("nudo-1083-env-fp-same-", {
      "package.json": JSON.stringify({ name: "proj", nudo: { env: ["./env.ts"] } }),
      "env.ts": ENV_V1,
      "app.js": `export function f() { return MAGIC; }\n`,
    });
    const app = join(dir, "app.js");
    const src = `export function f() { return MAGIC; }\n`;

    const k1 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);
    writeTmpFile(dir, "env.ts", ENV_V2);
    const k2 = analysisFileCacheKey(app, src, undefined, undefined, CFG, undefined, ["./env.ts"]);

    expect(k1.auxKey).not.toBe(k2.auxKey);
  });
});
