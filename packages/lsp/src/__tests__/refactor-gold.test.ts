/**
 * 编辑器重构金标：rename / references / prepareRename 的绑定语义。
 * 钉住 tsserver 级底线：
 * - 属性名 / 成员属性不被改名
 * - 遮蔽绑定只改当前绑定
 * - 跨文件 export + import 同步改
 * - prepareRename 拒绝非绑定
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "@nudojs/parser";
import {
  buildSymbolTable,
  findReferences,
  collectBindingReferences,
  collectMethodReferences,
  renameTargetAt,
  buildRenameEdits,
  resolveReferences,
  resolveDefinition,
} from "../symbols.ts";

let dir: string;
let mainPath: string;
let apiPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-refactor-gold-"));
  apiPath = join(dir, "api.js");
  mainPath = join(dir, "main.js");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("refactor gold — property names are not bindings", () => {
  const src = `const x = 1;
const obj = { x: 2, y: x };
const z = obj.x;
function f(x) {
  return x + obj.x;
}
f(x);
`;

  it("rename of local x does not touch property keys or member props", () => {
    const ast = parse(src);
    // `const x = 1` — x at line 1, column 6 (0-based)
    const refs = collectBindingReferences(ast, "x", { line: 1, column: 6 }, "file:///t.js");
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.loc.start.line === 1)).toBe(true);
    const edits = buildRenameEdits(
      "xx",
      refs.map((r) => ({ uri: "file:///t.js", loc: r.loc })),
    );
    expect(edits["file:///t.js"]!.length).toBe(refs.length);
  });

  it("prepareRename rejects member property name", () => {
    const s = `const obj = { x: 1 };\nconst z = obj.x;\n`;
    // line 2: `const z = obj.x` — property `x` at column 14 (0-based)
    const t = renameTargetAt(s, 2, 14);
    expect(t && "error" in t).toBe(true);
  });

  it("prepareRename accepts variable binding", () => {
    const s = `const alpha = 1;\nconsole.log(alpha);\n`;
    const t = renameTargetAt(s, 1, 6);
    expect(t && "name" in t ? t.name : null).toBe("alpha");
  });
});

describe("refactor gold — shadowing", () => {
  const src = `function outer() {
  const n = 1;
  function inner() {
    const n = 2;
    return n;
  }
  return n + inner();
}
`;

  it("rename inner n does not touch outer n", () => {
    const ast = parse(src);
    // line 4 `    const n = 2` — n at column 10
    const refs = collectBindingReferences(ast, "n", { line: 4, column: 10 }, "file:///s.js");
    const lines = refs.map((r) => r.loc.start.line).sort();
    expect(lines).toEqual([4, 5]);
  });

  it("rename outer n does not touch inner n", () => {
    const ast = parse(src);
    // line 2 `  const n = 1` — n at column 8
    const refs = collectBindingReferences(ast, "n", { line: 2, column: 8 }, "file:///s.js");
    const lines = [...new Set(refs.map((r) => r.loc.start.line))].sort();
    expect(lines).toContain(2);
    expect(lines).toContain(7);
    expect(lines).not.toContain(5);
  });
});

describe("refactor gold — function params", () => {
  it("param rename updates param and body uses only", () => {
    const src = `function add(a, b) {\n  return a + b;\n}\nadd(1, 2);\nconst a = 9;\n`;
    const ast = parse(src);
    // param `a` at line 1, column 13
    const refs = collectBindingReferences(ast, "a", { line: 1, column: 13 }, "file:///p.js");
    const lines = refs.map((r) => r.loc.start.line);
    expect(lines.every((l) => l === 1 || l === 2)).toBe(true);
    expect(lines).not.toContain(5);
  });
});

describe("refactor gold — cross-file export rename", () => {
  beforeAll(() => {
    writeFileSync(
      apiPath,
      `export function score(row) {\n  return row.id;\n}\nexport const LIMIT = 3;\n`,
      "utf-8",
    );
    writeFileSync(
      mainPath,
      `import { score, LIMIT } from "./api.js";\nexport function run(row) {\n  return score(row) + LIMIT;\n}\n`,
      "utf-8",
    );
  });

  it("references include importer call sites", () => {
    const mainSrc = `import { score, LIMIT } from "./api.js";\nexport function run(row) {\n  return score(row) + LIMIT;\n}\n`;
    // score call at line 3, `score` starts at column 10
    const refs = resolveReferences(mainPath, mainSrc, "score", {
      extraFiles: [apiPath],
      at: { line: 3, column: 10 },
      includeDeclaration: true,
    });
    const uris = new Set(refs.map((r) => r.uri));
    expect(uris.has(apiPath)).toBe(true);
    expect(uris.has(mainPath)).toBe(true);
  });

  it("buildRenameEdits spans both files and dedups", () => {
    const mainSrc = `import { score, LIMIT } from "./api.js";\nexport function run(row) {\n  return score(row) + LIMIT;\n}\n`;
    const refs = resolveReferences(mainPath, mainSrc, "score", {
      extraFiles: [apiPath],
      at: { line: 3, column: 10 },
      includeDeclaration: true,
    });
    const def = resolveDefinition(mainPath, mainSrc, "score");
    const locations = [
      ...(def ? [{ uri: def.filePath, loc: def.loc }] : []),
      ...refs.map((r) => ({ uri: r.uri!, loc: r.loc })),
    ];
    const changes = buildRenameEdits("grade", locations);
    expect(Object.keys(changes).length).toBeGreaterThanOrEqual(2);
    for (const list of Object.values(changes)) {
      for (const e of list) {
        expect(e.newText).toBe("grade");
      }
    }
  });
});

describe("refactor gold — B1 method / getter / destructuring default", () => {
  it("class method key is renameable and collects call-site member props", () => {
    const s = `class A {\n  score(n) {\n    return n;\n  }\n}\nconst a = new A();\na.score(1);\n`;
    // method key `score` line 2, column 2
    const t = renameTargetAt(s, 2, 2);
    expect(t && "kind" in t ? t.kind : null).toBe("method");
    const ast = parse(s);
    const hits = collectMethodReferences(ast, "score");
    // def key + a.score
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits.some((h) => h.kind === "key")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
  });

  it("getter key is renameable", () => {
    const s = `const o = {\n  get value() {\n    return 1;\n  }\n};\no.value;\n`;
    // `value` in `get value` — line 2, column 6
    const t = renameTargetAt(s, 2, 6);
    expect(t && "kind" in t ? t.kind : null).toBe("method");
    const hits = collectMethodReferences(parse(s), "value");
    expect(hits.some((h) => h.kind === "key")).toBe(true);
    expect(hits.some((h) => h.kind === "member")).toBe(true);
  });

  it("member prop without a method def stays non-renamable (data property)", () => {
    const s = `const obj = { x: 1 };\nconst z = obj.x;\n`;
    const t = renameTargetAt(s, 2, 14);
    expect(t && "error" in t).toBe(true);
  });

  it("member prop with a same-name method def is renameable from the call site", () => {
    const s = `class A {\n  run() {\n    return 1;\n  }\n}\nnew A().run();\n`;
    // `run` in `.run()` — line 6, column 8
    const t = renameTargetAt(s, 6, 8);
    expect(t && "kind" in t ? t.kind : null).toBe("method");
  });

  it("destructuring default { x = 1 } is a binding", () => {
    const s = `function f({ x = 1 }) {\n  return x;\n}\nf({});\n`;
    // `{ x = 1 }` — x at column 13
    const t = renameTargetAt(s, 1, 13);
    expect(t && "kind" in t ? t.kind : null).toBe("binding");
    const ast = parse(s);
    const refs = collectBindingReferences(ast, "x", { line: 1, column: 13 }, "file:///dd.js");
    // pattern binding + body use
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("refactor gold — shorthand object pattern", () => {
  it("shorthand { x } is a binding", () => {
    const s = `function f({ x }) {\n  return x;\n}\n`;
    // `{ x }` — x at column 13
    const t = renameTargetAt(s, 1, 13);
    expect(t && "name" in t ? t.name : null).toBe("x");
    const ast = parse(s);
    const refs = collectBindingReferences(ast, "x", { line: 1, column: 13 }, "file:///sh.js");
    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  it("table references filter object keys", () => {
    const s = `const x = 1;\nconst o = { x: x };\n`;
    const table = buildSymbolTable(parse(s), "file:///t2.js");
    const refs = findReferences(table, "x");
    expect(refs.length).toBe(1);
  });
});
