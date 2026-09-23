/**
 * nudo migrate — 从 TypeScript 退役到 Nudo 的单向门。
 *
 * 产品约束（docs/design/cli-semantics.md）：
 * - 出口是 retire tsc（package.json / scripts / 标记）；双跑只允许出现在 verify。
 * - strip 必须保运行时语义（TS 剥除 ≠ 编译变换；enum 等见 strip-types 注释）。
 * - verify 必须可与 tsc 基线对照（迁移期信任来自 diff）。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, extname, join, relative, resolve } from "node:path";
import { generate } from "@babel/generator";
import { parseSource, stripTypes, sidecarPathOf } from "@nudojs/core";
import { draftInterface } from "@nudojs/service";

export type MigrateStatusRow = {
  root: string;
  packageJson: boolean;
  typescriptDep: boolean;
  tsconfig: boolean;
  tscScripts: string[];
  tsFiles: number;
  tsxFiles: number;
  nudoScripts: string[];
  nudoConfig: boolean;
  retired: boolean;
  blockers: string[];
};

export type StripResult = {
  file: string;
  outFile: string;
  sidecarDraft?: string;
  notes: string[];
};

export type VerifyResult = {
  file: string;
  nudoOk: boolean;
  nudoSummary: string;
  tsc?: { ok: boolean; output: string };
};

export type RetireResult = {
  root: string;
  removedDeps: string[];
  rewrittenScripts: Array<{ name: string; from: string; to: string }>;
  marker: string;
};

const TS_EXT = new Set([".ts", ".mts", ".cts"]);
const TSX_EXT = new Set([".tsx"]);

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function listFiles(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 12) return out;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist" || name === ".nudo") {
      continue;
    }
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) listFiles(p, out, depth + 1);
    else out.push(p);
  }
  return out;
}

function packageRoots(root: string): string[] {
  const pkgPath = join(root, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) return [root];
  const workspaces = pkg.workspaces;
  const roots = [root];
  if (Array.isArray(workspaces)) {
    for (const w of workspaces) {
      if (typeof w !== "string") continue;
      // support "packages/*" style
      if (w.endsWith("/*") || w.endsWith("/**")) {
        const base = join(root, w.replace(/\/\*\*?$/, ""));
        if (!existsSync(base)) continue;
        for (const name of readdirSync(base)) {
          const p = join(base, name);
          if (existsSync(join(p, "package.json"))) roots.push(p);
        }
      } else {
        const p = join(root, w);
        if (existsSync(join(p, "package.json"))) roots.push(p);
      }
    }
  }
  return roots;
}

function countExt(files: string[], exts: Set<string>): number {
  let n = 0;
  for (const f of files) {
    const e = extname(f).toLowerCase();
    if (exts.has(e) || (exts === TS_EXT && e === ".ts")) n += 1;
  }
  return n;
}

export function migrateStatus(rootDir: string): MigrateStatusRow[] {
  const raw = resolve(rootDir);
  // 允许传 package.json / 源文件：取所在目录
  const root = existsSync(raw) && statSync(raw).isDirectory() ? raw : dirname(raw);
  const roots = packageRoots(root);
  const rows: MigrateStatusRow[] = [];
  for (const r of roots) {
    const pkgPath = join(r, "package.json");
    const pkg = readJson(pkgPath);
    const files = listFiles(r);
    const tsFiles = files.filter((f) => TS_EXT.has(extname(f).toLowerCase())).length;
    const tsxFiles = files.filter((f) => TSX_EXT.has(extname(f).toLowerCase())).length;
    const scripts = (pkg?.scripts ?? {}) as Record<string, string>;
    const tscScripts = Object.entries(scripts)
      .filter(([, cmd]) => /\btsc\b/.test(cmd))
      .map(([name]) => name);
    const nudoScripts = Object.entries(scripts)
      .filter(([, cmd]) => /\bnudo\b/.test(cmd))
      .map(([name]) => name);
    const deps = {
      ...((pkg?.dependencies ?? {}) as Record<string, string>),
      ...((pkg?.devDependencies ?? {}) as Record<string, string>),
    };
    const retired = existsSync(join(r, ".nudo", "migrate-retired.json"));
    const blockers: string[] = [];
    if (tsxFiles > 0) blockers.push(`${tsxFiles} .tsx (JSX migrate is manual/later)`);
    if (tsFiles > 0 && tscScripts.length > 0) blockers.push("tsc still in scripts");
    if (tsFiles > 0 && !nudoScripts.some((s) => /check|test/.test(s))) {
      blockers.push("no nudo check/test script yet");
    }
    if (deps.typescript) blockers.push("typescript still in dependencies");
    if (tsFiles === 0 && tsxFiles === 0 && !deps.typescript && tscScripts.length === 0) {
      blockers.push("—");
    }
    rows.push({
      root: relative(process.cwd(), r) || ".",
      packageJson: existsSync(pkgPath),
      typescriptDep: Boolean(deps.typescript),
      tsconfig: existsSync(join(r, "tsconfig.json")),
      tscScripts,
      tsFiles,
      tsxFiles,
      nudoScripts,
      nudoConfig: pkg?.nudo !== undefined,
      retired,
      blockers,
    });
  }
  return rows;
}

/** TS 源 → 纯 JS 源（Nudo strip 语义；enum 删除见 strip-types 注释）。 */
export function stripTsToJs(source: string): { code: string; notes: string[] } {
  const notes: string[] = [];
  if (/\benum\s+[A-Za-z_$]/.test(source)) {
    notes.push("contains enum — strip removes it (runtime semantics lost); convert to const object first");
  }
  if (/namespace\s+[A-Za-z_$]/.test(source)) {
    notes.push("contains namespace — non-declare namespaces keep TS nodes and may not print cleanly");
  }
  const ast = parseSource(source, { keepTs: true });
  stripTypes(ast);
  const out = generate(
    ast as never,
    {
      retainLines: true,
      comments: true,
      compact: false,
      jsescOption: { minimal: true },
    },
    source,
  );
  return { code: out.code.endsWith("\n") ? out.code : `${out.code}\n`, notes };
}

