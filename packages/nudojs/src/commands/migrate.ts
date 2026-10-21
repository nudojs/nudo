/**
 * nudo migrate — TypeScript 单向退休：status / strip / verify / retire。
 * 实现在 ../migrate.ts（保留 @babel/generator 用法）；本文件只做命令注册。
 */
import type { Command } from "commander";
import { statSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
            const results = await migrateStrip(targets, {
              write: opts.write === true,
              backup: opts.backup === true,
              draft: opts.draft !== false,
            });
            if (opts.json) {
              console.log(JSON.stringify(results, null, 2));
            } else {
              for (const r of results) {
                const mode = opts.write ? "wrote" : "dry";
                console.log(`${mode}  ${r.file} → ${r.outFile}`);
                if (r.sidecarDraft) console.log(`      draft  ${r.sidecarDraft}`);
                for (const n of r.notes) console.log(`      note: ${n}`);
              }
              if (!opts.write) {
                console.log("\n(none written — pass --write to emit .js + sidecar draft)");
              }
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
          // Bug 567 / 586：「无可退役」是**正常结果**（不是失败）——退役闸门
          // 的用户预期是「把还能退役的都退役了」，没东西可退役不该报红。
          // 库面用「nothing to retire …」消息表达该状态 ⇒ CLI 据此给 exit 0。
          if (message.startsWith("nothing to retire")) {
            if (opts.json) {
              console.log(JSON.stringify({ ok: true, retired: [], message }, null, 2));
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
              JSON.stringify({ ok: false, action, targets, error: message }, null, 2),
            );
          }
          process.exitCode = 1;
        }
      },
    );
}
