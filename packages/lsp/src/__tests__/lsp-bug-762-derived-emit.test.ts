/**
 * Bug 762 —— `nudo.contract.emit` 必须走 **root 驱动下行推导**
 * （`emitDerivedFromRoot`），与 CLI `nudo contract --emit` 同序同口径。
 *
 * 症状（改前）：工具**从不**调 `emitDerivedFromRoot` ⇒
 * - CLI 写得出的下游侧车（`add.nudo.js`）在 IDE 面**永远不产生**；
 * - 结果文本只报「no interface changes / skipped add4 (name-clash)」，
 *   把「引擎没做的那一步」说成「本地侧车被手写占用」——误导性诊断。
 *
 * 协议面回归钉：真 server（mock connection）+ 真协议请求。
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createMockConnection, withLspServer } from "./helpers.ts";
import { contractEmitTool } from "../agent-tools.ts";

const STD = `import { number, fn } from "@nudojs/core";
export const positive = number().gt(0);
export const positive4 = number().gt(4);
`;
const ADD_JS = `export function add2(x) {
  return x + 2;
}
`;
const LIB_JS = `import { add2 } from "./add.js";

export function add4(x) {
  return add2(x + 1) + 1;
}
`;
const LIB_NUDO = `import { fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";

export const add4 = fn({ x: positive }, positive4);
`;

const FIXTURE = {
  "std.nudo.js": STD,
  "add.js": ADD_JS,
  "lib.js": LIB_JS,
  "lib.nudo.js": LIB_NUDO,
};

describe("Bug 762：contract.emit 走 root 驱动下行推导", () => {
  it("工具面：下游侧车 add.nudo.js 被写出来，且文本点名 derived-from", async () => {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const libJs = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file: libJs, functionName: "add4", mode: "update" },
        { workspaceRoots: [dir] },
      );
      const text = r.content[0].text;
      // 结果文本必须有下游侧车这一行（CLI 口径：Updated <root> → <sidecar> (derived-from …)）
      expect(text).toContain("add.nudo.js");
      expect(text).toContain("derived-from add4");
      // 下游侧车真的落盘了
      const side = join(dir, "add.nudo.js");
      expect(existsSync(side)).toBe(true);
      const sideText = readFileSync(side, "utf-8");
      expect(sideText).toContain("derived-from: lib.js:add4");
      expect(sideText).toContain("export const add2 = fn(");
      // 本地侧车（手写 name-clash）的诊断**仍在**（没被推导步吞掉）
      expect(text).toContain("name-clash");
    });
  });

  it("工具面：dry-run 只预览、不写下游侧车", async () => {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const libJs = join(dir, "lib.js");
      const r = await contractEmitTool(
        { file: libJs, functionName: "add4", mode: "update", dryRun: true },
        { workspaceRoots: [dir] },
      );
      expect(r.content[0].text).toContain("dry-run");
      expect(existsSync(join(dir, "add.nudo.js"))).toBe(false);
    });
  });

  it("协议面：nudo.contract.emit 同样产出下游侧车", async () => {
    await withLspServer(FIXTURE, async ({ dir }) => {
      const mock = createMockConnection();
      const { createNudoServer } = await import("../server.ts");
      createNudoServer(mock as unknown as never);
      await mock.requests.get("initialize")!({
        processId: null,
        rootUri: pathToFileURL(dir).href,
        capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(dir).href, name: "root" }],
      });
      const res = await mock.requests.get("workspace/executeCommand")!({
        command: "nudo.contract.emit",
        arguments: [pathToFileURL(join(dir, "lib.js")).href, "add4", "update"],
      });
      expect(res.content[0].text).toContain("add.nudo.js");
      expect(res.content[0].text).toContain("derived-from add4");
      expect(existsSync(join(dir, "add.nudo.js"))).toBe(true);
    });
  });
});
