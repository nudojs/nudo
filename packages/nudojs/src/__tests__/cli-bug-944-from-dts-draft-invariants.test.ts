// GENERATED MERGE (scripts/tmp-merge-bugs.mjs): cli-bug-944-from-dts-draft-invariants.test.ts + cli-bug-944-from-dts-dry-run-diff.test.ts + cli-bug-944-from-dts-write-path.test.ts
// Each absorbed file keeps its own describe scope so file-level hooks stay
// local. Test titles are unchanged; run one with: pnpm vitest run <this> -t <name>
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCliTsx as runCli, writeSrcTsconfig } from "./helpers/run-cli.ts";

describe("[merged] cli-bug-944-from-dts-draft-invariants.test.ts", () => {
/**
 * `--from-dts --write` 的**草稿落点族**不变量（族 20 · Bug 944 / 1147 的
 * 收口回归；与 `cli-bug-944-from-dts-write-path.test.ts` /
 * `nudojs-bug-1147-contract-cli-text.test.ts` 互补 —— 那两处钉的是
 * 「用例意图」，这里钉的是**规则本身**）。
 *
 * 钉：
 * ① 落点**贴着源 `.d.ts`**（`sidecarDraftPath` 口径）⇒ **不以 CWD 为基准**
 *    ⇒ CWD 里的同名草稿不会被静默覆盖；
 * ② 落点名的 basename **不含 `.d.`**（BUG-264：`tmp/bug-report/sections/
 *    BUG-264.md` + `.changeset/fix-bug-cat-09-cli-check.md`）—— basename 含
 *    `.d.` ⇒ TypeScript 的 `getDeclarationFileExtension` 判它是**声明文件**
 *    ⇒ 草稿与工具建议的复制落点都过不了 `tsc --strict`（TS1254）⇒
 *    「next」提示点名的侧车路径同样不得含 `.d.`；
 * ③ 既有草稿**存在且内容不同** ⇒ **拒绝覆盖**（exit 1）+ 提示，提示**同时**
 *    给出两个放行口子（CLI 旗标 `--force` **与** 环境变量 `NUDO_DRAFT_FORCE`）
 *    并说明「人工改过的草稿永不被覆盖」；
 * ④ 放行口子是真的：**机器原稿**（内容不同）+ `--force` / `NUDO_DRAFT_FORCE=1`
 *    ⇒ 覆盖成功；**人工改过的草稿** ⇒ `--force` 也**不放行**（逐字不变）。
 */






const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：`types/index.d.ts`（源）+ CWD 里另一个文件的既有草稿 */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-from-dts-inv-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  // CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖
  writeFileSync(join(dir, "index.nudo.draft.js"), "// @nudo:draft\n// 别的文件的草稿\n", "utf-8");
  return dir;
}

/** 落点（贴着源 `.d.ts`；BUG-264：basename 不含 `.d.`） */
function draftPathOf(dir: string): string {
  return join(dir, "types", "index.nudo.draft.ts");
}

describe("nudo contract --from-dts --write · 草稿落点族不变量", () => {
  it("落点贴着源 `.d.ts`，且 basename **不含 `.d.`**（BUG-264）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    const draft = draftPathOf(dir);
    expect(existsSync(draft)).toBe(true);
    // BUG-264：basename 含 `.d.` ⇒ TypeScript 判成声明文件 ⇒ 草稿过不了 tsc
    expect(basename(draft)).not.toContain(".d.");
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // 不以 CWD 为基准 ⇒ CWD 里**没有**同名新草稿，别的文件的草稿逐字不变
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(
      "// @nudo:draft\n// 别的文件的草稿\n",
    );
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("「next」提示点名的侧车路径也**不含 `.d.`**（建议的复制落点必须可编译）", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
    // BUG-264：旧名 `types/index.d.nudo.ts` 过不了 `tsc --strict`（TS1254）
    expect(r.stdout).not.toContain("types/index.d.nudo.ts");
  }, 60000); // 1 个 CLI 子进程

  it("既有草稿存在且内容不同 ⇒ 拒绝覆盖（exit 1）+ 提示**同时**给出两个放行口子", () => {
    const dir = makeFixture();
    const draft = draftPathOf(dir);
    const existing = "// @nudo:draft\n// 人工留存的既有草稿（与新生成的内容不同）\n";
    writeFileSync(draft, existing, "utf-8");

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(1);
    expect(r.stderr).toContain("refusing to overwrite");
    // 提示**点名**目标落点（用户知道该去哪儿看）
    expect(r.stderr).toContain("types/index.nudo.draft.ts");
    // 两个放行口子都可见（旗标 + 环境变量）
    expect(r.stderr).toContain("--force");
    expect(r.stderr).toContain("NUDO_DRAFT_FORCE");
    // 措辞要准：人工改过的草稿永不被覆盖 ⇒ 这条拒绝是预期行为
    expect(r.stderr).toContain("hand-edited");
    // 既有草稿逐字不变 + 没有谎报成功
    expect(readFileSync(draft, "utf-8")).toBe(existing);
    expect(r.stdout).not.toContain("wrote ");
  }, 60000); // 1 个 CLI 子进程

  it("内容未变 ⇒ **不**拒绝（exit 0 + 「draft unchanged」）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const written = readFileSync(draftPathOf(dir), "utf-8");

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("draft unchanged");
    expect(readFileSync(draftPathOf(dir), "utf-8")).toBe(written);
  }, 60000); // 2 个顺序 CLI 子进程

  it("机器原稿（内容不同）+ `--force` ⇒ 覆盖成功", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    // 源 `.d.ts` 变了 ⇒ 新草稿内容不同（但仍是机器原稿 ⇒ 可覆盖）
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }, 60000); // 2 个顺序 CLI 子进程

  it("机器原稿（内容不同）+ `NUDO_DRAFT_FORCE=1` ⇒ 覆盖成功（环境变量口子同样是真的）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const machine = readFileSync(draftPathOf(dir), "utf-8");
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], {
      cwd: dir,
      env: { NUDO_DRAFT_FORCE: "1" },
    });

    expect(second.status).toBe(0);
    expect(second.stdout).toContain("wrote ");
    const after = readFileSync(draftPathOf(dir), "utf-8");
    expect(after).not.toBe(machine);
    expect(after).toContain("export const div");
  }, 60000); // 2 个顺序 CLI 子进程

  it("人工改过的草稿 ⇒ `--force` **也不放行**（逐字不变 + exit 1）", () => {
    const dir = makeFixture();
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = draftPathOf(dir);
    const machine = readFileSync(draft, "utf-8");
    expect(machine).toContain("@nudo:draft-fingerprint");
    // 人工改过正文 ⇒ 指纹失配 ⇒ 判定为「人工改过」
    const handEdited = `${machine}\n// 人工改动\n`;
    writeFileSync(draft, handEdited, "utf-8");

    const second = runCli(
      ["contract", "--from-dts", "types/index.d.ts", "--write", "--force"],
      { cwd: dir },
    );

    expect(second.status).toBe(1);
    expect(second.stderr).toContain("hand-edited");
    expect(readFileSync(draft, "utf-8")).toBe(handEdited);
    expect(second.stdout).not.toContain("wrote ");
  }, 60000); // 2 个顺序 CLI 子进程
});
});

