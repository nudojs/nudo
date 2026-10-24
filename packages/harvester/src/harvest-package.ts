/**
 * Host：从 npm 包 / @types 收集 .d.ts → harvestDts。
 * 代数不碰 fs；这里只做「找到 dts 路径」这一层宿主职责。
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import ts from "typescript";
import { harvestDts, type HarvestedEnv } from "./harvest-dts.ts";
import { formatShape } from "@nudojs/core";
import { BoundedLruMap } from "./lru-map.ts";

/** 包本体是否自带声明（package.json types/typings → index.d.ts） */
function packageDeclaresTypes(root: string): boolean {
  const pj = join(root, "package.json");
  if (existsSync(pj)) {
    try {
      const raw = JSON.parse(readFileSync(pj, "utf8")) as { types?: string; typings?: string };
      const entry = raw.types ?? raw.typings;
      if (typeof entry === "string" && entry.length > 0 && existsSync(resolve(root, entry))) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return existsSync(join(root, "index.d.ts"));
}

/**
 * 在 node_modules 中解析包根（含 @types/*）。
 *
 * 口径与 TypeScript / Node 一致（Bug 833）：
 * 1. **包本体** `node_modules/<pkg>` 的 `types`/`typings` → `<pkg>/index.d.ts`；
 * 2. **最后**才回落 `node_modules/@types/<pkg>`。
 *
 * 跨层查找时「**任意层**的包本体」先于「**任意层**的 `@types`」
 * —— 否则更近层的 `@types/<pkg>` 会盖掉更远层的包本体，
 * 收割到**陈旧的 @types 声明**（另一个版本的 API），且**零诊断**。
 */
export function resolvePackageRoot(
  pkg: string,
  fromDir: string = process.cwd(),
): string | undefined {
  const bare = pkg.replace(/^@/, "").replace(/\//g, "__");
  const start = resolve(fromDir);
  // 第一轮：包本体（任意层；包本体没有声明时不在这里命中）
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const pkgPath = join(dir, "node_modules", pkg);
    if (existsSync(pkgPath) && packageDeclaresTypes(pkgPath)) return pkgPath;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // 第二轮：@types 回落（任意层）
  dir = start;
  for (let i = 0; i < 8; i++) {
    const typesPath = join(dir, "node_modules", "@types", bare);
    if (existsSync(typesPath)) return typesPath;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const SKIP_DIRS = new Set(["node_modules", "test", "tests", "docs", "doc", "examples", "__tests__"]);
/** 单文件上限：巨型 lib.d.ts 级别拖垮 harvest */
const MAX_DTS_BYTES = 1_500_000;

/** 优先入口：index.d.ts / pkg 名 / lib 入口 */
function dtsPriority(p: string, root: string): number {
  const base = basename(p);
  const rel = p.slice(root.length);
  if (base === "index.d.ts") return 0;
  if (base === "index.d.mts") return 1;
  if (rel.includes("/types/") && base === "index.d.ts") return 2;
  if (base.endsWith(".d.ts") && !base.includes(".")) return 3; // foo.d.ts
  return 10;
}

/**
 * 递归收集包内 .d.ts（限制数量 + 跳过超大文件 + 入口优先）。
 */
export function collectDtsFiles(root: string, maxFiles = 8): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (out.length >= maxFiles * 3) return; // 多收一点再排序截断
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= maxFiles * 3) return;
      if (SKIP_DIRS.has(name)) continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) {
        if (st.size > MAX_DTS_BYTES) continue;
        out.push(p);
      }
    }
  };
  walk(root);
  out.sort((a, b) => dtsPriority(a, root) - dtsPriority(b, root) || a.length - b.length);
  return out.slice(0, maxFiles);
}

