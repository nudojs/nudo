/**
 * nudo migrate — TypeScript 单向退休：status / strip / verify / retire。
 * 实现在 ../migrate.ts（保留 @babel/generator 用法）；本文件只做命令注册。
 *
 * 命令层的两个职责（族 21 C5）：
 * - **逐目标收集结果**（Bug 696）：`strip` 逐目标调用 ⇒ 一个目标失败
 *   （语法错 / TS-only 残留）不再吞掉其它目标的成功结果；`--json` 下
 *   stdout **永不为空**（失败也出信封：成功项 + `pathErrors`）。
 * - **产物可解析性闸门**（Bug 672）：strip 的降级发射面**不**剥类成员
 *   修饰符（`private` / `public` / `protected` / `readonly`）与构造器参数
 *   属性（`constructor(private x)`）⇒ 产物仍是 TS 语法、Node 解析不了。
 *   真源在 `packages/core/src/strip-types.ts`（经 `../migrate.ts` 的
 *   `stripTsToJs`）——**族 16 的文件**，本命令层不碰它；这里做**命令层
 *   能做的部分**：写盘**之前**检出「剥完仍有 TS-only 语法」的目标并
 *   拒绝写盘 + 响亮报错（migrate 是一程闸门，写坏了没有回退路径）。
 *   **族 12 扩围**（真源已修，闸门只作兜底）：`export =` / `export as
 *   namespace`（Bug 446）· 类成员的 `x!` / `y?` / `m?()`（Bug 447）·
 *   TS 的 `this` 形参（Bug 448）—— 判据与「零误伤论证」见
 *   `tsOnlyConstructs` 的注释。
 */
import type { Command } from "commander";
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseSource } from "@nudojs/core";
import type { StripResult, StripWriteStatus } from "../migrate.ts";

/**
 * verify 的 tsc 基线根（Bug 582）：目录目标取目录本身，文件目标取其所在目录。
 * 旧实现从不传 root ⇒ cwd 是**进程 cwd** ⇒ tsc 找错项目 / 找不到 tsconfig。
 */
function verifyRoot(targets: string[]): string {
  const first = targets[0];
  if (!first) return process.cwd();
  const abs = resolve(first);
  try {
    return statSync(abs).isDirectory() ? abs : dirname(abs);
  } catch {
    return process.cwd();
  }
}

// ---------------------------------------------------------------------------
// Bug 672 — 产物可解析性闸门（命令层）
// ---------------------------------------------------------------------------

/** 类成员节点（修饰符可能残留在上面） */
const CLASS_MEMBER_TYPES = new Set([
  "ClassProperty",
  "ClassMethod",
  "ClassPrivateProperty",
  "ClassPrivateMethod",
  "ClassAccessorProperty",
  "TSAbstractClassProperty",
  "TSAbstractMethodDefinition",
]);

/** 残留即「产物不是纯 JS」的类成员修饰符 */
const MEMBER_MODIFIER_FLAGS = ["accessibility", "readonly", "abstract", "override"] as const;

/**
 * TS-only 的**模块出口语句**（Bug 446）。
 *
 * 这两个 Babel 节点类型在**纯 JS 源码里永不出现**（`export =` / `export as
 * namespace` 是 TS 语法）⇒ 判据零误伤。
 */
const TS_ONLY_EXIT_STATEMENTS = new Set([
  "TSExportAssignment",
  "TSNamespaceExportDeclaration",
]);

