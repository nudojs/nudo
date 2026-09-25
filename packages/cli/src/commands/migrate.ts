/**
 * nudo migrate — TypeScript 单向退休：status / strip / verify / retire。
 * 实现在 ../migrate.ts（保留 @babel/generator 用法）；本文件只做命令注册。
 */
import type { Command } from "commander";

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
          migrateRetire,
          migrateRetireAll,
          formatStatusTable,
        } = await import("../migrate.ts");
        const targets = paths.length > 0 ? paths : ["."];
        try {
          if (action === "status") {
            const rows = migrateStatus(targets[0]!);
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
            });
            if (opts.json) {
              console.log(JSON.stringify(results, null, 2));
            } else {
              for (const r of results) {
                console.log(
                  `${r.nudoOk ? "OK  " : "FAIL"}  ${r.file}  (${r.nudoSummary})`,
                );
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
                : [
                    migrateRetire(targets[0]!, {
                      dryRun,
                      ...(wf === false ? { workflows: false } : {}),
                    }),
                  ];
            if (opts.json) {
              console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
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
          console.error(`migrate ${action}: ${(err as Error).message}`);
          process.exitCode = 1;
        }
      },
    );
}
