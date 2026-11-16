/**
 * BDD 结构门禁：测试套件按「describe = 特性/上下文，it = 可观测行为」组织。
 *
 * 矩阵化套件允许把一个 describe 的场景表写进一个 it 标题（`；` 分隔），
 * 但场景体必须是**块语句**，不能再用 IIFE 承载：
 *
 * ```ts
 * describe("absToTSType", () => {
 *   it("字面量 number ⇒ 42；字面量 string ⇒ \"hello\"", () => {
 *     { expect(absToTSType(numLit(42))).toBe("42"); }
 *     { expect(absToTSType(strLit("hello"))).toBe('"hello"'); }
 *   });
 * });
 * ```
 *
 * 规则：
 * 1. 禁止 `it` 回调顶层用 IIFE 承载场景（`(() => {...})()` / `await (async () => {...})()`）；
 *    提前退出用 labeled block（`__scenario_1: { ... break __scenario_1; ... }`）。
 * 2. 禁止块内空语句（机械合并留下的孤立 `;`）。
 * 3. 禁止同名 describe 直接套嵌。
 * 4. describe 标题不得带缺陷号/批次代号（`Bug 123` / `族 12` / `#123`）——
 *    这些只允许出现在 it 标题、commit、changeset。
 * 5. it 标题的场景段不得为空或相邻重复（`a；；b` / `a；a`）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const files = execFileSync("git", ["ls-files", "packages"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => f.endsWith(".test.ts"));

const isFn = (n) => ts.isArrowFunction(n) || ts.isFunctionExpression(n);
const unparen = (n) => (ts.isParenthesizedExpression(n) ? unparen(n.expression) : n);
const norm = (s) => s.replace(/\s+/g, " ").trim();
const titleOf = (n) =>
  n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) ? norm(n.arguments[0].text) : null;

const LABEL_RE = /^(?:\[\]\s*)?(?:Bug\s*[-#]?\s*\d+|BUG-\d+|族\s*\d+|第\s*\d+\s*条|#\d+)/;
const errors = [];

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const at = (n) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const report = (n, message) => errors.push(`${at(n)} ${message}`);

  const walk = (n) => {
    if (ts.isEmptyStatement(n)) {
      const p = n.parent;
      if (ts.isBlock(p) || ts.isSourceFile(p) || ts.isCaseClause(p) || ts.isDefaultClause(p))
        report(n, "空语句（机械合并残留）");
    }

    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "describe") {
      const title = titleOf(n);
      if (title && LABEL_RE.test(title))
        report(n, `describe 标题含缺陷号/批次代号: ${title.slice(0, 60)}`);
      const cb = n.arguments[1];
      if (title && cb && isFn(cb) && ts.isBlock(cb.body)) {
        for (const st of cb.body.statements) {
          if (
            ts.isExpressionStatement(st) &&
            ts.isCallExpression(st.expression) &&
            ts.isIdentifier(st.expression.expression) &&
            st.expression.expression.text === "describe" &&
            titleOf(st.expression) === title
          )
            report(st, `同名 describe 套嵌: ${title.slice(0, 60)}`);
        }
      }
    }

    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      (n.expression.text === "it" || n.expression.text === "test")
    ) {
      const title = titleOf(n);
      if (title !== null && title.includes("；")) {
        const parts = title.split("；").map((p) => p.trim());
        if (parts.some((p) => !p)) report(n, `it 标题场景段为空: ${title.slice(0, 60)}`);
        for (let i = 1; i < parts.length; i++)
          if (parts[i] && parts[i] === parts[i - 1])
            report(n, `it 标题相邻场景重复: ${parts[i].slice(0, 60)}`);
      }
      const cb = n.arguments[1];
      if (cb && isFn(cb) && ts.isBlock(cb.body)) {
        for (const st of cb.body.statements) {
          let e = ts.isExpressionStatement(st) ? st.expression : null;
          if (e && ts.isAwaitExpression(e)) e = e.expression;
          if (!e) continue;
          const c = unparen(e);
          if (c && ts.isCallExpression(c) && c.arguments.length === 0 && isFn(unparen(c.expression)))
            report(st, "it 回调顶层用 IIFE 承载场景；改用块语句 / labeled block");
        }
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}

if (errors.length) {
  console.error(`test-structure: ${errors.length} violation(s)`);
  for (const e of errors.slice(0, 60)) console.error("  " + e);
  if (errors.length > 60) console.error(`  ... ${errors.length - 60} more`);
  process.exit(1);
}
console.log(`test-structure: OK (${files.length} test files)`);
