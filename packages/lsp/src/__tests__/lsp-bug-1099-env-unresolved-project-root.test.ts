/**
 * Bug 1099 —— LSP 的 `nudo:env-unresolved` 诊断**只取文件目录**的失败记录
 * ⇒ **项目级** env（`package.json#nudo.env`，按**项目根**解析）的加载失败
 * 被静默吞掉 ⇒ IDE 假绿（诊断不可见），且与 CLI 面口径分裂。
 *
 * 机制：`preloadPathEnvs` 记录的失败条目按它自己的 `baseDir` 实参归档
 * （`recordPathEnvError(path, baseDir, e)`），`getPathEnvLoadErrors(baseDir)`
 * 按 baseDir 过滤 ⇒ 项目级 env 的失败记在**项目根**下，而
 * `envUnresolvedDiags` 只取**文件目录**的失败 ⇒ 取不到 ⇒ 零诊断。
 * （该诊断此前**只在文件恰好位于项目根目录时**可见。）
 *
 * 口径（与 CLI `packages/nudojs/src/commands/check.ts` 同款）：两层基准各取一次
 * ——文件级按**文件目录**、项目级按**项目根**——合并去重后按**两层候选路径的
 * 并集**过滤。
 *
 * 钉：
 * ④ 项目根下的项目级 env 失败 ⇒ 子目录文件也必须报（路径指向**项目根**下
 *    解析出的真实路径，不得是文件目录下的臆造路径）；
 * ⑤ 项目根下的文件 ⇒ 诊断**仍可见**（不得因修复而丢失）；
 * ⑥ 文件级 env（按文件目录解析）语义**不受影响**。
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clearPathEnvCaches } from "@nudojs/service";
import { envUnresolvedDiags, validateText, type LspDiagnostic } from "../validation.ts";

const PROBE = `export function f(x) { return x; }
`;

/** 项目级 env 指向的缺失文件（项目根下）。 */
const PROJECT_ENV_MISSING = "./nope.mjs";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时项目（package.json + 若干文件）；返回项目根。 */
function makeProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-lsp-1099-"));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf-8");
  }
  return dir;
}

/** 项目级 env 配置（项目根）。 */
function projectPkg(env: string[]): string {
  return JSON.stringify({ name: "envproj", private: true, nudo: { env } });
}

/** env-unresolved 诊断（其它诊断不算）。 */
function envMsgs(diags: LspDiagnostic[]): string[] {
  return diags
    .filter((d) => d.code === "nudo:env-unresolved")
    .map((d) => (typeof d.message === "string" ? d.message : d.message.value));
}

describe("Bug 1099: 项目级 env 的加载失败必须在 LSP 面可见（路径按项目根）", () => {
  beforeEach(() => {
    // 进程级 live 记录是全局的 ⇒ 每例前清干净（否则跨例串台）
    clearPathEnvCaches();
  });

  it("④ 子目录文件：项目级 env 缺失 ⇒ 必须报 nudo:env-unresolved（路径在项目根）", async () => {
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "src/probe.js": PROBE,
    });
    const file = join(dir, "src/probe.js");

    const msgs = envMsgs(await envUnresolvedDiags(file, PROBE));
    expect(msgs.length).toBeGreaterThan(0);
    // 路径 = **项目根**下解析出的真实路径
    expect(msgs.join("\n")).toContain(join(dir, "nope.mjs"));
    // 不得是「按文件目录解析」的臆造路径
    expect(msgs.join("\n")).not.toContain(join(dir, "src", "nope.mjs"));
  });

  it("⑤ 项目根下的文件：诊断仍可见（不得因修复而丢失）", async () => {
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "probe.js": PROBE,
    });
    const file = join(dir, "probe.js");

    const msgs = envMsgs(await envUnresolvedDiags(file, PROBE));
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs.join("\n")).toContain(join(dir, "nope.mjs"));
  });

  it("⑥ 文件级 env（按文件目录解析）语义不受影响 + 项目级按项目根", async () => {
    const src = `/// @nudo:env ./local.mjs\n${PROBE}`;
    const dir = makeProject({
      "package.json": projectPkg([PROJECT_ENV_MISSING]),
      "src/probe.js": src,
    });
    const file = join(dir, "src/probe.js");

    const joined = envMsgs(await envUnresolvedDiags(file, src)).join("\n");
    // 文件级 env 缺失 ⇒ 路径在**文件目录**下
    expect(joined).toContain(join(dir, "src", "local.mjs"));
    // 项目级 env 缺失 ⇒ 路径在**项目根**下
    expect(joined).toContain(join(dir, "nope.mjs"));
  });

  it("IDE push 面：项目级 env 可见 ⇒ 不得发布 builtin-unknown 假阳（Bug 1098 同源）", async () => {
    const src = `/// @nudo:env node\nexport function f() { return MAGIC; }\n`;
    const dir = makeProject({
      "package.json": projectPkg(["./env.mjs"]),
      "env.mjs": `export function defineEnv() { return { globals: { MAGIC: 42 } }; }\n`,
      "src/app.js": src,
    });
    const file = join(dir, "src/app.js");

    const sent: LspDiagnostic[] = [];
    await validateText(file, `file://${file}`, src, 1, {
      sendDiagnostics: (p) => {
        sent.push(...p.diagnostics);
      },
    });
    const codes = sent.map((d) => d.code);
    // `MAGIC` 是 env 全局 ⇒ 不得报「内建 API 未覆盖」（修前 IDE 直接发布假阳）
    expect(codes).not.toContain("nudo:builtin-unknown");
    // 注：LSP **check 通道**的项目级 env 绝对化已由 Bug 1104（`absolutizeEnvSpec`）
    // 修好 ⇒ 项目级 env 在该通道同样可见，不再是 IDE 红 / CLI 绿的假红来源。
  });
});
