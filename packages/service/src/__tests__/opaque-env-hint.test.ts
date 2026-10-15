/**
 * nudo:opaque-result 的 remediation hint 分流（DX）：
 * - 文件 import/require 了内置模块（node: 前缀或 node:module isBuiltin 名单
 *   ——@nudojs/env 模块面的可得超集）且无任何 env 生效（无 /// @nudo:env、
 *   无 inject envGlobals）→ hint 指向 env 声明（may/declare 口径，不做过诺）；
 * - 有 env（CLI buildCheckInjection 同口径注入后 native 调用可推断）、
 *   env 已声明（如 es）但不含该模块面、非内置模块 import、纯自包含 opaque
 *   → 维持原始 hint。
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkSource,
  pTrue,
  extractFileEnvNames,
  resetCheckSourceMemo,
  resetGeneralizeMemo,
  formatAbs,
  type RunTranspiledOptions,
} from "@nudojs/core";
import { collectEnvGlobals, collectEnvModules } from "../eval-run.ts";

const ORIGINAL_HINT = "add @nudo:case or a call site";
const ENV_HINT =
  "declare the runtime env to type native modules: '/// @nudo:env node' (or web/es) — see guides/env-harvest.md";

beforeEach(() => {
  resetCheckSourceMemo();
  resetGeneralizeMemo();
});

/** 与 CLI buildCheckInjection 同口径：文件 env 名 → envGlobals + env 模块表注入 */
function cliLikeEnvOpts(source: string): { modules: RunTranspiledOptions["modules"]; inject: RunTranspiledOptions } {
  const envNames = extractFileEnvNames(source);
  const inject: RunTranspiledOptions = {
    envGlobals: collectEnvGlobals(envNames),
    modules: collectEnvModules(envNames),
  };
  return { modules: inject.modules, inject };
}

const DEP_SRC = `import { join } from "node:path";
import fs from "node:fs";

export function safeJoin(base, rel) {
  return join(base, rel);
}

export function readCfg(p) {
  return fs.readFileSync(p, "utf8");
}
`;

const DEP7_SRC = `/// @nudo:env node
import { join } from "node:path";

export function safeJoin(base, rel) {
  return join(base, rel);
}
`;

describe("nudo:opaque-result hint 分流", () => {
  it("dep.js 形态（import node:path/node:fs、无 env）→ hint 指向 env 声明", () => {
    const r = checkSource("/t/dep-opaque-hint.js", DEP_SRC, pTrue);
    const safeJoin = r.issues.find((i) => i.code === "nudo:opaque-result" && i.fn === "safeJoin");
    expect(safeJoin).toBeDefined();
    expect(safeJoin!.suggestion).toBe(ENV_HINT);
    // 同文件其它 opaque 函数共用同一分流
    const readCfg = r.issues.find((i) => i.code === "nudo:opaque-result" && i.fn === "readCfg");
    expect(readCfg).toBeDefined();
    expect(readCfg!.suggestion).toBe(ENV_HINT);
  });

  it("dep7.js 形态（/// @nudo:env node、CLI 同口径注入）→ 无 opaque issue 且签名可推断", () => {
    const r = checkSource("/t/dep7-opaque-hint.js", DEP7_SRC, pTrue, cliLikeEnvOpts(DEP7_SRC));
    expect(r.issues.some((i) => i.code === "nudo:opaque-result")).toBe(false);
    const sig = r.signatures.find((s) => s.name === "safeJoin");
    expect(sig).toBeDefined();
    expect(formatAbs(sig!.abs)).toContain("string");
  });

  it("env 已声明但不含该模块面（es + node:path）→ 维持原 hint，不重复建议 env", () => {
    const src = `/// @nudo:env es
import { join } from "node:path";
export function j(base, rel) {
  return join(base, rel);
}
`;
    const r = checkSource("/t/es-opaque-hint.js", src, pTrue, cliLikeEnvOpts(src));
    const j = r.issues.find((i) => i.code === "nudo:opaque-result" && i.fn === "j");
    expect(j).toBeDefined();
    expect(j!.suggestion).toBe(ORIGINAL_HINT);
  });

  it("非内置模块 import（npm 包）→ 维持原 hint", () => {
    const src = `import createLogger from "debug";
export function lg(namespace) {
  return createLogger(namespace);
}
`;
    const r = checkSource("/t/npm-opaque-hint.js", src, pTrue);
    const lg = r.issues.find((i) => i.code === "nudo:opaque-result" && i.fn === "lg");
    expect(lg).toBeDefined();
    expect(lg!.suggestion).toBe(ORIGINAL_HINT);
  });

  it("纯自包含 opaque（无 import，fetch host-effect）→ 维持原 hint", () => {
    const src = `export function fetchDoc(url) {
  return fetch(url);
}
`;
    const r = checkSource("/t/self-opaque-hint.js", src, pTrue);
    const f = r.issues.find((i) => i.code === "nudo:opaque-result" && i.fn === "fetchDoc");
    expect(f).toBeDefined();
    expect(f!.suggestion).toBe(ORIGINAL_HINT);
  });
});
