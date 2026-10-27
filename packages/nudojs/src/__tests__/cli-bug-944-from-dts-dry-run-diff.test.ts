/**
 * Bug 944（续）—— `nudo contract --from-dts --write --dry-run` 的预览是
 * **整份草稿正文的 dump**，不是 unified diff；且「既有草稿不同 ⇒ 拒绝覆盖」
 * 那一关跑在 dry-run 分支**之前** ⇒ dry-run 遇到既有草稿**直接报错退出**，
 * **连 diff 都看不到**。
 *
 * 改后（同一片修）：
 * ① dry-run 打 **unified diff**（对照面 = 既有草稿文件的磁盘内容；文件不存在
 *    ⇒ 对空串求 diff ⇒ 整份都是新增行），**不再**倾倒草稿全文；
 * ② 标签行 `[dry-run] would write <path>` 保留（用户仍看得到目标路径）；
 * ③ dry-run 的**退出码与真写盘同口径**：真写会被拒（既有草稿不同且无
 *    `--force` / 人工改过的草稿即使有 `--force`）⇒ dry-run 也 exit 1，但
 *    **预览照打**（diff 仍然可见）；会写成功 ⇒ exit 0；
 * ④ dry-run **绝不写盘**（既有草稿逐字不变、新草稿不被创建）。
 *
 * ⚠ 夹具全部写在临时目录里（cwd = 临时目录），`finally` 里清理；夹具里写
 *   `writeSrcTsconfig`（CLI 子进程按 cwd 找 tsconfig，否则 `@nudojs/*` 落到
 *   `<pkg>/dist` 的旧构建 ⇒ 断言会测到陈旧实现）。夹具**不**依赖
 *   `package.json`（`--from-dts` 的落点贴着源 `.d.ts`，不需要项目根）。
 */
import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 新的机器草稿里 `mul` 那一行（harvester 的 fn() DSL 口径） */
const MUL_LINE = "export const mul = fn({ a: number(), b: number() }, number());";

/** 既有草稿：与新生成的内容**不同**（无指纹 ⇒ 会被判成人工改过） */
const EXISTING_DRAFT = `// @nudo:draft
// 人工留存的既有草稿（与新生成的内容不同）
`;

/** 落盘路径（贴着源 `.d.ts`，`sidecarDraftPath` 口径） */
const DRAFT_REL = "types/index.nudo.draft.ts";

/** 夹具：`types/index.d.ts`；`fn` 在 try/finally 里跑（临时目录必定清理）。 */
function withFixture(fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-dry-run-"));
  try {
    writeSrcTsconfig(dir);
    mkdirSync(join(dir, "types"), { recursive: true });
    writeFileSync(join(dir, "types", "index.d.ts"), DTS, "utf-8");
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** stdout 里所有含 `needle` 的行（用来判「是不是全文 dump」） */
function linesWith(stdout: string, needle: string): string[] {
  return stdout.split("\n").filter((l) => l.includes(needle));
}

describe("nudo contract --from-dts --write --dry-run · Bug 944（续）· unified diff 预览", () => {
  it("无既有草稿 ⇒ exit 0，打 unified diff（不再是全文 dump），且**不建**草稿文件", () => {
    withFixture((dir) => {
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
      });

      expect(r.status).toBe(0);
      // 标签行保留：用户仍看得到目标路径
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      // diff 头与 `--emit --dry-run` / `--draft --write --dry-run` **同形**
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      // 真正的 hunk（文件不存在 ⇒ 对照面是空串 ⇒ 整份都是新增行）
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 改前：stdout 是整份草稿正文的 dump ⇒ 这些行**不带** diff 前缀也出现
      for (const needle of ["export const mul", 'from "@nudojs/core"', "// @nudo:draft"]) {
        const hits = linesWith(r.stdout, needle);
        expect(hits.length, `stdout 里应出现 ${needle}`).toBeGreaterThan(0);
        expect(
          hits.every((l) => l.startsWith("+")),
          `「${needle}」只能以新增行（+）出现 —— 不得出现无前缀的全文 dump`,
        ).toBe(true);
      }
      // dry-run **不写盘**
      expect(existsSync(join(dir, DRAFT_REL))).toBe(false);
    });
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("既有草稿不同 + 无 --force ⇒ exit 1（与真写同口径），**仍**打 diff + 报拒绝 + 文件逐字不变", () => {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 环境变量通道也算「force」⇒ 显式置空，免得开发机的 NUDO_DRAFT_FORCE=1
      // 把「无 --force ⇒ 拒绝」这一钉变成假绿（断言本身不变）。
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      // 退出码镜像真写：真写会拒绝 ⇒ dry-run 也 1（不得静默 0 谎报「会写」）
      expect(r.status).toBe(1);
      // 预览仍然可见：标签行 + diff 头 + 新增行
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+++ b/${DRAFT_REL}`);
      expect(r.stdout).toContain(`+${MUL_LINE}`);
      // 拒绝理由仍然报出来（与真写同一套文案）
      expect(r.stderr).toContain("refusing to overwrite");
      expect(r.stderr).toContain(DRAFT_REL);
      // dry-run 绝不写盘：既有草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
    });
  }, 60000); // 1 个 CLI 子进程

  it("人工改过的草稿 + `--force` ⇒ exit 1（force 也放行不了），diff 照打、文件逐字不变", () => {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      // 先真写一次机器原稿，再人工改动正文 ⇒ 指纹失配
      const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
      expect(first.status).toBe(0);
      const machine = readFileSync(draftPath, "utf-8");
      expect(machine).toContain("@nudo:draft-fingerprint");
      const handEdited = `${machine}// 人工改动\n`;
      writeFileSync(draftPath, handEdited, "utf-8");

      const r = runCli(
        ["contract", "--from-dts", "types/index.d.ts", "--write", "--dry-run", "--force"],
        { cwd: dir },
      );

      // 真写会被拒（hand-edited 通道，force 放行不了）⇒ dry-run 也 1
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("hand-edited");
      // 预览照打：标签行 + diff（被删掉的人工行是 diff 的一部分）
      expect(r.stdout).toContain(`[dry-run] would write ${DRAFT_REL}`);
      expect(r.stdout).toContain(`--- a/${DRAFT_REL}`);
      expect(r.stdout).toMatch(/^@@ /m);
      expect(r.stdout).toContain("-// 人工改动");
      // 人工改过的草稿逐字不变
      expect(readFileSync(draftPath, "utf-8")).toBe(handEdited);
    });
  }, 120000); // 2 个顺序 CLI 子进程

  it("负控制：真写（无 --dry-run）遇既有不同草稿仍 exit 1、文件逐字不变，且**不打** diff", () => {
    withFixture((dir) => {
      const draftPath = join(dir, DRAFT_REL);
      writeFileSync(draftPath, EXISTING_DRAFT, "utf-8");

      // 同上一钉：显式置空 NUDO_DRAFT_FORCE（环境变量也是 force 通道）
      const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
        cwd: dir,
        env: { NUDO_DRAFT_FORCE: "" },
      });

      expect(r.status).toBe(1);
      expect(r.stderr).toContain("refusing to overwrite");
      // 既有草稿逐字不变（真写的保证）
      expect(readFileSync(draftPath, "utf-8")).toBe(EXISTING_DRAFT);
      // 没有谎报成功，也没有把 diff 预览塞进真写面
      expect(r.stdout).not.toContain("wrote ");
      expect(r.stdout).not.toContain("--- a/");
    });
  }, 60000); // 1 个 CLI 子进程
});