/**
 * 剥除之后仍然残留的 **TS-only** 构造（= 产物里会出现的 TS 语法）。
 *
 * 覆盖（族 12 扩围）：
 * - Bug 672：`private` / `public` / `protected` / `readonly` 类成员修饰符 +
 *   构造器参数属性；
 * - Bug 446：`export =` / `export as namespace` 两条 TS-only 出口语句；
 * - Bug 447：类成员的 `x!`（definite）与 `y?` / `m?()`（optional）；
 * - Bug 448：TS 的 `this` 形参。
 *
 * ⚠ **零误伤论证**（判据写粗 ⇒ 把合法 JS 拦下来 ⇒ 迁移被卡住）：
 * 1. `TSParameterProperty` / `TSExportAssignment` / `TSNamespaceExportDeclaration`
 *    —— Babel 只在 TS 语法下产出这些节点类型 ⇒ 纯 JS 源码零命中；
 * 2. 类成员的 `definite` / `optional` —— Babel 只在 TS 语法下给类成员节点置
 *    这两个字段（JS 类成员没有 `x!` / `y?`）⇒ 纯 JS 源码零命中；⚠ 只按
 *    **类成员节点族**判定（`CLASS_MEMBER_TYPES`），绝不碰表达式节点自己的
 *    `optional`（`a?.b` 的 `OptionalMemberExpression` 是合法 JS）；
 * 3. `this` 形参 —— 判据只看**形参数组**里的 `Identifier("this")`；`this` 在
 *    strict 与 sloppy 下都**不是合法形参名**（`function f(this) {}` 是
 *    SyntaxError）⇒ 纯 JS 源码零命中；函数体里的 `this` **表达式**不在
 *    形参数组里 ⇒ 不受影响。
 *
 * ⚠ **不拦**的形态：值位置的「类型专用导入」（Bug 445）—— 它是**合法 JS
 * 语法**（只是链接期可能失败）⇒ 语法闸门拦不住；那一形态由 `nudo check`
 * 的 `nudo:missing-export` 抓（诊断面），不在本闸门重复实现。
 */
function tsOnlyConstructs(ast: unknown, out: string[] = [], seen = new Set<object>()): string[] {
  if (!ast || typeof ast !== "object") return out;
  if (seen.has(ast)) return out;
  seen.add(ast);
  if (Array.isArray(ast)) {
    for (const item of ast) tsOnlyConstructs(item, out, seen);
    return out;
  }
  const node = ast as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : undefined;
  if (type === "TSParameterProperty") {
    out.push("constructor parameter property");
  } else if (type && TS_ONLY_EXIT_STATEMENTS.has(type)) {
    out.push(
      type === "TSExportAssignment"
        ? "TS-only `export =` statement"
        : "TS-only `export as namespace` statement",
    );
  } else if (type && CLASS_MEMBER_TYPES.has(type)) {
    for (const flag of MEMBER_MODIFIER_FLAGS) {
      const value = node[flag];
      if (value === true || (typeof value === "string" && value.length > 0)) {
        out.push(`class member modifier '${flag === "readonly" ? "readonly" : value}'`);
        break;
      }
    }
    // Bug 447：`x!`（definite）与 `y?` / `m?()`（optional）是**另外两个**
    // AST 字段 ⇒ 原样打印就不是合法 JS。
    if (node.definite === true) {
      out.push("class member definite assignment assertion ('x!')");
    }
    if (node.optional === true) {
      out.push("class member optional marker ('y?' / 'm?()')");
    }
  }
  // Bug 448：TS 的 `this` 形参 —— Babel 把它表示成「一个名叫 this 的
  // Identifier」；它留在形参位 ⇒ 产物 `function f(this, a)` Node 加载不了。
  const params = node.params;
  if (Array.isArray(params)) {
    for (const p of params) {
      const rec = p as { type?: string; name?: string } | null;
      if (rec?.type === "Identifier" && rec.name === "this") {
        out.push("TS-only `this` parameter");
        break;
      }
    }
  }
  for (const key of Object.keys(node)) {
    if (
      key === "loc" ||
      key === "extra" ||
      key === "leadingComments" ||
      key === "trailingComments" ||
      key === "innerComments" ||
      key === "comments" ||
      key === "tokens"
    ) {
      continue;
    }
    tsOnlyConstructs(node[key], out, seen);
  }
  return out;
}

/**
 * 一批 strip 目标里「剥完仍有 TS-only 语法」的源文件（Bug 672）。
 *
 * 判据用的是**剥除之后**的 AST（`parseSource` 默认走 strip pass）⇒
 * 真源修好之后本闸门自动放行（不会误拦已可降级的构造）。
 */
