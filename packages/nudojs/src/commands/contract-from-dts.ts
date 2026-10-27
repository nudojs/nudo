/**
 * contract --from-dts 分支 —— 从 `packages/nudojs/src/commands/contract.ts` 搬移而来。
 *
 * 搬移记录（族 20 · S0「串行前置重构」）：
 * - 原函数名：`runContractFromDts`
 * - 原文件：  `packages/nudojs/src/commands/contract.ts`
 * - 搬移自：  commit `3b531d0b`（族 20 开工时的 HEAD）
 * - 承诺：    **行为零变化** —— 函数体逐字保留，只把 `node:fs` / `node:path`
 *             的 import 收窄到本模块实际用到的那些。本次**不改任何判定、
 *             不改任何文案**。
 *
 * 本模块是**包内内部模块**（`packages/nudojs/package.json` 的 `exports` 只有 `"."`）
 * ⇒ 不在公开面上，零新增公开导出。
 *
 * ── 族 20 · 片 C 的修复（944）────────────────────────────────────────────
 * 改前：`--from-dts --write` 的输出路径**以 CWD 为基准**（`resolve(outName)`）
 * ⇒ 同基名的**另一个文件**的草稿被**静默覆盖**（零告警、exit 0）；且写盘
 * **完全绕过** `interface-draft.ts` 的五重保护。
 *
 * 改后：
 * ① 输出路径**贴着源 `.d.ts`**（`sidecarDraftPath` 口径，与 `--draft --write`
 *    同款）⇒ **不再**以 CWD 为基准；
 * ② 写盘前做**存在性检查**（已存在且内容不同 ⇒ **拒绝覆盖** + 提示；
 *    `opts.force` / `NUDO_DRAFT_FORCE=1` 才覆盖）；
 * ③ 写盘**复用** `packages/service/src/emit/interface-draft.ts` 的
 *    `writeInterfaceDraft`（五重保护：不覆盖正式侧车 / 不写 node_modules /
 *    不越出项目根 / 内容未变不写 / 空草稿不落盘）；
 * ④ 「next」提示**点名目标侧车路径**（`sidecarPathOf` 口径，与 `--draft --write`
 *    的 `formatDraftSummary` 同款）。
 *
 * ── 族 20 · 片 C 的续修（944 · dry-run 预览）─────────────────────────────
 * 改前：`--from-dts --write --dry-run` 打的是**整份草稿正文**（全文 dump）⇒
 * 看不到「改了什么」；且「既有草稿不同 ⇒ 拒绝覆盖」那一关跑在 dry-run 分支
 * **之前** ⇒ dry-run 遇到既有草稿直接报错退出，**连 diff 都看不到**。
 *
 * 改后：dry-run 打 **unified diff**（复用 `@nudojs/service/emit` 的
 * `unifiedDiff`，与 `--draft --write --dry-run` 同款；对照面 = 既有草稿文件的
 * 磁盘内容，文件不存在 ⇒ 空串 ⇒ 整份都是新增行），标签行
 * 「[dry-run] would write <path>」保留；退出码**镜像真写盘**（真写会被拒 ⇒
 * dry-run 也 exit 1，但 diff 照打）。dry-run **绝不写盘**。
 */