export async function migrateStrip(
  paths: string[],
  opts: { write?: boolean; draft?: boolean; backup?: boolean } = {},
): Promise<StripResult[]> {
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) {
      throw new Error(`not found: ${p}`);
    }
    if (statSync(abs).isDirectory()) {
      for (const f of listFiles(abs)) {
        const e = extname(f).toLowerCase();
        if (TS_EXT.has(e) || TSX_EXT.has(e)) files.push(f);
      }
    } else {
      files.push(abs);
    }
  }
  const results: StripResult[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const { code, notes } = stripTsToJs(source);
    const ext = extname(file).toLowerCase();
    const outFile = TSX_EXT.has(ext)
      ? file.replace(/\.tsx$/i, ".jsx")
      : file.replace(/\.tsx$/i, ".js").replace(/\.mts$/i, ".mjs").replace(/\.cts$/i, ".cjs").replace(/\.ts$/i, ".js");
    if (opts.write) {
      if (opts.backup && existsSync(file) && !existsSync(`${file}.bak`)) {
        renameSync(file, `${file}.bak`);
      } else if (opts.backup !== true && existsSync(file) && extname(file).toLowerCase() !== extname(outFile).toLowerCase()) {
        // default: keep .ts in place as .ts.bak only when --backup; else leave source
      }
      writeFileSync(outFile, code, "utf-8");
    }
    let sidecarDraft: string | undefined;
    if (opts.draft !== false && opts.write) {
      try {
        const draft = await draftInterface(outFile, { source: code, bodyAccesses: true });
        if (draft.draftSource && draft.draftSource.trim().length > 0) {
          const sc = sidecarPathOf(outFile);
          if (!existsSync(sc)) {
            mkdirSync(dirname(sc), { recursive: true });
            writeFileSync(sc, draft.draftSource, "utf-8");
            sidecarDraft = sc;
          }
        }
      } catch {
        /* draft is best-effort */
      }
    }
    results.push({
      file: relative(process.cwd(), file),
      outFile: relative(process.cwd(), outFile),
      ...(sidecarDraft ? { sidecarDraft: relative(process.cwd(), sidecarDraft) } : {}),
      notes,
    });
  }
  return results;
}

function runTscBaseline(root: string, files: string[]): { ok: boolean; output: string } {
  try {
    const out = execFileSync(
      "pnpm",
      ["exec", "tsc", "--noEmit", "--pretty", "false", "--skipLibCheck", ...files],
      { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, output: out };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      output: `${err.stdout ?? ""}${err.stderr ?? err.message ?? ""}`.trim(),
    };
  }
}