function tsOnlyLeftovers(plan: Array<{ file: string }>): Array<{ file: string; found: string[] }> {
  const out: Array<{ file: string; found: string[] }> = [];
  for (const item of plan) {
    let source: string;
    try {
      source = readFileSync(resolve(item.file), "utf-8");
    } catch {
      continue;
    }
    let ast: unknown;
    try {
      ast = parseSource(source);
    } catch {
      continue; // 语法错由库面报错（parse failed: <file>）
    }
    const found = tsOnlyConstructs(ast);
    if (found.length > 0) out.push({ file: item.file, found });
  }
  return out;
}


// ---------------------------------------------------------------------------
// Bug 1100 — 写盘状态（人类面措辞 / 机器面标记）
// ---------------------------------------------------------------------------

/**
 * 写盘状态 → 人类面措辞（Bug 1100）。
 *
 * ⚠ **未写盘不得说 "wrote"**：旧实现是 `opts.write ? "wrote" : "dry"`（**无
 * 条件**按 `--write` 打 `wrote`）⇒ 批内有失败文件时（库面整批零写盘，原子性
 * · Bug 574）人类面打出 `wrote  good.ts → good.js`，而磁盘上**根本没有**
 * `good.js`；同一行下面还跟着一句「not written」的 note ⇒ 同一行既说
 * 「wrote」又说「not written」（自相矛盾）。
 *
 * 现在措辞由**逐行**的写盘状态决定：
 * - `written` ⇒ `wrote`（产物确实落盘）；
 * - `not-written` ⇒ `not written`（本批因别的文件失败而整批零写盘）；
 * - `planned` ⇒ `dry`（dry-run：只有计划面，没请求写盘）。
 */
function stripWriteMode(status: StripWriteStatus): string {
  switch (status) {
    case "written":
      return "wrote";
    case "not-written":
      return "not written";
    default:
      return "dry";
  }
}

