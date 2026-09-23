/**
 * contract --from-dts：把 TypeScript `.d.ts` **逆向**成可审阅契约草稿。
 *
 * 产品纪律（docs/design/cli-semantics.md）：
 * - 产物是 `@nudo:draft`，**不** ambient 绑定、**不**进 check 门禁。
 * - 人工审阅后复制进 `*.nudo.js` 才成为 L1 义务（C0：义务只来自显式契约）。
 * - dts 表达不了的 Pred 代数（x>0 ⇒ x+1>1）由作者在接受后手工加强。
 *
 * 映射：TS 类型节点 → 约束构建器 DSL（number()/shape()/fn()/…），
 * 不经 Abs 往返——保留形参名，草稿可直接改。
 */
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import ts from "typescript";

export type DtsExportDraft = {
  name: string;
  /** `fn({ … }, …)` 或值约束 DSL；不可投影 → undefined + note */
  dsl?: string;
  note?: string;
  kind: "function" | "value" | "class" | "other";
};

export type DtsContractDraft = {
  label: string;
  files: string[];
  exports: DtsExportDraft[];
  draftSource: string;
  stats: { files: number; exports: number; skipped: number };
};

const BUILDERS = [
  "fn",
  "number",
  "string",
  "boolean",
  "any",
  "shape",
  "array",
  "lit",
  "union",
] as const;

function keywordDsl(node: ts.TypeNode): string | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.NumberKeyword:
      return "number()";
    case ts.SyntaxKind.StringKeyword:
      return "string()";
    case ts.SyntaxKind.BooleanKeyword:
      return "boolean()";
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
    case ts.SyntaxKind.VoidKeyword:
    case ts.SyntaxKind.UndefinedKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ObjectKeyword:
    case ts.SyntaxKind.NeverKeyword:
      return "any()";
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
      return undefined;
    default:
      return undefined;
  }
}

function litDsl(node: ts.LiteralTypeNode): string | undefined {
  const lit = node.literal;
  if (ts.isStringLiteral(lit)) return `lit(${JSON.stringify(lit.text)})`;
  if (ts.isNumericLiteral(lit)) return `lit(${lit.text})`;
  if (lit.kind === ts.SyntaxKind.TrueKeyword) return "lit(true)";
  if (lit.kind === ts.SyntaxKind.FalseKeyword) return "lit(false)";
  return undefined;
}

function typeRefName(node: ts.TypeReferenceNode): string {
  const n = node.typeName;
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isQualifiedName(n)) {
    const parts: string[] = [];
    let cur: ts.EntityName = n;
    while (ts.isQualifiedName(cur)) {
      parts.unshift(cur.right.text);
      cur = cur.left;
    }
    if (ts.isIdentifier(cur)) parts.unshift(cur.text);
    return parts.join(".");
  }
  return "?";
}

function typeToDsl(node: ts.TypeNode | undefined, depth = 0): string | undefined {
  if (!node || depth > 6) return "any()";
  const kw = keywordDsl(node);
  if (kw !== undefined) return kw;

  if (ts.isLiteralTypeNode(node)) {
    return litDsl(node) ?? "any()";
  }
  if (ts.isArrayTypeNode(node)) {
    const el = typeToDsl(node.elementType, depth + 1) ?? "any()";
    return `array(${el})`;
  }
  if (ts.isUnionTypeNode(node)) {
    const parts = node.types.map((t) => typeToDsl(t, depth + 1) ?? "any()");
    if (parts.length === 0) return "any()";
    if (parts.length === 1) return parts[0];
    return `union(${parts.join(", ")})`;
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return typeToDsl(node.type, depth + 1);
  }
  if (ts.isTypeLiteralNode(node)) {
    const fields: string[] = [];
    for (const m of node.members) {
      if (!ts.isPropertySignature(m)) continue;
      const key = m.name && (ts.isIdentifier(m.name) || ts.isStringLiteral(m.name))
        ? ts.isIdentifier(m.name) ? m.name.text : m.name.text
        : undefined;
      if (!key) continue;
      const optional = m.questionToken ? true : false;
      const val = typeToDsl(m.type, depth + 1) ?? "any()";
      fields.push(optional ? `${key}: ${val}.optional()` : `${key}: ${val}`);
    }
    return fields.length === 0 ? "shape({})" : `shape({ ${fields.join(", ")} })`;
  }
  if (ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) {
    return fnSignatureDsl(node.parameters, node.type, depth);
  }
  if (ts.isTypeReferenceNode(node)) {
    const name = typeRefName(node);
    const args = node.typeArguments ?? [];
    if (name === "Array" || name === "ReadonlyArray" || name === "readonly") {
      const el = args[0] ? typeToDsl(args[0], depth + 1) : "any()";
      return `array(${el ?? "any()"})`;
    }
    if (name === "Promise") {
      // eff 面不进契约 DSL；结果类型作返回
      return args[0] ? typeToDsl(args[0], depth + 1) : "any()";
    }
    if (name === "Record") {
      const val = args[1] ? typeToDsl(args[1], depth + 1) : "any()";
      return `shape({}) /* open Record → ${val ?? "any()"} */`;
    }
    if (name === "Partial" && args[0]) {
      const inner = typeToDsl(args[0], depth + 1);
      // 字段全 optional 的近似：保持 shape，字段已是 optional 则原样
      return inner ?? "any()";
    }
    // 未建模的引用类型（用户自定义 interface / class）→ 诚实 any
    return undefined;
  }
  if (ts.isExpressionWithTypeArguments(node as unknown as ts.ExpressionWithTypeArguments)) {
    return undefined;
  }
  return undefined;
}