/** package.json types/typings 入口（若存在且合理大小） */
function entryDtsFromPackageJson(root: string): string | undefined {
  const pj = join(root, "package.json");
  if (!existsSync(pj)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(pj, "utf8")) as {
      types?: string;
      typings?: string;
      exports?: Record<string, unknown>;
    };
    const entry = raw.types ?? raw.typings;
    if (typeof entry === "string" && entry.endsWith(".d.ts")) {
      const p = resolve(root, entry);
      if (existsSync(p)) {
        const st = statSync(p);
        if (st.size <= MAX_DTS_BYTES) return p;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

export type PackageHarvest = {
  pkg: string;
  root: string;
  dtsFiles: string[];
  env: HarvestedEnv;
};

/**
 * 从入口 .d.ts 沿 reference path / 相对 import 做 BFS 收集。
 * 适合 @types 包（三斜线引用图）；比整树 walk 更贴声明入口。
 */
export function collectDtsFromEntry(entry: string, maxFiles = 200): string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  const REFERENCE_PATH_REGEX = /<reference\s+path=["']([^"']+)["']\s*\/>/g;
  const RELATIVE_FROM_REGEX = /\bfrom\s+["'](\.[^"']+)["']/g;

  while (queue.length > 0 && files.length < maxFiles) {
    const current = queue.shift()!;
    if (seen.has(current) || !existsSync(current)) continue;
    seen.add(current);
    if (!current.endsWith(".d.ts")) continue;
    files.push(current);

    let text: string;
    try {
      text = readFileSync(current, "utf-8");
    } catch {
      continue;
    }

    const dir = dirname(current);
    for (const match of text.matchAll(REFERENCE_PATH_REGEX)) {
      queue.push(resolve(dir, match[1]!));
    }
    for (const match of text.matchAll(RELATIVE_FROM_REGEX)) {
      const base = resolve(dir, match[1]!);
      for (const candidate of [`${base}.d.ts`, join(base, "index.d.ts")]) {
        if (existsSync(candidate)) {
          queue.push(candidate);
          break;
        }
      }
    }
  }

  return files;
}

/** harvest 一个 npm 包（或 @types 包） */
export function harvestPackage(
  pkg: string,
  fromDir?: string,
  maxFiles = 24,
): PackageHarvest | { error: string } {
  const root = resolvePackageRoot(pkg, fromDir);
  if (!root) return { error: `package not found: ${pkg}` };
  const entry = entryDtsFromPackageJson(root) ?? join(root, "index.d.ts");
  // 入口 BFS 优先（@types 引用图）；退化为整树 walk
  let dtsFiles = existsSync(entry) ? collectDtsFromEntry(entry, maxFiles) : [];
  if (dtsFiles.length === 0) {
    const collected = collectDtsFiles(root, maxFiles);
    dtsFiles =
      entry && existsSync(entry) && !collected.includes(entry)
        ? [entry, ...collected.filter((f) => f !== entry)].slice(0, maxFiles)
        : collected;
  }
  if (dtsFiles.length === 0) {
    return { error: `no .d.ts under ${root}` };
  }
  const env = harvestDts(dtsFiles);
  return { pkg, root, dtsFiles, env };
}

// ---------------------------------------------------------------------------
// 导出面（export surface）
//
// harvest 的 env 只有两个袋子：`globals`（顶层声明 + `declare global` 内容）与
// `modules`（`declare module "x" { … }` 块）。**globals 袋里的东西不是导出**
// ——`declare global { … }` 的内容与 script 模式（无 import/export）的 `.d.ts`
// 顶层声明都是 **ambient**，TypeScript 侧不可 import（TS2305 / TS2306）。
// ⇒ 桥接层要按「**这个文件导出了什么**」过滤，不能按「它在哪个袋子里」过滤。
// ---------------------------------------------------------------------------

/** 单个 `.d.ts` 的顶层扫描结果 */
export type DtsFileScan = {
  /** 顶层**具名导出**（`export` 修饰符 / `export {X as Y}` / `export default` / `export =`） */
  exported: Set<string>;
  /** **ambient** 声明（`declare global { … }` 内容 + script 模式文件的顶层声明） */
  ambient: Set<string>;
  /** `export * from "…"` 的说明符（需继续解析） */
  stars: string[];
  /** 是否 module 模式（有顶层 import/export） */
  isModule: boolean;
};

/** 顶层声明的名字（函数/类/接口/类型/枚举/命名空间/变量） */
function topLevelNames(stmt: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
    return stmt.name ? [stmt.name.text] : [];
  }
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
    return [stmt.name.text];
  }
  if (ts.isEnumDeclaration(stmt)) return [stmt.name.text];
  if (ts.isModuleDeclaration(stmt)) {
    return ts.isIdentifier(stmt.name) ? [stmt.name.text] : [];
  }
  if (ts.isVariableStatement(stmt)) {
    const names: string[] = [];
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name)) names.push(decl.name.text);
    }
    return names;
  }
  return [];
}

