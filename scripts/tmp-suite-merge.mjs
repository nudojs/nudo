/**
 * THROWAWAY generic merge: fold N test modules into one feature/module suite.
 * Usage: node scripts/tmp-suite-merge.mjs <manifest.json> [--apply]
 * manifest: {dir,target,prefix,sources:[...],entryGlob,header}
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import ts from "typescript";

const repoRoot = new URL("..", import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(process.argv[2], "utf8"));
const apply = process.argv.includes("--apply");
const DIR = manifest.dir;
const TARGET = `${DIR}/${manifest.target}`;
const SOURCES = manifest.sources.map((f) => `${DIR}/${f}`);

function parseFile(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  let total = 0;
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && ["it", "test"].includes(n.expression.text)) total++;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const imports = [];
  const ranges = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st)) continue;
    ranges.push([st.getStart(sf), st.getEnd()]);
    const mod = st.moduleSpecifier.text;
    const clause = st.importClause;
    if (!clause) { imports.push({mod, kind: "side", local: null, imported: null, typeOnly: false}); continue; }
    if (clause.name) imports.push({mod, kind: "default", local: clause.name.text, imported: null, typeOnly: clause.isTypeOnly});
    const nb = clause.namedBindings;
    if (nb && ts.isNamespaceImport(nb)) imports.push({mod, kind: "namespace", local: nb.name.text, imported: null, typeOnly: clause.isTypeOnly});
    else if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) imports.push({
      mod, kind: "named", local: el.name.text,
      imported: (el.propertyName ?? el.name).text,
      typeOnly: clause.isTypeOnly || el.isTypeOnly,
    });
  }
  let body = src;
  for (const [s, e] of ranges.sort((a, b) => b[0] - a[0])) body = body.slice(0, s) + body.slice(e);
  let label = basename(file).replace(/\.(test|part)\.ts$/, "").replace(manifest.prefix, "");
  let desc = null;
  const findDesc = (n) => {
    if (desc) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "describe" && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
      desc = n.arguments[0].text;
      return;
    }
    ts.forEachChild(n, findDesc);
  };
  findDesc(sf);
  if (desc) label = desc;
  return {file, imports, body: body.trim(), total, label};
}

const parsed = SOURCES.map(parseFile);
const totalIts = parsed.reduce((n, p) => n + p.total, 0);
const remaining = parsed.reduce((n, p) => n + (p.body.match(/\bit\(/g) ?? []).length, 0);
if (remaining !== totalIts) throw new Error(`count drift ${remaining} != ${totalIts}`);

const byMod = new Map();
const localMods = new Map();
for (const p of parsed) {
  for (const im of p.imports) {
    if (!byMod.has(im.mod)) byMod.set(im.mod, {default: null, namespace: null, named: new Map(), side: false});
    const slot = byMod.get(im.mod);
    if (im.kind === "side") slot.side = true;
    else if (im.kind === "default") slot.default = {local: im.local, typeOnly: im.typeOnly};
    else if (im.kind === "namespace") slot.namespace = {local: im.local, typeOnly: im.typeOnly};
    else {
      if (!localMods.has(im.local)) localMods.set(im.local, []);
      localMods.get(im.local).push(im.mod);
      const prev = slot.named.get(im.local);
      if (!prev) slot.named.set(im.local, {imported: im.imported, typeOnly: im.typeOnly});
      else if (prev.typeOnly && !im.typeOnly) prev.typeOnly = false;
    }
  }
}
for (const [local, mods] of localMods) {
  const keep = mods[0];
  for (const m of new Set(mods)) if (m !== keep) byMod.get(m)?.named.delete(local);
}

const importLines = [];
for (const [mod, slot] of byMod) {
  const named = [...slot.named].map(([local, v]) => {
    const spec = v.imported === local ? local : `${v.imported} as ${local}`;
    return v.typeOnly ? `type ${spec}` : spec;
  });
  if (slot.side && !slot.default && !slot.namespace && slot.named.size === 0) importLines.push(`import "${mod}";`);
  else if (slot.namespace) importLines.push(`import ${slot.namespace.typeOnly ? "type " : ""}* as ${slot.namespace.local} from "${mod}";`);
  else if (slot.default && named.length) importLines.push(`import ${slot.default.typeOnly ? "type " : ""}${slot.default.local}, { ${named.join(", ")} } from "${mod}";`);
  else if (slot.default) importLines.push(`import ${slot.default.typeOnly ? "type " : ""}${slot.default.local} from "${mod}";`);
  else if (named.length) {
    const allType = [...slot.named.values()].every((v) => v.typeOnly);
    const inner = allType ? named.map((s) => s.replace(/^type /, "")) : named;
    importLines.push(`import ${allType ? "type " : ""}{ ${inner.join(", ")} } from "${mod}";`);
  }
}

const content = `/**
 * ${manifest.header}
 */
${importLines.join("\n")}

${parsed.map((p) => `// ---------------------------------------------------------------------------\n// ${p.label}\n// ---------------------------------------------------------------------------\ndescribe(${JSON.stringify(`[${manifest.prefix.replace(/-$/, "")}] ${p.label}`)}, () => {\n${p.body}\n});`).join("\n\n")}
`;

if (!apply) {
  console.log(`dry: total=${totalIts} files=${parsed.length}`);
  console.log(content.split("\n").slice(0, 16).join("\n"));
  process.exit(0);
}
if (existsSync(join(repoRoot, TARGET))) throw new Error("target exists");
writeFileSync(join(repoRoot, TARGET), content, "utf8");
for (const f of SOURCES) execFileSync("git", ["rm", "-q", f], { cwd: repoRoot });
const names = SOURCES.filter((f) => f.endsWith(".part.ts")).map((f) => basename(f));
const entries = execFileSync("git", ["ls-files", manifest.entryGlob], { cwd: repoRoot, encoding: "utf8" }).trim().split("\n").filter(Boolean);
let touched = 0;
for (const e of entries) {
  const p = join(repoRoot, e);
  const lines = readFileSync(p, "utf8").split("\n");
  const kept = lines.filter((line) => !names.some((n) => line === `import "./${n}";`));
  if (kept.length !== lines.length) { writeFileSync(p, kept.join("\n"), "utf8"); touched++; }
}
console.log(`applied: total=${totalIts} files=${parsed.length} entries=${touched}`);