function fnSignatureDsl(
  params: readonly ts.ParameterDeclaration[],
  ret: ts.TypeNode | undefined,
  depth: number,
): string {
  const fields: string[] = [];
  const notes: string[] = [];
  params.forEach((p, i) => {
    let name: string;
    if (p.name && ts.isIdentifier(p.name)) name = p.name.text;
    else name = `p${i}`;
    if (p.dotDotDotToken) {
      notes.push(`${name}: rest — array()`);
      fields.push(`${name}: array(any())`);
      return;
    }
    const optional = Boolean(p.questionToken) || p.initializer;
    let dsl = typeToDsl(p.type, depth + 1);
    if (dsl === undefined) {
      notes.push(`${name}: unmodeled type → any()`);
      dsl = "any()";
    }
    fields.push(optional ? `${name}: ${dsl}.optional()` : `${name}: ${dsl}`);
  });
  let retDsl = typeToDsl(ret, depth + 1);
  if (retDsl === undefined) {
    notes.push(`returns: unmodeled → any()`);
    retDsl = "any()";
  }
  const obj = fields.length === 0 ? "{}" : `{ ${fields.join(", ")} }`;
  return `fn(${obj}, ${retDsl})`;
}

function pickName(decl: ts.NamedDeclaration): string | undefined {
  return decl.name && ts.isIdentifier(decl.name) ? decl.name.text : undefined;
}

function collectExports(
  sourceFile: ts.SourceFile,
): DtsExportDraft[] {
  const out: DtsExportDraft[] = [];
  const push = (e: DtsExportDraft): void => {
    out.push(e);
  };

  for (const stmt of sourceFile.statements) {
    // export function / export declare function
    if (
      (ts.isFunctionDeclaration(stmt) || ts.isMethodSignature(stmt)) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      const name = pickName(stmt);
      if (!name) continue;
      const fn = stmt as ts.FunctionDeclaration;
      const dsl = fnSignatureDsl(fn.parameters, fn.type, 0);
      push({ name, dsl, kind: "function" });
      continue;
    }
    // export declare function (already covered) — also non-export declare in module
    if (ts.isFunctionDeclaration(stmt) && pickName(stmt)) {
      // only exported
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExport) continue;
      const name = pickName(stmt)!;
      push({ name, dsl: fnSignatureDsl(stmt.parameters, stmt.type, 0), kind: "function" });
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExport) continue;
      for (const d of stmt.declarationList.declarations) {
        const name = pickName(d);
        if (!name) continue;
        const dsl = typeToDsl(d.type, 0);
        if (dsl === undefined) {
          push({ name, note: "unmodeled type", kind: "value" });
        } else if (dsl.startsWith("fn(")) {
          push({ name, dsl, kind: "function" });
        } else {
          push({ name, dsl, kind: "value" });
        }
      }
      continue;
    }
    if (ts.isClassDeclaration(stmt)) {
      const isExport = stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      if (!isExport) continue;
      const name = pickName(stmt);
      if (!name) {
        push({ name: "default", note: "anonymous class", kind: "class" });
        continue;
      }
      // class 方法 → Class.method 草稿行
      let anyMethod = false;
      for (const m of stmt.members) {
        if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) {
          const mname = pickName(m);
          if (!mname) continue;
          anyMethod = true;
          push({
            name: `${name}.${mname}`,
            dsl: fnSignatureDsl(m.parameters, (m as ts.MethodDeclaration).type, 0),
            kind: "function",
          });
        }
      }
      if (!anyMethod) {
        push({ name, note: "class without public methods projected", kind: "class" });
      }
      continue;
    }
    if (ts.isExportAssignment(stmt)) {
      // export = / export default expr
      push({ name: "default", note: "export assignment — bind via sidecar default", kind: "other" });
      continue;
    }
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) {
      // 类型不是运行时契约；跳过
      continue;
    }
  }
  return out;
}