export function registerMigrateCommand(program: Command): void {
  program
    .command("migrate")
    .description("Retire TypeScript one-way: status / strip / verify / retire (dual-run only in verify)")
    .argument("<action>", "status | strip | verify | retire")
    .argument("[paths...]", "Files, directories, or package root (default: .)")
    .option("--write", "strip: write .js outputs (and best-effort sidecar draft)")
    .option("--backup", "strip: rename original .ts to .ts.bak after write")
    .option("--no-draft", "strip: skip sidecar draft generation")
    .option("--with-tsc", "verify: also run tsc --noEmit baseline on .ts inputs")
    .option("--dry-run", "retire: print planned package.json edits without writing")
    .option("--all", "retire: every workspace package that still has tsc/typescript")
    .option("--no-workflows", "retire: do not rewrite .github/workflows tsc lines")
    .option("--json", "Machine-readable output")
    .action(
      async (
        action: string,
        paths: string[],
        opts: {
          write?: boolean;
          backup?: boolean;
          draft?: boolean;
          withTsc?: boolean;
          dryRun?: boolean;
          all?: boolean;
          workflows?: boolean;
          json?: boolean;
        },
      ) => {
        const {
          migrateStatus,
          migrateStrip,
          migrateVerify,
          migrateRetireMany,
          migrateRetireAll,
          formatStatusTable,
        } = await import("../migrate.ts");
        const targets = paths.length > 0 ? paths : ["."];
        try {
          if (action === "status") {
            // Bug 668：命令声明接受 `[paths...]`，旧实现只把 `targets[0]` 交给
            // migrateStatus ⇒ `migrate status pkg-a pkg-b` 只报 pkg-a、无警告、
            // exit 0（迁移审计场景下的危险静默截断）。改为**全量审计**。
            // 同一包被多个 target 覆盖时只列一次（root 去重）。
            const seenRoots = new Set<string>();
            const rows = targets
              .flatMap((t) => migrateStatus(t))
              .filter((r) => {
                if (seenRoots.has(r.root)) return false;
                seenRoots.add(r.root);
                return true;
              });
            if (opts.json) console.log(JSON.stringify(rows, null, 2));
            else console.log(formatStatusTable(rows));
            return;
          }
          if (action === "strip") {
            // Bug 696：逐目标调用 ⇒ 一个目标失败（语法错）不再吞掉其它
            // 目标的成功结果；失败项带**文件名**进 stderr 与 `--json` 信封。
            const results: Awaited<ReturnType<typeof migrateStrip>> = [];
            const failures: Array<{ path: string; message: string }> = [];
            for (const target of targets) {
              try {
                // 计划（不写盘）——既拿到文件清单，也用于 Bug 672 的产物闸门
                const plan = await migrateStrip([target], {
                  write: false,
                  draft: false,
                });
                // 族 56b：库面改**逐文件隔离**⇒ 计划里可能带**失败行**
                // （`code` + `error`，带文件名；结构同 `migrate verify` 的
                // 逐文件错误行）。任一失败 ⇒ 该目标**整批零写盘**（原子性）
                // ⇒ 目标判失败，失败详情**逐字沿用**库面的错误文案
                // （`parse failed: <文件>: <原因>`）⇒ CLI 输出与旧版一致。
                //
                // Bug 1086（命令层半边）：
                // - 失败条目的 `path` 用**库面失败行的 `file`**（失败**文件**，
                //   不是目标**目录**）⇒ 与同一 `pathErrors[]` 里 TS-only 闸门
                //   失败的 `path: l.file`（同量纲：文件）一致 ⇒ 机器消费者不必
                //   去解析 message 里的文件名字符串才能定位坏文件。
                // - 同目标内的**成功行照常透出**（不再整目标丢弃）⇒ 消费者能
                //   知道「哪些文件本来可以迁移」（库面已按族 56b 逐文件隔离）。
                const planFailures = plan.filter((r) => r.code !== undefined);
                if (planFailures.length > 0) {
                  const reported = new Set<string>();
                  for (const f of planFailures) {
                    reported.add(f.file);
                    failures.push({
                      path: f.file,
                      message: f.error ?? `strip failed: ${f.file}`,
                    });
                  }
                  if (opts.write) {
                    // 写盘轮：库面在有失败时**零写盘**，并给成功行附「未写盘」
                    // 注记 **+ 写盘状态标记** `not-written` ⇒ 成功行进 results
                    // 且**结构化地**标明「没落盘」（不靠 note 自由文本猜）。
                    const written = await migrateStrip([target], {
                      write: true,
                      backup: opts.backup === true,
                      draft: opts.draft !== false,
                    });
                    for (const f of written.filter((r) => r.code !== undefined)) {
                      // 同一文件只报一次（计划轮已报过 ⇒ 不重复）
                      if (reported.has(f.file)) continue;
                      reported.add(f.file);
                      failures.push({
                        path: f.file,
                        message: f.error ?? `strip failed: ${f.file}`,
                      });
                    }
                    results.push(...written.filter((r) => r.code === undefined));
                  } else {
                    results.push(...plan.filter((r) => r.code === undefined));
                  }
                  continue;
                }
                // Bug 672：产物闸门——剥完仍有 TS-only 语法 ⇒ 写出去的 .js
                // Node 解析不了（migrate 是一程闸门）⇒ 拒绝写盘并报错。
                const leftovers = tsOnlyLeftovers(plan);
                if (leftovers.length > 0) {
                  for (const l of leftovers) {
                    failures.push({
                      path: l.file,
                      message: `the emitted .js would still contain TypeScript syntax (${l.found.join("; ")}) — Node cannot parse it`,
                    });
                  }
                  continue;
                }
                const written = opts.write
                  ? await migrateStrip([target], {
                      write: true,
                      backup: opts.backup === true,
                      draft: opts.draft !== false,
                    })
                  : plan;
                // 族 56b：写盘轮同样可能带回失败行（计划与写盘之间文件变了）
                // ⇒ 同样判失败。Bug 1086：失败条目的 `path` 用失败行的
                // `file`（**文件**，不是目标目录）；同目标内的成功行照常透出
                // （库面已附「未写盘」注记 + `not-written` 状态标记 ⇒ 结构化地
                // 标明「没落盘」，不会被误读成已写盘）。
                const writeFailures = written.filter((r) => r.code !== undefined);
                if (writeFailures.length > 0) {
                  for (const f of writeFailures) {
                    failures.push({
                      path: f.file,
                      message: f.error ?? `strip failed: ${f.file}`,
                    });
                  }
                  results.push(...written.filter((r) => r.code === undefined));
                  continue;
                }
                results.push(...written);
              } catch (err) {
                failures.push({ path: target, message: (err as Error).message });
              }
            }
            // Bug 1100：**写盘状态**（机器面）——**每一行都带** ⇒ 消费方只读
            // 结构化字段就能判定「产物是不是真的落盘了」（此前只能靠 `notes`
            // 的自由文本区分「已写盘」与「计划成功但本批未写盘」⇒ 极易把
            // 「计划成功」误判成「已产出」）。
            // 库面在**写盘轮**填真值（`written` / `not-written`）；dry-run 的
            // 行不带此键 ⇒ 命令层补 `planned`（dry-run 天然未写盘）。
            const rows: StripResult[] = results.map((r) => ({
              ...r,
              writeStatus: r.writeStatus ?? (opts.write ? "not-written" : "planned"),
            }));
            if (opts.json) {
              if (failures.length === 0) {
                console.log(JSON.stringify(rows, null, 2));
              } else {
                // 失败也必须是**合法 JSON**（stdout 永不为空）+ 已攒结果不丢
                console.log(
                  JSON.stringify(
                    {
                      ok: false,
                      action: "strip",
                      targets,
                      results: rows,
                      pathErrors: failures.map((f) => ({
                        path: f.path,
                        code: "nudo:migrate-strip-failed",
                        message: f.message,
                      })),
                      error: failures[0]!.message,
                    },
                    null,
                    2,
                  ),
                );
              }
            } else {
              for (const r of rows) {
                // 措辞由**逐行**的写盘状态决定（Bug 1100）——未写盘**不得**打
                // `wrote`（旧实现按 `--write` 无条件打 `wrote` ⇒ 整批零写盘
                // 时谎称已产出）。
                const mode = stripWriteMode(r.writeStatus ?? "planned");
                console.log(`${mode}  ${r.file} → ${r.outFile}`);
                if (r.sidecarDraft) console.log(`      draft  ${r.sidecarDraft}`);
                for (const n of r.notes) console.log(`      note: ${n}`);
              }
              if (!opts.write && failures.length === 0) {
                console.log("\n(none written — pass --write to emit .js + sidecar draft)");
              }
            }
            // 失败描述：两种模式都走 stderr（**带文件名**）——人类面不受 --json 影响
            for (const f of failures) {
              console.error(`migrate strip: ${f.path}: ${f.message}`);
            }
            if (failures.length > 0) {
              console.error(
                "fix:  fix the reported file(s) and re-run; migrate strip only removes types (class member modifiers / constructor parameter properties / `export =` / `export as namespace` / `this` parameters must be lowered by hand or by tsc)",
              );
              process.exitCode = 1;
            }
            return;
          }
          if (action === "verify") {
            const results = await migrateVerify(targets, {
              withTsc: opts.withTsc === true,
              // Bug 568：--json 时人工报告走 stderr（stdout 只放 JSON 信封）
              json: opts.json === true,
              // Bug 582：tsc 基线的项目根（cwd 不再是进程 cwd）
              root: verifyRoot(targets),
            });
            if (opts.json) {
              console.log(JSON.stringify(results, null, 2));
            } else {
              for (const r of results) {
                console.log(
                  `${r.nudoOk ? "OK  " : "FAIL"}  ${r.file}  (${r.nudoSummary})`,
                );
                if (r.error) console.log(`      error: ${r.error}`);
                if (r.fix) console.log(`      fix:   ${r.fix}`);
                if (r.tsc) {
                  console.log(`      tsc: ${r.tsc.ok ? "ok" : "diagnostics"}`);
                  if (!r.tsc.ok && r.tsc.output) {
                    console.log(
                      r.tsc.output
                        .split("\n")
                        .slice(0, 8)
                        .map((l) => `        ${l}`)
                        .join("\n"),
                    );
                  }
                }
              }
            }
            const anyFail = results.some((r) => !r.nudoOk);
            if (anyFail) process.exitCode = 1;
            return;
          }
          if (action === "retire") {
            const dryRun = opts.dryRun === true;
            const wf = opts.workflows === false ? false : undefined;
            const results =
              opts.all === true
                ? migrateRetireAll(targets[0]!, {
                    dryRun,
                    ...(wf === false ? { workflows: false } : {}),
                  })
                : // Bug 595：旧实现只退役 `targets[0]` ⇒ `retire <a> <b>` 静默跳过 b。
                  // 改用多目标入口（**全退役或全报错**，任一失败 ⇒ 整批零写盘）。
                  migrateRetireMany(targets, {
                    dryRun,
                    ...(wf === false ? { workflows: false } : {}),
                  });
            if (opts.json) {
              // Bug 675：顶层 JSON 形状**恒定**（数组）——旧实现按结果条数在
              // 「对象 / 数组」之间漂移 ⇒ 机器可读契约不稳定。
              console.log(JSON.stringify(results, null, 2));
            } else {
              for (const result of results) {
                console.log(`${dryRun ? "dry-run" : "retired"}  ${result.root}`);
                if (result.removedDeps.length > 0) {
                  console.log(`  removed typescript from: ${result.removedDeps.join(", ")}`);
                }
                for (const s of result.rewrittenScripts) {
                  console.log(`  script ${s.name}:`);
                  console.log(`    - ${s.from}`);
                  console.log(`    + ${s.to}`);
                }
                // Bug 586：编译器角色的脚本被**原样保留** ⇒ 必须让用户看见
                // 「这个脚本没改」的原因（否则看起来像漏改）。
                for (const p of result.preservedScripts ?? []) {
                  console.log(`  script ${p.name} preserved (${p.reason}):`);
                  console.log(`    = ${p.command}`);
                }
                for (const w of result.rewrittenWorkflows) {
                  console.log(`  workflow ${w.file}:`);
                  console.log(`    - ${w.from}`);
                  console.log(`    + ${w.to}`);
                }
                console.log(`  marker: ${result.marker}`);
              }
              if (results.length === 0) {
                console.log("nothing to retire (no tsc/typescript in scope)");
              }
            }
            return;
          }
          console.error(`Unknown migrate action: ${action} (expected status | strip | verify | retire)`);
          process.exitCode = 1;
        } catch (err) {
          const message = (err as Error).message;
          // 批次失败明细（库面 `migrateRetireMany` 把**全部**失败目标挂在错误上
          // ⇒ 机器面拿结构化清单，不解析人读消息）。
          const failures = (
            err as {
              retireFailures?: Array<{ target: string; message: string }>;
            }
          ).retireFailures;
          // Bug 567 / 586：「无可退役」是**正常结果**（不是失败）——退役闸门
          // 的用户预期是「把还能退役的都退役了」，没东西可退役不该报红。
          // 库面用「nothing to retire …」消息表达该状态 ⇒ CLI 据此给 exit 0。
          // **批次口径**：只有**全部**失败项都是「nothing to retire」才算正常结果
          // （否则某个目标的真错误会被当成正常 ⇒ 假绿）。
          const benign =
            failures !== undefined
              ? failures.length > 0 &&
                failures.every((f) => f.message.startsWith("nothing to retire"))
              : message.startsWith("nothing to retire");
          if (benign) {
            if (opts.json) {
              console.log(
                JSON.stringify(
                  {
                    ok: true,
                    retired: [],
                    message,
                    ...(failures !== undefined ? { failedTargets: failures } : {}),
                  },
                  null,
                  2,
                ),
              );
            } else {
              console.log(message);
            }
            return;
          }
          console.error(`migrate ${action}: ${message}`);
          // Bug 1006：`--json` 是机器面 ⇒ **失败时 stdout 也必须是合法 JSON**
          // （旧实现失败时 stdout 为 0 字节 ⇒ `JSON.parse(stdout)` 抛错）。
          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  ok: false,
                  action,
                  targets,
                  error: message,
                  // 批次失败明细（机器面）：`retire` 多目标失败时列出**全部**
                  // 失败目标（人读消息在 `error` 里）。
                  ...(failures !== undefined ? { failedTargets: failures } : {}),
                },
                null,
                2,
              ),
            );
          }
          process.exitCode = 1;
        }
      },
    );
}
