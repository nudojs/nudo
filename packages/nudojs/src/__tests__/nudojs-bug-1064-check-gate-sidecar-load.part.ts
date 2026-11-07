/**
 * Bug 1064 —— 侧车写坏（import 了非构建器名）时，`nudo check` **门禁绿灯、
 * exit 0**（假绿），而 `nudo test` / `nudo health` 都报 error。
 *
 * 根因在 core（`packages/core/src/algebra/refine.ts`）：侧车装载诊断在
 * `execSidecar` 内部产生 ⇒ exec 结果进缓存后，缓存命中不再跑 exec ⇒ 诊断
 * 在后续分析里消失。CLI 的固定顺序是「分析器先跑（冷，拿到诊断）→
 * checkSource 后跑（缓存命中，诊断消失）」⇒ check 门禁面看不到侧车写坏。
 *
 * 修复（core）：装载诊断随 exec 结果缓存，缓存命中时重发 ⇒ checkSource
 * 自己上报一份 `nudo:interface-load`（nudojs 面的分析器白名单**刻意**不含
 * 该码 —— 避免双报，见 check-json-map.ts 的 CHECK_FACE_DIAG_CODES）。
 *
 * **进程内**驱动（不经 dist）：vitest 别名把 `@nudojs/core` 指到 src ⇒
 * 核心修复立即可见；子进程型 CLI 测试会走 packages/core/dist（旧产物）
 * ⇒ 需先 build 才可见核心侧改动。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

import { registerCheckCommand } from "../commands/check-command.ts";

const SRC = "export function f(x) {\n  return x;\n}\n";
/** 侧车 import 了非构建器名 totallyBogus ⇒ 装载期 nudo:interface-load */
const BAD_SIDECAR = `import { fn, number, totallyBogus } from "@nudojs/core";
export const f = fn({ x: number() });
`;

let logs: string[] = [];
let errs: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
  logs = [];
  errs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errs.push(a.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

async function runCheckCli(args: string[]): Promise<void> {
  const program = new Command();
  registerCheckCommand(program);
  await program.parseAsync(["node", "nudo", ...args]);
}

function makeProject(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug1064-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "bug1064", private: true, type: "module" }),
    "utf-8",
  );
  const file = join(dir, "lib.js");
  writeFileSync(file, SRC, "utf-8");
  writeFileSync(join(dir, "lib.nudo.js"), BAD_SIDECAR, "utf-8");
  return { dir, file };
}

describe("bug 1064: 侧车写坏 ⇒ check 门禁必须红（nudo:interface-load）", () => {
  it("人类面：check 报 interface-load error + exit 1（旧行为：exit 0 假绿）", async () => {
    const { dir, file } = makeProject();
    try {
      await runCheckCli(["check", file]);
      const out = logs.join("\n");
      expect(out).toContain("nudo:interface-load");
      expect(out).toContain("is not an injected builder");
      expect(process.exitCode, "侧车写坏 ⇒ 门禁必须红").toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--json 面：信封 ok:false + issues 含 nudo:interface-load（且只一条）", async () => {
    const { dir, file } = makeProject();
    try {
      await runCheckCli(["check", file, "--json"]);
      const env = JSON.parse(logs.join("\n")) as {
        ok: boolean;
        // 单文件无路径错误 ⇒ 直出 CheckJson；多文件/路径错误 ⇒ multi 信封
        issues?: Array<{ code: string }>;
        reports?: Array<{ issues?: Array<{ code: string }> }>;
      };
      expect(env.ok).toBe(false);
      const issues = env.issues ?? env.reports?.[0]?.issues ?? [];
      expect(issues.filter((i) => i.code === "nudo:interface-load")).toHaveLength(1);
      expect(process.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