function draftExportName(name: string): string {
  return name.includes(".") ? name.replace(/\./g, "_") : name;
}

/** 组装 `@nudo:draft` 模块（与 formatDraftModule 同纪律：不 ambient 绑定）。 */
export function formatDtsContractDraft(
  label: string,
  files: string[],
  exports: DtsExportDraft[],
): string {
  const draftable = exports.filter((e) => e.dsl !== undefined);
  const used = new Set<string>(["fn"]);
  for (const e of draftable) {
    for (const b of BUILDERS) {
      if (new RegExp(`\\b${b}\\b`).test(e.dsl!)) used.add(b);
    }
  }
  // any() 也要
  if (draftable.some((e) => /\bany\s*\(/.test(e.dsl!))) used.add("any");
  const importList = BUILDERS.filter((b) => used.has(b)).join(", ");

  const lines: string[] = [
    "// @nudo:draft",
    `// Generated by \`nudo contract --from-dts\` from ${label}`,
    `// Sources: ${files.map((f) => basename(f)).join(", ")}`,
    "//",
    "// Reverse-engineered from TypeScript declarations — NOT a sidecar contract.",
    "// This file is never loaded for check. Review each export, then copy it",
    "// into <target>.nudo.js to accept (that is when obligations go live).",
    "//",
    "// After accept: strengthen with Pred builders (number().gt(0) …) —",
    "// dts cannot express algebraic implications (x>0 ⇒ x+1>1).",
    "",
    `import { ${importList} } from "@nudojs/core";`,
    "",
  ];

  if (draftable.length === 0) {
    lines.push("// (no projectable exports)");
    lines.push("");
  }

  for (const e of exports) {
    if (e.dsl === undefined) {
      lines.push(`// ${e.name} — skipped (${e.note ?? "unmodeled"})`);
      continue;
    }
    if (e.note) lines.push(`// ${e.name} — ${e.note}`);
    else lines.push(`// ${e.name} — from TypeScript`);
    lines.push(`export const ${draftExportName(e.name)} = ${e.dsl};`);
    if (e.name.includes(".")) {
      lines.push(`//   sidecar key may also be written as \`${e.name}\``);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function readDtsFiles(paths: string[], maxFiles = 16): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || out.length >= maxFiles * 3) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "node_modules" || name === "test" || name === "__tests__") continue;
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name.endsWith(".d.ts") && !name.endsWith(".d.ts.map")) out.push(p);
    }
  };
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, 0);
    else if (/\.d\.ts$/.test(p) || /\.(m)?ts$/.test(p)) {
      if (!p.endsWith(".d.ts.map")) out.push(p);
    }
  }
  return out.slice(0, maxFiles);
}

/**
 * 从 .d.ts 路径列表生成契约草稿（不写盘）。
 * `label` 用于头注释（包名或描述）。
 */
export function dtsToContractDraft(
  dtsFiles: string[],
  label?: string,
): DtsContractDraft {
  const files = dtsFiles.filter((f) => existsSync(f));
  const exports: DtsExportDraft[] = [];
  let skippedFiles = 0;
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      skippedFiles++;
      continue;
    }
    const sf = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    for (const e of collectExports(sf)) {
      // 去重：同名取先
      if (exports.some((x) => x.name === e.name && x.dsl)) continue;
      exports.push(e);
    }
  }
  const name = label ?? (files[0] ? basename(files[0]).replace(/\.d\.ts$/, "") : "dts");
  const draftSource = formatDtsContractDraft(name, files, exports);
  return {
    label: name,
    files,
    exports,
    draftSource,
    stats: {
      files: files.length - skippedFiles,
      exports: exports.filter((e) => e.dsl !== undefined).length,
      skipped: exports.filter((e) => e.dsl === undefined).length + skippedFiles,
    },
  };
}

/** 目录/文件入口：内部解析 .d.ts 列表。 */
export function dtsPathToContractDraft(
  path: string,
  label?: string,
): DtsContractDraft {
  const files = readDtsFiles([path]);
  return dtsToContractDraft(files, label ?? basename(path).replace(/\.d\.ts$/, ""));
}

export { dirname as dtsDraftDirname };
