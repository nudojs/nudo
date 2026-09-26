/**
 * nudo contract — 契约：打印 / draft / emit。
 * 从 index.ts 原样迁出，行为不变。
 */
import { readFileSync, existsSync, statSync, writeFileSync, realpathSync } from "node:fs";
import { resolve, dirname, relative, join, basename, isAbsolute } from "node:path";
import type { Command } from "commander";
import {
  formatEmitSummary,
  formatInterfaceSurfaceLine,
  unifiedDiff,
} from "@nudojs/service/emit";
import { isNudoTargetPath, type CallRecord } from "@nudojs/service";
import { collectExternalRecords, resolveTargets } from "./shared.ts";

// ---------------------------------------------------------------------------
// contract — 契约：打印 / draft / emit
// ---------------------------------------------------------------------------

async function runContractPrint(file: string, records?: CallRecord[]): Promise<void> {
  const { interfaceSurface } = await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const entries = await interfaceSurface(filePath, { records });
  const rel = relative(process.cwd(), filePath) || filePath;
  console.log(`${rel}`);
  if (entries.length === 0) {
    console.log("  (no top-level functions found)");
    console.log();
    return;
  }
  for (const e of entries) {
    console.log(formatInterfaceSurfaceLine(e));
  }
  console.log();
}

/**
 * contract --from-dts：.d.ts / 包类型 → @nudo:draft 契约草稿。
 * 不执法；人工复制进 *.nudo.js 后才成为 L1 义务。
 */
