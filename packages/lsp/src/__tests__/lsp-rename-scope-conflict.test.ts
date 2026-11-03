/**
 * rename 作用域冲突检测（Bug 750 自认的「独立后续项」，此处落地）。
 *
 * Bug 750 只做了新名的**语法层**校验（合法标识符 / 非保留字 / 非空）⇒ 合法的
 * 新名仍可与既有绑定撞车 ⇒ 一次改名就把源码改坏：
 * - 同作用域重复声明（`const a` + 改 `f`→`a`）⇒ `SyntaxError`；
 * - 捕获（外层已有 `newName` 且在目标作用域内被引用 / 目标引用落在声明了
 *   `newName` 的内层作用域里）⇒ 引用静默指向别的绑定。
 *
 * 修法（哲学与 Bug 712「歧义接收者拒绝改名」同源：**拒绝优于改坏**）：
 * `renameNameConflicts`（symbols.ts）按目标身份判冲突：
 * - binding：babel 作用域链上三类冲突（重复声明 / 内层遮蔽捕获 / 外层捕获）；
 *   纯遮蔽（外层 `newName` 存在但目标作用域内零引用）**允许**；
 * - method：只查同归属内成员名冲突（方法键不是绑定，同名 key 语义不同）；
 * - private：同类体内已有 `#newName` ⇒ 重复私有名；
 * - export：模块导出名空间里已有 `newName` ⇒ 重复导出。
 * 冲突 ⇒ rename 返回 `null`（不产出任何编辑）。
 *
 * 跨文件：编辑会落到 def 所在文件（import / re-export）⇒ 冲突判定在 def 文件
 * 的作用域里再做一遍（当前文件干净、def 文件撞名 ⇒ 改完照样重复声明）。
 */
import { describe, it, expect } from "vitest";
import { withLspServer } from "./helpers.ts";

type Edit = {
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  newText: string;
};

const editsOf = (res: unknown): Edit[] =>
  Object.values((res as { changes?: Record<string, Edit[]> } | null)?.changes ?? {}).flat();

/** 触点同模块作用域：`const a` + `function f` */
const DUP_SRC = `const a = 1;
export function f() {}
`;

/** 嵌套作用域（同层冲突）：函数体内已有 `b` ⇒ 改 `x`→`b` 是重复声明 */
const SHADOW_SAME_SRC = `export const b = 1;
export function f() {
  const x = 2;
  const b = 3;
  return x + b;
}
`;

/** 嵌套作用域（纯遮蔽，不同层级）：目标作用域内零 `b` 引用 ⇒ 允许 */
const SHADOW_OK_SRC = `export const b = 1;
export function f() {
  const x = 2;
  return x;
}
`;

/** 外层捕获：外层 `b` 在目标作用域内被引用 ⇒ 改 `x`→`b` 会截胡那条引用 */
const CAPTURE_SRC = `export const b = 1;
export function f() {
  const x = 2;
  return x + b;
}
`;

/** 内层捕获：目标 `x` 的引用落在声明了 `y` 的内层函数里 */
const INNER_CAPTURE_SRC = `export function f() {
  const x = 1;
  function g() {
    const y = 2;
    return y + x;
  }
  return g() + x;
}
`;

/** 方法臂：同归属（类 K）里已有 `stop` 成员 */
const METHOD_SRC = `export class K {
  run() {
    return 1;
  }
  stop() {
    return 2;
  }
}
export const k = new K();
export function go() {
  return k.run();
}
`;

/** 跨文件：def 文件模块作用域已有 `fresh` */
const XDEF_SRC = `export function old() {
  return 1;
}
export const fresh = 2;
`;
const XUSE_SRC = `import { old } from "./x-def.js";

export function use() {
  return old();
}
`;

/** 私有成员臂：同类里已有 `#other` */
const PRIVATE_SRC = `export class C {
  #total() {
    return 1;
  }
  #other() {
    return 2;
  }
}
`;