export async function migrateVerify(
  paths: string[],
  opts: { withTsc?: boolean; root?: string } = {},
): Promise<VerifyResult[]> {
  const { checkSource, formatCheckReport, pTrue } = await import("@nudojs/core");
  const { defaultLoadModule, findProjectConfig, interfaceConfig, checkConfig } = await import(
    "@nudojs/service"
  );
  const files: string[] = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (statSync(abs).isDirectory()) {
      for (const f of listFiles(abs)) {
        const e = extname(f).toLowerCase();
        if (e === ".js" || e === ".mjs" || e === ".cjs" || TS_EXT.has(e) || TSX_EXT.has(e)) {
          files.push(f);
        }
      }
    } else {
      files.push(abs);
    }
  }
  const results: VerifyResult[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf-8");
    const proj = findProjectConfig(dirname(file));
    const cCfg = checkConfig(proj?.config);
    const autoBind = interfaceConfig(proj?.config).autoBind;
    const report = checkSource(file, source, pTrue, {
      loadModule: defaultLoadModule,
      fromFile: file,
      ...(autoBind === false ? { autoBind: false } : {}),
      ...(proj?.projectDir ? { projectDir: proj.projectDir } : {}),
      entryThrows: cCfg.entryThrows,
      ...(cCfg.ignoreThrows && cCfg.ignoreThrows.length > 0
        ? { ignoreThrows: cCfg.ignoreThrows }
        : {}),
    });
    const summary = `${report.summary.errors} error · ${report.summary.warnings} warning · ${report.summary.functions} fn`;
    const row: VerifyResult = {
      file: relative(process.cwd(), file),
      nudoOk: report.ok,
      nudoSummary: summary,
    };
    if (opts.withTsc) {
      // 迁移期对照：仅对 .ts 跑 tsc 基线；.js 无注解则跳过
      if (TS_EXT.has(extname(file).toLowerCase()) || TSX_EXT.has(extname(file).toLowerCase())) {
        row.tsc = runTscBaseline(opts.root ?? process.cwd(), [file]);
      }
    }
    if (!report.ok) {
      // print human report so verify is actionable
      console.log(formatCheckReport(report));
    }
    results.push(row);
  }
  return results;
}

export function migrateRetire(rootDir: string, opts: { dryRun?: boolean } = {}): RetireResult {
  const raw = resolve(rootDir);
  const root = existsSync(raw) && statSync(raw).isDirectory() ? raw : dirname(raw);
  const pkgPath = join(root, "package.json");
  const pkg = readJson(pkgPath);
  if (!pkg) throw new Error(`no package.json under ${rootDir}`);
  const removedDeps: string[] = [];
  const rewrittenScripts: Array<{ name: string; from: string; to: string }> = [];

  for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const bag = pkg[field] as Record<string, string> | undefined;
    if (bag?.typescript) {
      delete bag.typescript;
      removedDeps.push(field);
    }
  }

  const scripts = (pkg.scripts ?? {}) as Record<string, string>;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!/\btsc\b/.test(cmd)) continue;
    let next = cmd
      .replace(/\btsc\s+--noEmit\b/g, "nudo check .")
      .replace(/\btsc\s+-p\s+\S+/g, "nudo check .")
      .replace(/\btsc\b/g, "nudo check .");
    // collapse accidental doubles
    next = next.replace(/nudo check \.\s*&&\s*nudo check \./g, "nudo check .");
    if (next !== cmd) {
      rewrittenScripts.push({ name, from: cmd, to: next });
      scripts[name] = next;
    }
  }
  if (!scripts["check:nudo"] && !Object.values(scripts).some((c) => c.includes("nudo check"))) {
    const to = "nudo check .";
    scripts["check:nudo"] = to;
    rewrittenScripts.push({ name: "check:nudo", from: "(none)", to });
  }

  const markerDir = join(root, ".nudo");
  const marker = join(markerDir, "migrate-retired.json");
  const payload = {
    retiredAt: new Date().toISOString(),
    removedDeps,
    rewrittenScripts,
  };

  if (!opts.dryRun) {
    writeJson(pkgPath, pkg);
    mkdirSync(markerDir, { recursive: true });
    writeJson(marker, payload);
  }

  return {
    root: relative(process.cwd(), root) || ".",
    removedDeps,
    rewrittenScripts,
    marker: relative(process.cwd(), marker),
  };
}

export function formatStatusTable(rows: MigrateStatusRow[]): string {
  const lines: string[] = [];
  lines.push("migrate status");
  lines.push("");
  for (const r of rows) {
    lines.push(`  ${r.root}${r.retired ? "  [retired]" : ""}`);
    lines.push(
      `    ts files: ${r.tsFiles}  tsx: ${r.tsxFiles}  tsconfig: ${r.tsconfig ? "yes" : "no"}  typescript dep: ${r.typescriptDep ? "yes" : "no"}`,
    );
    if (r.tscScripts.length > 0) lines.push(`    tsc scripts: ${r.tscScripts.join(", ")}`);
    if (r.nudoScripts.length > 0) lines.push(`    nudo scripts: ${r.nudoScripts.join(", ")}`);
    if (r.blockers.length > 0 && r.blockers[0] !== "—") {
      lines.push(`    blockers: ${r.blockers.join("; ")}`);
    }
    lines.push("");
  }
  lines.push("next: nudo migrate strip <path>  →  verify  →  retire <pkg>");
  return lines.join("\n");
}