/** 顶层声明的名字（`declare global { … }` 块内） */
function ambientNames(stmt: ts.ModuleDeclaration): string[] {
  const names: string[] = [];
  if (!stmt.body || !ts.isModuleBlock(stmt.body)) return names;
  for (const inner of stmt.body.statements) names.push(...topLevelNames(inner));
  return names;
}

/** 顶层声明的修饰符（export / default …） */
function modifierKinds(stmt: ts.Statement): readonly ts.SyntaxKind[] {
  if (!ts.canHaveModifiers(stmt)) return [];
  return (ts.getModifiers(stmt) ?? []).map((m) => m.kind);
}

/** 空扫描结果（每次新建，避免共享可变对象） */
function emptyScan(): DtsFileScan {
  return {
    exported: new Set(),
    ambient: new Set(),
    stars: [],
    isModule: false,
  };
}

/** 扫描一个 `.d.ts` 的顶层导出面 */
function scanDtsFile(file: string): DtsFileScan {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return emptyScan();
  }
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  } catch {
    return emptyScan();
  }
  const scan: DtsFileScan = {
    exported: new Set(),
    ambient: new Set(),
    stars: [],
    isModule: ts.isExternalModule(sf),
  };
  for (const stmt of sf.statements) {
    if (ts.isModuleDeclaration(stmt)) {
      // `declare global { … }` → ambient（不是任何模块的导出）
      if (ts.isIdentifier(stmt.name) && stmt.name.text === "global") {
        for (const n of ambientNames(stmt)) scan.ambient.add(n);
      }
      // `declare module "x" { … }` → 模块记录（ambient module 块里的声明默认全导出），
      // 不是本文件的顶层导出
      continue;
    }
    if (ts.isExportDeclaration(stmt)) {
      const clause = stmt.exportClause;
      if (!clause) {
        // `export * from "…"`
        if (stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
          scan.stars.push(stmt.moduleSpecifier.text);
        }
        continue;
      }
      if (ts.isNamespaceExport(clause)) {
        scan.exported.add(clause.name.text);
        continue;
      }
      for (const el of clause.elements) scan.exported.add(el.name.text);
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      // `export default X` / `export = X` → 默认导出槽
      scan.exported.add("default");
      continue;
    }
    const names = topLevelNames(stmt);
    const mods = modifierKinds(stmt);
    if (mods.includes(ts.SyntaxKind.DefaultKeyword)) {
      // `export default function foo() {}` ⇒ 导出名是 `default`；
      // 局部名 `foo` **不是**具名导出（TS：`import { foo }` 是 TS2614）
      scan.exported.add("default");
      continue;
    }
    const isExported = mods.includes(ts.SyntaxKind.ExportKeyword);
    for (const n of names) {
      if (isExported) scan.exported.add(n);
      // script 模式（无 import/export）⇒ 顶层声明是全局 ambient；
      // module 模式里未导出的顶层声明是模块私有（既不是导出，也不是 ambient）⇒ 不进任何袋子
      else if (!scan.isModule) scan.ambient.add(n);
    }
  }
  return scan;
}

/** 文件扫描缓存（有界；同一文件只解析一次） */
const fileScanCache = new BoundedLruMap<DtsFileScan>(64);

/** 扫描一个 `.d.ts` 的顶层导出面（带缓存） */
export function dtsFileScan(file: string): DtsFileScan {
  const hit = fileScanCache.get(file);
  if (hit) return hit;
  const scan = scanDtsFile(file);
  fileScanCache.set(file, scan);
  return scan;
}