describe("rename 作用域冲突 ⇒ 拒绝改名（拒绝优于改坏）", () => {
  it("同作用域重复声明：`const a` + 改 f→a ⇒ 拒绝（无 WorkspaceEdit）", async () => {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 }, // f（声明位）
        newName: "a",
      });
      expect(res, "改 f→a 会制造 `const a` + `function a` 重复声明，必须拒绝").toBeNull();
    });
  });

  it("回归：同文件改 f→bb ⇒ 正常产出编辑", async () => {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 },
        newName: "bb",
      });
      const edits = editsOf(res);
      expect(edits, "合法新名被误拒").toHaveLength(1);
      expect(edits[0]!.newText).toBe("bb");
    });
  });

  it("嵌套作用域·同层已有 b：改 x→b ⇒ 拒绝", async () => {
    await withLspServer({ "sh-same.js": SHADOW_SAME_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("sh-same.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      expect(res, "函数体同层已有 `const b`，改 x→b 是重复声明，必须拒绝").toBeNull();
    });
  });

  it("嵌套作用域·纯遮蔽（不同层级）：改 x→b ⇒ 允许（合法且无语义变化的 JS）", async () => {
    await withLspServer({ "sh-ok.js": SHADOW_OK_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("sh-ok.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      const edits = editsOf(res);
      expect(edits, "纯遮蔽（目标作用域内零 b 引用）被误拒").toHaveLength(2);
      expect(edits.every((e) => e.newText === "b")).toBe(true);
    });
  });

  it("外层捕获：外层 b 在目标作用域内被引用 ⇒ 改 x→b 拒绝", async () => {
    await withLspServer({ "cap.js": CAPTURE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("cap.js") },
        position: { line: 2, character: 8 }, // const x
        newName: "b",
      });
      expect(
        res,
        "改后 `x + b` 变 `b + b`，第二项从外层 b 被截胡成本地 x ⇒ 语义静默改变，必须拒绝",
      ).toBeNull();
    });
  });

  it("内层捕获：目标 x 的引用落在声明了 y 的内层作用域 ⇒ 改 x→y 拒绝", async () => {
    await withLspServer({ "inner.js": INNER_CAPTURE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("inner.js") },
        position: { line: 1, character: 8 }, // const x
        newName: "y",
      });
      expect(
        res,
        "改后 g 体内的 x 变 y、解析到 g 自己的 y（遮蔽捕获）⇒ 语义静默改变，必须拒绝",
      ).toBeNull();
    });
  });

  it("方法臂：同归属已有同名成员 run→stop ⇒ 拒绝；run→walk ⇒ 正常改名", async () => {
    await withLspServer({ "m.js": METHOD_SRC }, async ({ req, uri }) => {
      const conflict = req("textDocument/rename")({
        textDocument: { uri: uri("m.js") },
        position: { line: 1, character: 2 }, // run 键
        newName: "stop",
      });
      expect(conflict, "类 K 已有 stop 成员，改完 = 重复成员键，必须拒绝").toBeNull();

      const ok = req("textDocument/rename")({
        textDocument: { uri: uri("m.js") },
        position: { line: 1, character: 2 },
        newName: "walk",
      });
      const edits = editsOf(ok);
      // 定义位（run 键）+ 使用位（k.run()）
      expect(edits, "合法方法名被误拒").toHaveLength(2);
      expect(edits.every((e) => e.newText === "walk")).toBe(true);
    });
  });

  it("跨文件：def 文件模块作用域已有 fresh ⇒ 从 importer 发起 old→fresh 拒绝", async () => {
    await withLspServer({ "x-def.js": XDEF_SRC, "x-use.js": XUSE_SRC }, async ({ req, uri }) => {
      const conflict = req("textDocument/rename")({
        textDocument: { uri: uri("x-use.js") },
        position: { line: 3, character: 9 }, // old() 用点
        newName: "fresh",
      });
      expect(conflict, "x-def.js 已有 `export const fresh`，改完 = 重复导出，必须拒绝").toBeNull();

      const ok = req("textDocument/rename")({
        textDocument: { uri: uri("x-use.js") },
        position: { line: 3, character: 9 },
        newName: "brandNew",
      });
      const edits = editsOf(ok);
      // def 文件声明 + 本文件 imported 侧 + 用点
      expect(edits, "合法跨文件新名被误拒").toHaveLength(3);
    });
  });

  it("私有成员臂：同类已有 #other ⇒ 改 #total→other 拒绝", async () => {
    await withLspServer({ "p.js": PRIVATE_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/rename")({
        textDocument: { uri: uri("p.js") },
        position: { line: 1, character: 3 }, // total 标识符段（不含 #）
        newName: "other",
      });
      expect(res, "类 C 已有 #other，改完 = 重复私有名（SyntaxError），必须拒绝").toBeNull();
    });
  });

  it("prepareRename：handler 已注册且返回标识符 range + placeholder", async () => {
    await withLspServer({ "dup.js": DUP_SRC }, async ({ req, uri }) => {
      const res = req("textDocument/prepareRename")({
        textDocument: { uri: uri("dup.js") },
        position: { line: 1, character: 16 },
      }) as { range?: unknown; placeholder?: string } | null;
      expect(res, "prepareRename 必须可答（capabilities 声明了 prepareProvider:true）").not.toBeNull();
      expect(res!.range).toEqual({
        start: { line: 1, character: 16 },
        end: { line: 1, character: 17 },
      });
      expect(res!.placeholder).toBe("f");
    });
  });
});
