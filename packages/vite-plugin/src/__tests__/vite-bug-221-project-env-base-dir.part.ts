/**
 * BUG-221 回归（vite-plugin 构建期）：**项目级** env（`package.json#nudo.env`）
 * 的**相对说明符**必须按**项目根**解析，而不是被 `env-loader` 的「进程级
 * 单槽基准」（= **最后一次** preload 的目录）带走。
 *
 * 病灶：`buildViteCheckInjection` 直接把 `collectEnvNames(..., true)` 的
 * **原始**名单喂给 `collectEnvGlobals` / `collectEnvModules`。service 的
 * preload 顺序是「项目级 → 文件级」⇒ 被检文件里只要有一行**文件级**
 * `@nudo:env`，解析基准就落在**文件目录** ⇒ 项目级 `"./env/web.ts"` 被解析成
 * `<fileDir>/env/web.ts` ⇒ 项目级全局（`MAGIC`）丢失 ⇒ 门禁面报
 * `may throw ReferenceError` / `never`，而**同一文件**的 evaluator 面仍是
 * `99` ⇒ 同一个插件的两个面互相打脸；且**多加一行无关的 `@nudo:env`** 就让
 * 结论从绿翻红（非单调）。CLI 全程绿（`assembleEnvs` 先按项目根绝对化）。
 *
 * 修法（`packages/vite-plugin/src/check-assembly.ts`）：项目级说明符先按
 * `findProjectConfig(...)?.projectDir ?? dirname(id)` 绝对化，再与文件级名单
 * 合并（与 CLI `assembleEnvs` 同款）。
 *
 * 负控制：项目**没有**声明该 env 时，`MAGIC` 仍必须报 `ReferenceError`
 * （门禁不得被整体关掉 —— 证明上面的「无诊断」不是因为 env 面被静音）。
 */
import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";
import nudoPlugin from "../index.ts";

/** Vite hooks may be fn or ObjectHook{handler}; tests need a direct callable. */
function hookFn(h: unknown): (...args: never[]) => unknown {
  if (typeof h === "function") return h as (...args: never[]) => unknown;
  if (h && typeof h === "object" && "handler" in h && typeof (h as { handler?: unknown }).handler === "function") {
    return (h as { handler: (...args: never[]) => unknown }).handler;
  }
  throw new Error("hook not callable");
}

function transformOf(plugin: Plugin) {
  return hookFn(plugin.transform) as (this: unknown, code: string, id: string) => Promise<unknown>;
}

const ENV_SRC = `export function defineEnv() {
  return { globals: { MAGIC: 99 } };
}
`;
const LOCAL_ENV_SRC = `export function defineEnv() {
  return { globals: { LOCAL: 1 } };
}
`;
/** 文件级 `//nudo:env` 只提供 `LOCAL` —— 与 `MAGIC` **无关**（非单调的开关）。 */
const FILE_ENV_LINE = `/// @nudo:env ./local-env.ts\n`;
const APP_SRC = `export function f() {
  return MAGIC;
}
`;

type Run = { warns: string[]; errors: string[]; all: string };

/** 建一个项目；`projectEnv` 省略 ⇒ 项目**不**声明任何 env。 */
function project(fileEnvLine: string, projectEnv?: string[]): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-vite-bug-221-"));
  mkdirSync(join(dir, "src"), { recursive: true });
  mkdirSync(join(dir, "env"), { recursive: true });
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "nudo-vite-bug-221",
      private: true,
      type: "module",
      ...(projectEnv ? { nudo: { env: projectEnv } } : {}),
    }),
    "utf-8",
  );
  writeFileSync(join(dir, "env", "web.ts"), ENV_SRC, "utf-8");
  writeFileSync(join(dir, "src", "local-env.ts"), LOCAL_ENV_SRC, "utf-8");
  const file = join(dir, "src", "a.js");
  writeFileSync(file, fileEnvLine + APP_SRC, "utf-8");
  return { dir, file };
}

async function run(dir: string, file: string, code: string): Promise<Run> {
  const plugin = nudoPlugin();
  // 工程根：插件的 `configResolved` 落点（与真实构建一致）
  (plugin.configResolved as (c: { root: string }) => void)?.call({}, { root: dir });
  const warns: string[] = [];
  const errors: string[] = [];
  const ctx = {
    warn: (m: string) => warns.push(String(m)),
    error: (m: string) => errors.push(String(m)),
    info: () => {},
  };
  await transformOf(plugin).call(ctx, code, file);
  return { warns, errors, all: [...warns, ...errors].join("\n") };
}

describe("BUG-221: 项目级 env 按项目根解析（插件两个面同结论、非单调性消失）", () => {
  it("无文件级 @nudo:env ⇒ 不报 ReferenceError（基线，一直是对的）", async () => {
    const { dir, file } = project("", ["./env/web.ts"]);
    try {
      const r = await run(dir, file, APP_SRC);
      expect(r.all).not.toContain("ReferenceError");
      expect(r.all).not.toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("加一行**无关**的文件级 @nudo:env ⇒ 结论不变（不再绿翻红）", async () => {
    const { dir, file } = project(FILE_ENV_LINE, ["./env/web.ts"]);
    try {
      const r = await run(dir, file, FILE_ENV_LINE + APP_SRC);
      expect(r.all).not.toContain("ReferenceError");
      expect(r.all).not.toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("两个场景的诊断集合逐项相同（单调）", async () => {
    const a = project("", ["./env/web.ts"]);
    const b = project(FILE_ENV_LINE, ["./env/web.ts"]);
    try {
      const ra = await run(a.dir, a.file, APP_SRC);
      const rb = await run(b.dir, b.file, FILE_ENV_LINE + APP_SRC);
      // 消息里带绝对路径 ⇒ 逐条对拍前先把各自的临时项目根归一
      const norm = (text: string, dir: string) => text.split(dir).join("<PROJECT>");
      expect(norm(rb.all, b.dir)).toBe(norm(ra.all, a.dir));
    } finally {
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });

  it("负控制：项目未声明该 env ⇒ MAGIC 仍报 ReferenceError（门禁未被关掉）", async () => {
    const { dir, file } = project("", undefined);
    try {
      const r = await run(dir, file, APP_SRC);
      expect(r.all).toContain("ReferenceError");
      expect(r.all).toContain("nudo:entry-may-throw");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