import { readFileSync, existsSync, statSync, type Stats } from "node:fs";
import { resolve, relative, basename, dirname, join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";

/**
 * 草稿正文指纹（族 20 · Bug 944）—— 与
 * `packages/service/src/emit/interface-draft.ts` 的 `draftFingerprint` **同算法**。
 *
 * 作用：让 `--from-dts` 落盘的草稿带上「机器原稿」标记 ⇒
 * 写盘助手能区分「机器原稿（可按需覆盖）」与「人工改过（永不覆盖）」。
 * 指纹按**去掉指纹行后的正文**计算（与 `formatDraftModule` 同口径）。
 */
function draftFingerprint(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** 给草稿正文加指纹行（`// @nudo:draft` 之后）—— 无标记则原样返回 */
function withDraftFingerprint(source: string): string {
  const marker = "// @nudo:draft\n";
  if (!source.includes(marker)) return source;
  return source.replace(marker, `${marker}// @nudo:draft-fingerprint: ${draftFingerprint(source)}\n`);
}

/**
 * 源文件所在的项目根（最近的 `package.json` 祖先）——**只**用于写盘助手的
 * 「不越出项目根」守卫。
 *
 * ⚠ 这里**不**复用 `contract-draft.ts` 的项目根发现（那是片 B 的地盘，且
 * `findProjectConfig` 带进程级配置副作用）；本面只需要「最近的 package.json
 * 祖先」这一个判据。
 */
function nearestPackageRoot(dir: string): string | undefined {
  let cur = dir;
  const fsRoot = resolve("/");
  while (cur !== fsRoot) {
    if (existsSync(join(cur, "package.json"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return undefined;
}

export async function runContractFromDts(
  paths: string[],
  opts: {
    write: boolean;
    dryRun: boolean;
    /**
     * 覆盖既有草稿的**逃生口**（族 20 · Bug 944）。
     *
     * CLI 旗标 `--force` 归 `contract.ts`（片 A）—— 本面只留**可选字段**
     * （加可选字段不算新增导出）+ 环境变量通道 `NUDO_DRAFT_FORCE=1`
     * （沿用既有「契约草稿写盘守卫」旋钮，不新增产品面）。
     */
    force?: boolean;
  },
): Promise<void> {
  const { dtsPathToContractDraft, dtsToContractDraft } = await import("@nudojs/harvester");
  const { harvestPackage } = await import("@nudojs/harvester");
  const { sidecarDraftPath, writeInterfaceDraft, unifiedDiff } = await import(
    "@nudojs/service/emit"
  );
  const { sidecarPathOf } = await import("@nudojs/core");

  if (paths.length === 0) {
    console.error(
      "Usage error: `nudo contract --from-dts` needs a .d.ts file, a directory, or an npm package name.",
    );
    process.exitCode = 1;
    return;
  }

  let label = "dts";
  let dtsFiles: string[] = [];
  // 路径形态（./x、/x、含分隔符）必须是存在的文件/目录——拼错路径不得
  // 回落成 npm 包名（旧实现报误导性 no .d.ts files found）；
  // 裸名（无分隔符）仍按包名 harvest。
  const isPathLike = (p: string): boolean =>
    p.startsWith(".") || isAbsolute(p) || /[/\\]/.test(p);
  const missingPaths: string[] = [];
  const barePkgs: string[] = [];
  /** 目录模式下遍历不到的目录数（族 27 Bug 1015）——并进最终汇总行 */
  let droppedDirs = 0;

  for (const p of paths) {
    const abs = resolve(p);
    // 单次 stat：miss（ENOENT）分类处理；EACCES/EIO 上抛面（error + exit）
    let st: Stats | undefined;
    try {
      st = statSync(abs, { throwIfNoEntry: false });
    } catch (err) {
      console.error(`error: cannot access ${p}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (!st) {
      if (isPathLike(p)) missingPaths.push(p);
      else barePkgs.push(p);
      continue;
    }
    if (st.isDirectory()) {
      const r = dtsPathToContractDraft(abs, basename(abs));
      dtsFiles.push(...r.files);
      // 族 27 Bug 1015：目录模式下 `dtsPathToContractDraft` 统计的
      // 「遍历不到的目录」必须并进最终汇总行 —— 否则 CLI 只取 `r.files`
      // 丢掉 stats ⇒ 汇总行说「0 skipped」而实际丢了东西。
      droppedDirs += r.stats.droppedDirs ?? 0;
    } else if (/\.(d\.)?(m)?ts$/.test(abs) && !abs.endsWith(".d.ts.map")) {
      // .d.ts 或带注解的 .ts 源（迁移：从原 TS 逆向契约）
      dtsFiles.push(abs);
    } else {
      const sibling = abs.replace(/\.[cm]?[jt]sx?$/, ".d.ts");
      if (existsSync(sibling)) dtsFiles.push(sibling);
    }
  }
  if (missingPaths.length > 0) {
    console.error(`error: path not found for --from-dts: ${missingPaths.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  for (const pkg of barePkgs) {
    const h = harvestPackage(pkg, process.cwd());
    if ("error" in h) {
      console.error(h.error);
      process.exitCode = 1;
      return;
    }
    dtsFiles.push(...h.dtsFiles);
    label = pkg;
  }
  dtsFiles = [...new Set(dtsFiles)];
  if (dtsFiles.length === 0) {
    console.error("error: no .d.ts files found for --from-dts");
    process.exitCode = 1;
    return;
  }
  if (label === "dts" && dtsFiles[0]) {
    label = basename(dtsFiles[0]).replace(/\.d\.ts$/, "");
  }

  const draft = dtsToContractDraft(dtsFiles, label);
  if (droppedDirs > 0) {
    // 目录模式的遍历缺口计入汇总行（否则「0 skipped」是说谎）
    draft.stats.skipped += droppedDirs;
    draft.stats.droppedDirs = droppedDirs;
  }
  // 落盘正文 = 指纹版（与 `--draft --write` 的草稿同款：带机器原稿标记）
  const draftSource = withDraftFingerprint(draft.draftSource);
  // 族 20 · Bug 944 ①：**输出路径贴着源 `.d.ts`**（不再是 CWD 基准）。
  // 多文件模式锚定**第一个** `.d.ts`（dtsFiles 的确定性顺序）。
  const anchor = dtsFiles[0];
  const outPath = sidecarDraftPath(anchor);
  const outRel = relative(process.cwd(), outPath) || outPath;
  const sidecarRel = relative(process.cwd(), sidecarPathOf(anchor)) || sidecarPathOf(anchor);

  if (opts.write) {
    // 族 20 · Bug 944 ②：写盘前做**存在性检查**——已存在且内容不同 ⇒
    // **拒绝覆盖** + 提示（`opts.force` / `NUDO_DRAFT_FORCE=1` 才覆盖）。
    const force = opts.force === true || process.env.NUDO_DRAFT_FORCE === "1";
    const prev = existsSync(outPath) ? readFileSync(outPath, "utf-8") : undefined;
    // 族 20 · Bug 944（续）——`--dry-run` 打 **unified diff**，不再倾倒草稿全文。
    //
    // 改前：dry-run 只打一行「[dry-run] would write <path>」+ **整份草稿正文**
    // ⇒ stdout 是全文 dump（几千行）⇒ 用户看不到「**改了什么**」；
    // 而 CLI Reference 承诺 `--dry-run` = "print instead of writing"（一个
    // **预览**），兄弟命令 `--draft --write --dry-run` 打的是 unified diff。
    //
    // 改后：**复用同一个 diff 生成器**（`unifiedDiff` 已在
    // `@nudojs/service/emit` ⇒ 零新增导出），对照面 = **既有草稿文件**的磁盘
    // 内容（文件不存在 ⇒ 空串 ⇒ 整份都是新增行，= 新建文件口径）。
    // ⚠ dry-run **绝不写盘**（写盘助手拿到的仍是 `dryRun: true`）。
    if (opts.dryRun) {
      console.log(`[dry-run] would write ${outRel}`);
      const diff = unifiedDiff(prev ?? "", draftSource, outRel);
      // 两侧逐字相同 ⇒ 无差异 ⇒ 不打空 diff（与 `--draft --write --dry-run` 同款）
      if (diff !== "") console.log(diff);
    }
    if (prev !== undefined && prev !== draftSource && !force) {
      console.error(`error: draft exists and differs: ${outRel} — refusing to overwrite`);
      // 族 20 · Bug 1147：提示**同时**给出两个放行口子（CLI 旗标 `--force`
      // **与**环境变量 `NUDO_DRAFT_FORCE=1`）—— 改前只提环境变量 ⇒ 用户按
      // 文档用 `--force` 被拒时**看不出还有旗标**（死胡同）。
      console.error(
        `hint: to overwrite a machine-generated draft, re-run with --force (or NUDO_DRAFT_FORCE=1)`,
      );
      // 措辞要准：**人工改过的草稿永不被覆盖**（`writeInterfaceDraft` 的
      // `skipped: "hand-edited"` 通道，与 `--draft --write` 面同款）⇒ 这条
      // 拒绝是**预期行为**，force 也放行不了它 ⇒ 明说，避免用户「加了
      // --force 还是被拒」时以为工具坏了。
      console.error(
        `hint: a hand-edited draft is never overwritten — refusing here is expected; merge it manually, or delete it to regenerate`,
      );
      process.exitCode = 1;
      return;
    }
    // 族 20 · Bug 944 ③：复用 service 的写盘助手（五重保护）。
    // dry-run 也走它（dryRun: true ⇒ 不写盘）⇒ 守卫口径与写盘面**同款**。
    const projectDir = nearestPackageRoot(dirname(anchor));
    let write;
    try {
      write = writeInterfaceDraft(anchor, draftSource, {
        dryRun: opts.dryRun,
        ...(projectDir ? { projectDir } : {}),
      });
    } catch (err) {
      console.error(`error: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }
    if (write.skipped === "hand-edited") {
      // 人工改过的草稿**永不覆盖**（与 `--draft --write` 面同款：Bug 557）
      console.error(`error: draft exists and was hand-edited — not overwritten: ${outRel}`);
      console.error(`hint: merge it manually, or delete it to regenerate`);
      process.exitCode = 1;
      return;
    }
    // dry-run 的预览（标签行 + unified diff）已在上面打完 ⇒ 这里**只**处理
    // 真写盘的结果面（`--dry-run` 绝不声称已写盘，也不再倾倒草稿全文）。
    if (!opts.dryRun) {
      if (!write.draftable) {
        console.log(`${outRel}: draft has no writable exports; nothing written`);
      } else if (write.written) {
        console.log(
          `wrote  ${outRel}  (${draft.stats.exports} exports from ${draft.stats.files} d.ts)`,
        );
      } else {
        console.log(`${outRel}: draft unchanged`);
      }
      // 族 20 · Bug 944 ④：「next」提示**点名目标侧车路径**
      console.log(
        `next   review, then copy accepted exports into ${sidecarRel} to accept (not enforced until then)`,
      );
    }
  } else {
    console.log(draftSource);
    console.log(
      `// ${draft.stats.exports} projectable exports · ${draft.stats.skipped} skipped · ${draft.stats.files} d.ts`,
    );
    console.log(
      `// pass --write to save as ${outRel}; copy into *.nudo.js to enforce`,
    );
  }
}