/** `export * from "./x"` → 目标文件（相对说明符才可判定） */
function resolveStarTarget(spec: string, fromFile: string): string | undefined {
  if (!spec.startsWith(".")) return undefined;
  const raw = resolve(dirname(fromFile), spec);
  const stem = raw.replace(/\.(js|mjs|cjs|ts)$/, "");
  for (const cand of [`${raw}.d.ts`, `${stem}.d.ts`, join(raw, "index.d.ts"), join(stem, "index.d.ts")]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/** 包入口 `.d.ts`（package.json types/typings → index.d.ts → 收割列表首个） */
export function packageEntryFile(h: PackageHarvest): string | undefined {
  const entry = entryDtsFromPackageJson(h.root) ?? join(h.root, "index.d.ts");
  if (existsSync(entry)) return entry;
  return h.dtsFiles[0];
}

/** 包的公开导出面 */
export type PackageExportSurface = {
  /** 公开面的具名导出 */
  names: Set<string>;
  /** 存在**不可判定**的 `export * from "<外部包>"` ⇒ 公开面只知道一部分 */
  unresolved: boolean;
};

const surfaceCache = new WeakMap<PackageHarvest, PackageExportSurface>();

/**
 * 包的公开导出面 = 入口 `.d.ts` 的顶层导出 ∪（`export * from "./x"` 目标文件的顶层导出）。
 *
 * `declare global { … }` 的内容与 script 模式文件的顶层声明**不在**其中
 * ——它们是 ambient，TypeScript 侧不可 import（Bug 1014）。
 */
export function packageExportSurface(h: PackageHarvest): PackageExportSurface {
  const hit = surfaceCache.get(h);
  if (hit) return hit;
  const names = new Set<string>();
  let unresolved = false;
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const scan = dtsFileScan(file);
    for (const n of scan.exported) names.add(n);
    for (const spec of scan.stars) {
      const target = resolveStarTarget(spec, file);
      if (target) visit(target);
      else unresolved = true;
    }
  };
  const entry = packageEntryFile(h);
  if (entry) visit(entry);
  const surface: PackageExportSurface = { names, unresolved };
  surfaceCache.set(h, surface);
  return surface;
}

/** 包内所有 ambient 名字（`declare global { … }` + script 模式顶层声明） */
export function packageAmbientNames(h: PackageHarvest): Set<string> {
  const ambient = new Set<string>();
  for (const file of h.dtsFiles) {
    for (const n of dtsFileScan(file).ambient) ambient.add(n);
  }
  return ambient;
}

/** 子路径说明符（"pkg/sub"）→ 该子路径入口 `.d.ts` */
export function resolveSubpathEntry(root: string, sub: string): string | undefined {
  if (!sub) return undefined;
  const base = resolve(root, sub);
  for (const cand of [`${base}.d.ts`, join(base, "index.d.ts")]) {
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

/** harvest 结果 → 人类可读导出表 */
export function formatHarvestSummary(h: PackageHarvest): string {
  const lines: string[] = [];
  // 族 52 第 6 条：降级数（类型未建模的符号）只在**有降级**时出现（`degraded` 可选）。
  const degraded = h.env.stats.degraded ?? 0;
  lines.push(
    `${h.pkg}: ${h.dtsFiles.length} d.ts, ${h.env.stats.symbols} symbols` +
      (degraded > 0 ? `, ${degraded} degraded` : ""),
  );
  const mods = Object.keys(h.env.modules);
  for (const m of mods.slice(0, 5)) {
    const exports = h.env.modules[m]!;
    const names = Object.keys(exports).slice(0, 12);
    lines.push(`  module "${m}": ${names.join(", ")}${Object.keys(exports).length > 12 ? "…" : ""}`);
  }
  if (mods.length > 5) lines.push(`  … ${mods.length - 5} more modules`);
  return lines.join("\n");
}

/** 取某个导出的展示串（formatShape） */
export function lookupHarvested(
  h: PackageHarvest,
  moduleName: string,
  exportName: string,
): string | undefined {
  // 自有属性读：toString/constructor 等键裸读会踩 Object.prototype 原型链，
  // 把原型成员当 harvest 模块/导出喂给 formatShape
  const mod = Object.hasOwn(h.env.modules, moduleName)
    ? h.env.modules[moduleName]
    : undefined;
  const a =
    (mod !== undefined && Object.hasOwn(mod, exportName) ? mod[exportName] : undefined) ??
    (Object.hasOwn(h.env.globals, exportName) ? h.env.globals[exportName] : undefined);
  if (!a) return undefined;
  return formatShape(a);
}