describe("[merged] cli-bug-944-from-dts-dry-run-diff.test.ts", () => {
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
});

describe("[merged] cli-bug-944-from-dts-write-path.test.ts", () => {
/**
 * Bug 944 —— `nudo contract --from-dts --write` 把草稿写进 **CWD**
 * （不是源 `.d.ts` 旁边）且**无条件覆盖** ⇒ 静默覆盖同基名的**另一个文件**的
 * 草稿，零告警、exit 0。
 *
 * 钉（族 20 · 片 C）：
 * ① 输出路径**贴着源 `.d.ts`**（`sidecarDraftPath` 口径，与 `--draft --write`
 *    同款）⇒ **不再**以 CWD 为基准 ⇒ CWD 里的同名草稿**逐字不变**；
 * ② 写盘前做**存在性检查**（已存在且内容不同 ⇒ **拒绝覆盖** + 提示、exit 1）;
 * ③ 写盘**复用** service 的写盘助手（五重保护）；
 * ④ 「next」提示**点名目标侧车路径**。
 *
 * ⚠ 落点名的 `.d.` 段按 **BUG-264**（`tmp/bug-report/sections/BUG-264.md`
 *   + `.changeset/fix-bug-cat-09-cli-check.md`）：`.d.ts` 源的侧车/草稿名
 *   **不得含 `.d.`** —— basename 含 `.d.` ⇒ TypeScript 的
 *   `getDeclarationFileExtension` 判它是**声明文件** ⇒ 草稿与工具建议的
 *   复制落点都过不了 `tsc --strict`（TS1254）⇒ `types/index.d.ts` 的草稿是
 *   `types/index.nudo.draft.ts`、侧车是 `types/index.nudo.ts`
 *   （**不是** `types/index.d.nudo.draft.ts` / `types/index.d.nudo.ts`）。
 */






/** CWD 里**另一个文件**（index.js）的既有草稿 —— 不得被 `--from-dts` 覆盖 */
const OTHER_DRAFT = `// @nudo:draft
// Generated by \`nudo contract --draft\` from index
//
// dts draft of index.js — 手工留存的既有草稿（不得被 --from-dts 静默覆盖）

import { fn, number } from "@nudojs/core";

// add — from analysis
export const add = fn({ a: number(), b: number() }, number());
`;

const DTS = `export declare function mul(a: number, b: number): number;
`;

/** 夹具：index.js + 它的既有草稿 + types/index.d.ts（另一个基名的源） */
function makeFixture(dts: string = DTS): string {
  const dir = mkdtempSync(join(tmpdir(), "nudo-bug-944-"));
  mkdirSync(join(dir, "types"), { recursive: true });
  writeFileSync(
    join(dir, "index.js"),
    "export function add(a, b) {\n  return a + b;\n}\n",
    "utf-8",
  );
  writeFileSync(join(dir, "index.nudo.draft.js"), OTHER_DRAFT, "utf-8");
  writeFileSync(join(dir, "types", "index.d.ts"), dts, "utf-8");
  return dir;
}

describe("nudo contract --from-dts --write · Bug 944 · 落盘位置与覆盖保护", () => {
  it("草稿落在**源 .d.ts 旁边**（不再是 CWD）⇒ CWD 里的同名草稿逐字不变", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    // 产物贴着源 .d.ts（落点名不含 `.d.` 段 —— BUG-264）
    const draft = join(dir, "types", "index.nudo.draft.ts");
    expect(existsSync(draft)).toBe(true);
    expect(readFileSync(draft, "utf-8")).toContain("export const mul");
    // CWD 里**不再**出现新草稿
    expect(existsSync(join(dir, "index.nudo.draft.ts"))).toBe(false);
    // 另一个文件（index.js）的既有草稿**逐字不变**（改前被静默覆盖）
    expect(readFileSync(join(dir, "index.nudo.draft.js"), "utf-8")).toBe(OTHER_DRAFT);
  }, 60000); // 1 个 CLI 子进程（tsx 冷启动）

  it("「next」提示**点名目标侧车路径**", () => {
    const dir = makeFixture();

    const r = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    expect(r.status).toBe(0);
    expect(r.stdout).toContain("types/index.nudo.ts");
  }, 60000); // 1 个 CLI 子进程

  it("目标已存在且内容不同 ⇒ **拒绝覆盖**（exit 1）+ 提示 + 既有草稿逐字不变", () => {
    const dir = makeFixture();
    // 先写一次（产物落盘）
    const first = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });
    expect(first.status).toBe(0);
    const draft = join(dir, "types", "index.nudo.draft.ts");
    const written = readFileSync(draft, "utf-8");
    // 源 .d.ts 变了 ⇒ 草稿内容会变
    writeFileSync(
      join(dir, "types", "index.d.ts"),
      `${DTS}export declare function div(a: number, b: number): number;\n`,
      "utf-8",
    );

    const second = runCli(["contract", "--from-dts", "types/index.d.ts", "--write"], { cwd: dir });

    // 拒绝覆盖 ⇒ 非 0 退出 + 可诊断的理由
    expect(second.status).toBe(1);
    expect(second.stderr).toContain("refusing to overwrite");
    expect(second.stderr).toContain("types/index.nudo.draft.ts");
    // 既有草稿逐字不变（没有静默丢内容）
    expect(readFileSync(draft, "utf-8")).toBe(written);
    // 没有谎报成功
    expect(second.stdout).not.toContain("wrote ");
  }, 60000); // 2 个顺序 CLI 子进程
});
});