async function runContractFromDts(
  paths: string[],
  opts: { write: boolean; dryRun: boolean },
): Promise<void> {
  const { dtsPathToContractDraft, dtsToContractDraft } = await import("@nudojs/harvester");
  const { harvestPackage } = await import("@nudojs/harvester");

  if (paths.length === 0) {
    console.error(
      "Usage error: `nudo contract --from-dts` needs a .d.ts file, a directory, or an npm package name.",
    );
    process.exitCode = 1;
    return;
  }

  let label = "dts";
  let dtsFiles: string[] = [];
  const fileLike = paths.filter((p) => existsSync(p));
  const barePkgs = paths.filter((p) => !existsSync(p));

  for (const p of fileLike) {
    const abs = resolve(p);
    if (statSync(abs).isDirectory()) {
      const r = dtsPathToContractDraft(abs, basename(abs));
      dtsFiles.push(...r.files);
    } else if (/\.(d\.)?(m)?ts$/.test(abs) && !abs.endsWith(".d.ts.map")) {
      // .d.ts 或带注解的 .ts 源（迁移：从原 TS 逆向契约）
      dtsFiles.push(abs);
    } else {
      const sibling = abs.replace(/\.[cm]?[jt]sx?$/, ".d.ts");
      if (existsSync(sibling)) dtsFiles.push(sibling);
    }
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
  const base = label.replace(/\.d\.ts$|\.ts$|\.mts$/, "").replace(/[/\\]/g, "-");
  const outName = `${base}.nudo.draft.js`;
  const outPath = resolve(outName);

  if (opts.write) {
    if (opts.dryRun) {
      console.log(`[dry-run] would write ${relative(process.cwd(), outPath) || outPath}`);
      console.log(draft.draftSource);
    } else {
      writeFileSync(outPath, draft.draftSource, "utf-8");
      console.log(
        `wrote  ${relative(process.cwd(), outPath) || outPath}  (${draft.stats.exports} exports from ${draft.stats.files} d.ts)`,
      );
      console.log(
        `next   review, then copy exports into a *.nudo.js sidecar to accept (not enforced until then)`,
      );
    }
  } else {
    console.log(draft.draftSource);
    console.log(
      `// ${draft.stats.exports} projectable exports · ${draft.stats.skipped} skipped · ${draft.stats.files} d.ts`,
    );
    console.log(
      `// pass --write to save as ${outName}; copy into *.nudo.js to enforce`,
    );
  }
}

async function runContractDraft(
  file: string,
  opts: {
    fnNames: string[];
    write: boolean;
    dryRun: boolean;
    json?: boolean;
    records?: CallRecord[];
  },
): Promise<void> {
  const { draftInterface, formatDraftSummary, writeInterfaceDraft, sidecarDraftPath } =
    await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
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
      if (relToRoot.startsWith("..") || isAbsolute(relToRoot)) {
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
    const write = writeInterfaceDraft(filePath, result.draftSource, {
      dryRun: opts.dryRun,
      entries: result.entries,
      ...(projectRoot ? { projectDir: projectRoot } : {}),
    });
    for (const line of formatDraftSummary(rel, draftRel, result, write)) console.log(line);
  } else {
    for (const line of formatDraftSummary(rel, draftRel, result)) console.log(line);
  }
}

async function runContractEmit(
  file: string,
  opts: { fnNames: string[]; all: boolean; dryRun: boolean; exitOnDiff: boolean; records?: CallRecord[] },
): Promise<void> {
  const { emitInterface, emitDerivedFromRoot } = await import("@nudojs/service/emit");
  const filePath = resolve(file);
  const rel = relative(process.cwd(), filePath) || filePath;
  const fnNames = opts.fnNames.length > 0 ? opts.fnNames : undefined;

  let derivedChanged = false;
  const derived = emitDerivedFromRoot(filePath, {
    ...(fnNames ? { fnNames } : {}),
    mode: "update",
    dryRun: opts.dryRun,
    ...(!(fnNames || opts.all) ? { refreshExistingOnly: true } : {}),
  });
  if (derived.hasRoot) {
    for (const sc of derived.sidecars) {
      const scRel = relative(process.cwd(), sc.sidecarPath) || sc.sidecarPath;
      if (sc.changed && opts.dryRun) {
        console.log(`[dry-run] would update ${scRel} (derived-from ${derived.roots.join(", ")}):`);
        console.log(sc.diff ?? "");
      } else if (sc.changed) {
        console.log(`Updated ${rel} → ${scRel} (derived-from ${derived.roots.join(", ")})`);
        console.log(`  written: ${sc.fn}`);
        derivedChanged = true;
      } else {
        console.log(`${scRel}: no derived contract changes (${sc.skipped ?? "no-change"})`);
      }
      for (const i of sc.issues) {
        console.log(`  [${i.severity}] ${i.code}: ${i.message}`);
        // design §1.3：contract 只读/emit 不因分析诊断挡 CI；
        // 仅 usage/IO 与 --exit-on-diff（且须 --dry-run）影响 exit
      }
      if (sc.written) derivedChanged = true;
    }
  }

  let localFnNames = fnNames;
  if (fnNames) {
    try {
      const { localNamedExports } = await import("@nudojs/core");
      const local = localNamedExports(readFileSync(filePath, "utf-8"));
      const filtered = fnNames.filter((n) => local.has(n));
      localFnNames = filtered.length > 0 ? filtered : undefined;
    } catch {
      /* optional: local export scan failed — keep requested fn names */
      localFnNames = fnNames;
    }
  }
  const result = await emitInterface(filePath, {
    ...(localFnNames ? { fnNames: localFnNames } : {}),
    mode: "update",
    all: opts.all,
    dryRun: opts.dryRun,
    records: opts.records,
  });
  if (result.changed && opts.dryRun) {
    console.log(`[dry-run] would update ${rel}:`);
    console.log(result.diff ?? "");
    for (const i of result.issues) {
      console.log(`[${i.severity}] ${i.code}: ${i.message}`);
    }
    for (const s of result.skipped) {
      console.log(`  skipped ${s.fn}: ${s.reason}`);
    }
  } else {
    const sc = relative(process.cwd(), result.sidecarPath) || result.sidecarPath;
    for (const line of formatEmitSummary(rel, sc, result)) console.log(line);
  }
  for (const i of result.issues) {
    if (i.severity === "error") {
      // 仅打印；contract --emit 的 exit 由 usage/IO 与 --exit-on-diff 决定
      console.log(`[${i.severity}] ${i.code}: ${i.message}`);
    }
  }
  const anyChanged = result.changed || derivedChanged;
  if (opts.exitOnDiff && anyChanged) process.exitCode = 1;
  if (anyChanged && !opts.dryRun) {
    console.log(`  re-run \`nudo check ${rel}\` to see the persisted contracts in action`);
  }
}

export function registerContractCommand(program: Command): void {
  program
    .command("contract")
    .description("Draft / emit / print contracts (sidecar interfaces)")
    .argument("[paths...]", "File(s) or directory(s)")
    .option("--emit", "Write/update @generated sidecar segments (mode: update)")
    .option("--draft", "Generate a reviewable contract draft from existing code")
    .option(
      "--from-dts",
      "Reverse TypeScript .d.ts / package types into a reviewable contract draft (NOT enforced)",
    )
    .option("--write", "With --draft / --from-dts: write draft on disk")
    .option(
      "--fn <name>",
      "With --emit/--draft: only these export names (repeatable)",
      (v: string, acc: string[]) => {
        acc.push(v);
        return acc;
      },
      [] as string[],
    )
    .option("--all", "With --emit: target every top-level export (prefer --fn)")
    .option("--dry-run", "With --emit or --draft --write: print instead of writing")
    .option("--exit-on-diff", "With --emit + --dry-run: exit 1 when the sidecar would change")
    .option("--from <paths...>", "Usage-site files feeding domain evidence")
    .option("--json", "With --draft: machine-readable draftSource + unified diff (AI4)")
    .action(
      async (
        paths: string[],
        opts: {
          emit?: boolean;
          draft?: boolean;
          fromDts?: boolean;
          write?: boolean;
          fn?: string[];
          all?: boolean;
          dryRun?: boolean;
          exitOnDiff?: boolean;
          from?: string[];
          json?: boolean;
        },
      ) => {
        if (opts.fromDts) {
          await runContractFromDts(paths, {
            write: opts.write === true,
            dryRun: opts.dryRun === true,
          });
          return;
        }
        if (paths.length === 0) {
          console.error(
            "Usage error: `nudo contract` needs at least one path. " +
              (opts.emit
                ? "Writing filters: --fn <names> / --all (default: only refresh existing @generated segments)."
                : opts.draft
                  ? "Draft mode: pass a file or directory."
                  : "Print-only: pass a file or directory."),
          );
          process.exitCode = 1;
          return;
        }
        if (opts.emit && opts.draft) {
          console.error("Usage error: --emit and --draft are mutually exclusive");
          process.exitCode = 1;
          return;
        }
        if (opts.write && !opts.draft) {
          console.error("Usage error: --write requires --draft");
          process.exitCode = 1;
          return;
        }
        if (opts.exitOnDiff && (!opts.dryRun || !opts.emit)) {
          console.error("--exit-on-diff requires --emit --dry-run");
          process.exitCode = 1;
          return;
        }
        const externalRecords = opts.from?.length ? collectExternalRecords(opts.from) : undefined;
        const targets: string[] = [];
        for (const p of paths) targets.push(...resolveTargets(p));
        const roots = targets.filter((t) => isNudoTargetPath(t));
        if (roots.length === 0) {
          if (targets.length > 0) {
            console.error(`Usage error: no nudo analysis targets in the given paths: ${paths.join(", ")}`);
            process.exitCode = 1;
          }
          return;
        }
        for (const t of roots) {
          try {
            if (opts.draft) {
              await runContractDraft(t, {
                fnNames: opts.fn ?? [],
                write: opts.write === true,
                dryRun: opts.dryRun === true,
                json: opts.json === true,
                records: externalRecords,
              });
            } else if (opts.emit) {
              await runContractEmit(t, {
                fnNames: opts.fn ?? [],
                all: opts.all === true,
                dryRun: opts.dryRun === true,
                exitOnDiff: opts.exitOnDiff === true,
                records: externalRecords,
              });
            } else {
              await runContractPrint(t, externalRecords);
            }
          } catch (err) {
            console.error(`Error analyzing ${relative(process.cwd(), t)}: ${(err as Error).message}`);
            process.exitCode = 1;
          }
        }
      },
    );
}
