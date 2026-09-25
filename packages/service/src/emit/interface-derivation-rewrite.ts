/**
 * 生成段标识符改写与 formatDerivedSection。
 * 自 interface-derivation.ts 机械拆出；语义未改。
 */
import { relative, resolve } from "node:path";
import type { DerivedExport } from "./interface-derivation-project.ts";

function resolveRelImport(fromSpec: string, fromDir: string, targetDir: string): string {
  const abs = resolve(fromDir, fromSpec);
  let rel = relative(targetDir, abs);
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel.split("\\").join("/");
}

/** 侧车顶层已占用标识符 → 新段 local / import 名避让 */
class NameAllocator {
  private readonly taken: Set<string>;
  constructor(initial?: Iterable<string>) {
    this.taken = new Set(initial ?? []);
  }
  claim(preferred: string): string {
    if (!this.taken.has(preferred)) {
      this.taken.add(preferred);
      return preferred;
    }
    let i = 2;
    while (this.taken.has(`${preferred}_${i}`)) i++;
    const name = `${preferred}_${i}`;
    this.taken.add(name);
    return name;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 整词替换标识符（避免 `x` 误伤 `x_0` / 属性 `.x`） */
function rewriteIdents(src: string, map: Map<string, string>): string {
  if (map.size === 0) return src;
  let out = src;
  // 长名优先，避免 `x` 先替换破坏 `x_0`
  const keys = [...map.keys()].sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const v = map.get(k)!;
    if (k === v) continue;
    out = out.replace(new RegExp(`(?<![\\w$.])${escapeRegExp(k)}(?![\\w$])`, "g"), v);
  }
  return out;
}

function preludeLocalName(line: string): string | undefined {
  const m = /^const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line.trim());
  return m?.[1];
}

/**
 * 组装生成段（组合式 + import + prelude）。
 * importFrom 相对 root 侧车解析，再相对 target 侧车写出。
 *
 * `takenNames`：侧车顶层已占用标识符（手写 / 既有生成段 / 本批先前段）。
 * 同文件多导出时对 import local 与 prelude local 做避让改写，
 * 保证拼出的侧车在模块作用域内无重复声明。
 */
export function formatDerivedSection(
  row: DerivedExport,
  opts: {
    rootSidecarDir: string;
    targetSidecarDir: string;
    takenNames?: Iterable<string>;
  },
): { text: string; usedNames: string[] } | undefined {
  if (row.underivable || row.params.length === 0) return undefined;
  const importMap = new Map<string, string>(); // original name → resolved path
  const preludes: string[] = [];
  const paramDsls: string[] = [];

  for (const p of row.params) {
    for (const imp of p.imports) {
      const rel = resolveRelImport(imp.from, opts.rootSidecarDir, opts.targetSidecarDir);
      const prev = importMap.get(imp.name);
      if (prev !== undefined && prev !== rel) return undefined;
      importMap.set(imp.name, rel);
    }
    for (const line of p.prelude) {
      if (!preludes.includes(line)) preludes.push(line);
    }
    paramDsls.push(p.dsl);
  }

  let retDsl = "";
  if (row.returns) {
    for (const imp of row.returns.imports) {
      const rel = resolveRelImport(imp.from, opts.rootSidecarDir, opts.targetSidecarDir);
      const prev = importMap.get(imp.name);
      // 与参数位同口径：同名不同路径 → 本段不可投影（禁止静默覆盖）
      if (prev !== undefined && prev !== rel) return undefined;
      importMap.set(imp.name, rel);
    }
    for (const line of row.returns.prelude) {
      if (!preludes.includes(line)) preludes.push(line);
    }
    retDsl = `, ${row.returns.dsl}`;
  }

  // ---- 名字分配：先占 export 名，再 import local，再 prelude local ----
  const namer = new NameAllocator(opts.takenNames);
  namer.claim(row.fn);
  const renames = new Map<string, string>();
  const importLocals: Array<{ original: string; local: string; from: string }> = [];
  for (const [name, from] of [...importMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const local = namer.claim(name);
    if (local !== name) renames.set(name, local);
    importLocals.push({ original: name, local, from });
  }

  const preludeClaimed = new Set<string>();
  const renamedPreludes: string[] = [];
  for (const line of preludes) {
    const local = preludeLocalName(line);
    if (local !== undefined && !preludeClaimed.has(local)) {
      preludeClaimed.add(local);
      if (!renames.has(local)) {
        const next = namer.claim(local);
        if (next !== local) renames.set(local, next);
      }
    }
    renamedPreludes.push(rewriteIdents(line, renames));
  }

  // `{ x }` shorthand when rewritten dsl matches rewritten param-local binding
  const paramParts = row.params.map((p, i) => {
    const dsl = rewriteIdents(paramDsls[i]!, renames);
    const name = rewriteIdents(p.name, renames);
    return dsl === name ? name : `${name}: ${dsl}`;
  });
  const retPart = retDsl === "" ? "" : `, ${rewriteIdents(row.returns!.dsl, renames)}`;

  const importLineTexts = importLocals
    .map(({ original, local, from }) => {
      const spec = original === local ? local : `${original} as ${local}`;
      return `import { ${spec} } from ${JSON.stringify(from)};`;
    })
    .sort((a, b) => a.localeCompare(b));

  const lines = [
    ...importLineTexts,
    ...(importLineTexts.length > 0 && renamedPreludes.length > 0 ? [""] : []),
    ...renamedPreludes,
    `export const ${row.fn} = fn({ ${paramParts.join(", ")} }${retPart});`,
  ];

  const usedNames = new Set<string>();
  for (const { local } of importLocals) usedNames.add(local);
  for (const line of renamedPreludes) {
    const n = preludeLocalName(line);
    if (n) usedNames.add(n);
  }
  usedNames.add(row.fn);

  return { text: lines.join("\n"), usedNames: [...usedNames] };
}

