/**
 * S1 中型 monorepo 语料生成器（确定性、可复现）。
 * 产物落在 `benchmark/s1/.corpus/`（gitignore）——不进仓库，避免膨胀。
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const CORPUS_DIR = join(import.meta.dirname, ".corpus");

/** 中型规模：8 包 × 15 文件 ≈ 120 文件（A6「中型目录」口径） */
export const S1_SCALE = {
  packages: 8,
  filesPerPackage: 15,
};

/** 包名：分层 DAG，pkg0 为高扇入 hub */
const PKG_NAMES = [
  "pkg0-util",
  "pkg1-model",
  "pkg2-store",
  "pkg3-api",
  "pkg4-workflow",
  "pkg5-format",
  "pkg6-app",
  "pkg7-index",
];

/** 包 i 依赖的更低层包（hub=0 被广泛引用） */
function depsOf(pkgIdx: number): number[] {
  if (pkgIdx === 0) return [];
  if (pkgIdx === 1) return [0];
  if (pkgIdx === 2) return [0, 1];
  if (pkgIdx === 3) return [1, 2];
  if (pkgIdx === 4) return [2, 3];
  if (pkgIdx === 5) return [0];
  if (pkgIdx === 6) return [3, 4, 5];
  return [0, 1, 2, 3, 4, 5, 6];
}

function fileBody(pkgIdx: number, fileIdx: number, imports: string[]): string {
  const importLines = imports
    .map((spec, k) => {
      const srcMod = spec.match(/mod(\d+)\.js$/)?.[1] ?? "0";
      return `import { f${srcMod} as dep${k} } from ${JSON.stringify(spec)};`;
    })
    .join("\n");
  const uses = imports.map((_, k) => `  if (typeof dep${k} === "function") acc += 0;`).join("\n");
  // 轮转负载形态：算术 / 分支 / Map / 有界递归 / 类
  const kind = fileIdx % 5;
  let body = "";
  if (kind === 0) {
    body = `
/**
 * @nudo:case "add" (${pkgIdx}, ${fileIdx})
 */
export function f${fileIdx}(a) {
  let acc = 0;
${uses}
  return a + ${fileIdx + 1};
}

/**
 * @nudo:case "dbl" (3)
 */
export function g${fileIdx}(x) {
  return x * 2 + ${pkgIdx};
}
`;
  } else if (kind === 1) {
    body = `
/**
 * @nudo:case "str" ("hello")
 * @nudo:case "num" (7)
 */
export function f${fileIdx}(x) {
  let acc = 0;
${uses}
  if (typeof x === "string") return x.length + ${fileIdx};
  if (x > 10) return x - 1;
  return x + ${pkgIdx};
}

export function g${fileIdx}(x) {
  return f${fileIdx}(x) + 1;
}
`;
  } else if (kind === 2) {
    body = `
/**
 * @nudo:case "map" ()
 */
export function f${fileIdx}() {
  let acc = 0;
${uses}
  const m = new Map();
  m.set("k${fileIdx}", ${fileIdx + 1});
  m.set("n", ${pkgIdx});
  return m.get("k${fileIdx}") + m.get("n");
}

/**
 * @nudo:case "set" ()
 */
export function g${fileIdx}() {
  const s = new Set();
  s.add(${fileIdx});
  s.add(${pkgIdx});
  return s.size;
}
`;
  } else if (kind === 3) {
    body = `
/**
 * @nudo:case "sum" (4)
 */
export function f${fileIdx}(n) {
  let acc = 0;
${uses}
  if (n <= 0) return acc;
  return n + f${fileIdx}(n - 1);
}

export function g${fileIdx}(x) {
  return f${fileIdx}(x) + ${fileIdx};
}
`;
  } else {
    body = `
export class C${fileIdx} {
  constructor(n) {
    this.n = n;
  }
  /**
   * @nudo:case "inc" (1)
   */
  inc(k) {
    this.n = this.n + (k || 1);
    return this.n;
  }
}

/**
 * @nudo:case "run" (2)
 */
export function f${fileIdx}(n) {
  let acc = 0;
${uses}
  const c = new C${fileIdx}(n);
  return c.inc(${pkgIdx});
}
`;
  }
  return `${importLines}\n${body.trim()}\n`;
}

function importSpecs(pkgIdx: number, fileIdx: number): string[] {
  const deps = depsOf(pkgIdx);
  if (deps.length === 0) return [];
  // 每个依赖包的 mod0 都拉一条（hub 高扇入）+ 按文件号打散一条
  const specs: string[] = [];
  for (const dep of deps) {
    specs.push(`../${PKG_NAMES[dep]}/mod0.js`);
  }
  const scatter = deps[fileIdx % deps.length]!;
  const scatterMod = fileIdx % S1_SCALE.filesPerPackage;
  const scatterSpec = `../${PKG_NAMES[scatter]}/mod${scatterMod}.js`;
  if (!specs.includes(scatterSpec)) specs.push(scatterSpec);
  return specs;
}

export type CorpusStats = {
  files: number;
  bytes: number;
  packages: number;
  filesPerPackage: number;
};

export function listCorpusFiles(dir: string = CORPUS_DIR): string[] {
  const out: string[] = [];
  for (const pkg of PKG_NAMES) {
    const pkgDir = join(dir, "packages", pkg);
    if (!existsSync(pkgDir)) continue;
    for (const name of readdirSync(pkgDir).sort()) {
      if (name.endsWith(".js")) out.push(join(pkgDir, name));
    }
  }
  return out;
}

export function corpusStats(files: string[]): CorpusStats {
  let bytes = 0;
  for (const f of files) bytes += statSync(f).size;
  return {
    files: files.length,
    bytes,
    packages: S1_SCALE.packages,
    filesPerPackage: S1_SCALE.filesPerPackage,
  };
}

/** 生成（或重建）语料；返回全部 .js 路径 */
export function generateCorpus(opts: { force?: boolean } = {}): string[] {
  if (opts.force && existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true, force: true });
  if (!existsSync(join(CORPUS_DIR, "packages"))) {
    for (let p = 0; p < S1_SCALE.packages; p++) {
      const pkgDir = join(CORPUS_DIR, "packages", PKG_NAMES[p]!);
      mkdirSync(pkgDir, { recursive: true });
      for (let f = 0; f < S1_SCALE.filesPerPackage; f++) {
        const src = fileBody(p, f, importSpecs(p, f));
        writeFileSync(join(pkgDir, `mod${f}.js`), src);
      }
    }
    writeFileSync(
      join(CORPUS_DIR, "package.json"),
      JSON.stringify({ name: "s1-corpus", private: true, type: "module" }, null, 2) + "\n",
    );
  }
  return listCorpusFiles();
}
