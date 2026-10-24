/**
 * contract --draft 分支 —— 从 `packages/nudojs/src/commands/contract.ts` 搬移而来。
 *
 * 搬移记录（族 20 · S0「串行前置重构」）：
 * - 原函数名：`runContractDraft`
 * - 原文件：  `packages/nudojs/src/commands/contract.ts`
 * - 搬移自：  commit `3b531d0b`（族 20 开工时的 HEAD）
 * - 承诺：    **行为零变化** —— 函数体逐字保留，只把「同包内可见」的依赖
 *             换成各自的 import（`@nudojs/service/emit` / `@nudojs/service` /
 *             `./shared.ts`）。本次**不改任何判定、不改任何文案**。
 *
 * 本模块是**包内内部模块**（`packages/nudojs/package.json` 的 `exports` 只有 `"."`）
 * ⇒ 不在公开面上，零新增公开导出。
 */
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, join, isAbsolute, sep } from "node:path";
import { unifiedDiff } from "@nudojs/service/emit";
import type { CallRecord } from "@nudojs/service";
import type { PathError } from "./shared.ts";

/**
 * 机器面**用法错误**码（族 20 · Bug 663）。
 *
 * 与 `contract.ts` / `contract-emit.ts` 的 `CONTRACT_USAGE_ERROR_CODE` **同值**
 * （同一条协议常量）；三处各自定义 ⇒ 不跨模块 import（零新增导出）。
 */
const CONTRACT_USAGE_ERROR_CODE = "nudo:usage-error";

export async function runContractDraft(
  file: string,
  opts: {
    fnNames: string[];
    write: boolean;
    dryRun: boolean;
    json?: boolean;
    records?: CallRecord[];
    /** --json 面：路径错误并入 draft JSON（绝不静默 ok + exit≠0） */
    pathErrors?: PathError[];
  },
): Promise<void> {
  const { draftInterface, formatDraftSummary, writeInterfaceDraft, sidecarDraftPath } =
    await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  // -------------------------------------------------------------------------
  // 族 20 · Bug 663 —— `--draft --json --write`：**显式拒绝**（不静默吞 `--write`）
  //
  // 改前：`--json` 分支以 `return` 早退 ⇒ 后面的 `--write` 分支**不可达**
  // ⇒ `--write` 被**静默丢弃**：草稿根本没落盘、exit 0、零提示
  //   ⇒ 假绿 + 静默数据丢失（agent / CI 据此认为「契约已落盘」）。
  //
  // 改后（裁决 = 显式拒绝）：`--json` 与 `--write` **互斥** ⇒ 报用法错误 +
  //   exit 1 ⇒ 「给了不生效且不报错」不再可能。
  //   ⚠ 机器面（`--json`）：stdout 必须是**一份合法 JSON 文档**（命令层的
  //   跨文件聚合层会把它收进恒定数组外壳）⇒ 载荷形状与命令层的 per-root
  //   失败条目同款（`{file, errors:[{code, message}]}`）。
  //   ⚠ 判定放在**分析之前** ⇒ 不产出任何草稿正文、不碰磁盘。
  // -------------------------------------------------------------------------
  if (opts.json === true && opts.write === true) {
    console.log(
      JSON.stringify(
        {
          file: rel,
          errors: [
            {
              code: CONTRACT_USAGE_ERROR_CODE,
              message: "error: --write cannot be combined with --json",
              suggestion:
                "drop --write (--json prints the draft for review); use `--draft --write` to persist it",
            },
          ],
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
    return;
  }
  const result = await draftInterface(filePath, {
    ...(opts.fnNames.length > 0 ? { fnNames: opts.fnNames } : {}),
    ...(opts.records ? { records: opts.records } : {}),
  });
  const draftRel = relative(process.cwd(), sidecarDraftPath(filePath)) || sidecarDraftPath(filePath);
  // AI4：--json → draftSource + unified diff（审阅面）
  if (opts.json) {
    let prev = "";
    try {
      prev = readFileSync(sidecarDraftPath(filePath), "utf-8");
    } catch {
      /* optional: no existing draft — diff against empty */
    }
    const diff = unifiedDiff(prev, result.draftSource, draftRel);
    const pathErrors = opts.pathErrors ?? [];
    console.log(
      JSON.stringify(
        {
          file: rel,
          draftPath: draftRel,
          draftSource: result.draftSource,
          diff,
          entries: result.entries.map((e) => ({
            fn: e.fn,
            dsl: e.dsl,
            skipped: e.skipped,
            paramEvidence: e.paramEvidence,
            returnEvidence: e.returnEvidence,
          })),
          ...(pathErrors.length > 0
            ? {
                pathErrors: pathErrors.map((e) => ({
                  path: e.path,
                  code: e.code,
                  message: e.message,
                  suggestion: e.suggestion,
                })),
              }
            : {}),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (opts.write) {
    const draftPath = sidecarDraftPath(filePath);
    if (/node_modules/.test(filePath) || /node_modules/.test(draftPath)) {
      console.error(`Error: '${filePath}' is inside node_modules; draft write refused`);
      process.exitCode = 1;
      return;
    }
    const { findProjectConfig } = await import("@nudojs/service");
    let projectRoot: string | undefined;
    const proj = findProjectConfig(dirname(filePath));
    if (proj?.projectDir) {
      projectRoot = proj.projectDir;
    } else {
      let dir = dirname(filePath);
      const fsRoot = resolve("/");
      while (dir !== fsRoot) {
        if (existsSync(join(dir, "package.json"))) {
          projectRoot = dir;
          break;
        }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
    if (projectRoot) {
      const projectRootReal = (() => {
        try {
          return realpathSync(projectRoot);
        } catch {
          /* optional: realpath failed — use unresolved path */
          return projectRoot;
        }
      })();
      const fileReal = (() => {
        try {
          return realpathSync(filePath);
        } catch {
          /* optional: realpath failed — use unresolved path */
          return filePath;
        }
      })();
      const relToRoot = relative(projectRootReal, fileReal);
      // 族 20 · Bug 665（CLI 半）：逃逸判据按**路径分量**判定 ——
      // 「整段等于 `..`」或「以 `..` + 分隔符开头」或「跨盘（绝对路径）」。
      // 改前用**字符串前缀** `relToRoot.startsWith("..")` ⇒ 把项目根下的
      // **合法目录名**（`..data/` / `...cfg/`）误判成「越出项目根」⇒ 草稿拒写。
      // ⚠ 与 service 半（`packages/service/src/emit/interface-draft.ts` 的
      // `writeInterfaceDraft`）**逐字同款**（同一个 bug 的两半 ⇒ 同一片修；
      // 不许抽成 core 的共享助手 —— core 冻结面不得新增导出）。
      if (relToRoot === ".." || relToRoot.startsWith(`..${sep}`) || isAbsolute(relToRoot)) {
        console.error(`Error: '${filePath}' is outside project root '${projectRoot}'; draft write refused`);
        process.exitCode = 1;
        return;
      }
    } else if (!process.env.NUDO_DRAFT_FORCE) {
      console.error(
        `Error: no project root found for '${filePath}'; draft --write refused (set NUDO_DRAFT_FORCE=1 to override)`,
      );
      process.exitCode = 1;
      return;
    }
    // 族 20 · Bug 660 —— `--draft --write --dry-run` 打 **unified diff**
    //
    // 改前：dry-run 只借 `formatDraftSummary` 打一行「[dry-run] would write → …」
    // ⇒ **没有 diff**；而 CLI Reference 承诺 `--dry-run` =
    // "Print a unified diff instead of writing" ⇒ 同一个旗标在 `--emit` 与
    // `--draft` 两条分支上语义不同。
    //
    // 改后：**复用 `--emit` 分支的同一个 diff 生成器**（`unifiedDiff` 已在
    // `@nudojs/service/emit` ⇒ 零新增导出；两侧共用同一实现，不另写一份）。
    // diff 的对照面 = **既有草稿文件**（`*.nudo.draft.js`）的磁盘内容
    // （与 `--json` 审阅面同款口径：无既有草稿 ⇒ 对空串求 diff）。
    let prevDraft = "";
    if (opts.dryRun) {
      try {
        prevDraft = readFileSync(draftPath, "utf-8");
      } catch {
        /* optional: no existing draft — diff against empty */
      }
    }
    const diff = opts.dryRun ? unifiedDiff(prevDraft, result.draftSource, draftRel) : "";
    const write = writeInterfaceDraft(filePath, result.draftSource, {
      dryRun: opts.dryRun,
      entries: result.entries,
      ...(projectRoot ? { projectDir: projectRoot } : {}),
    });
    let diffPrinted = false;
    for (const line of formatDraftSummary(rel, draftRel, result, write)) {
      console.log(line);
      // diff 紧跟在「[dry-run] would write」标签行之后（与 `--emit --dry-run`
      // 的「标签行 → diff」同款顺序）；标签行缺席（如人工改过的草稿）⇒ 末尾补打。
      if (diff !== "" && !diffPrinted && line.startsWith("[dry-run] would write")) {
        console.log(diff);
        diffPrinted = true;
      }
    }
    if (diff !== "" && !diffPrinted) console.log(diff);
    // Bug 557：既有草稿被人工改过 ⇒ 写盘被拒绝（文件原样保留）。
    // 静默 exit 0 会让 CI 以为草稿已重新生成 ⇒ 拒绝覆盖必须非零退出。
    if (write.skipped === "hand-edited") process.exitCode = 1;
  } else {
    for (const line of formatDraftSummary(rel, draftRel, result)) console.log(line);
  }
}
