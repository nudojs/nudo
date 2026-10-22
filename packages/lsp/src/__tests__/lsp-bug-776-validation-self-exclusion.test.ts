/**
 * Bug 776（validation.ts 半）—— 依赖文件变更的 **self-排除**。
 *
 * `handleNudoDepFileChanged` 把 `computeDirtySet(...)` 的返回值（含**种子**
 * 本身）整个塞进 `parentSet` ⇒ 变更文件被当成**自己的** parent ⇒ 触发对
 * 自己的 force 重检 ⇒ 自激重检（改一个文件把自己又重检一遍）。
 *
 * 修法（片 E 落，片 D 消费）：`parentSet` 排除变更文件自身
 * （`nudoDepParents` 边与 module graph 脏集两处都排除）。
 *
 * 钉：变更文件自己 ⇒ **不**重检自己（publish 次数不增加）；
 * 而**真正的** parent（@nudo:import 依赖方）仍被重检（不得误伤）。
 */
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  clearValidationState,
  handleNudoDepFileChanged,
  registerNudoImportDeps,
  validateText,
} from "../validation.ts";
import { makeValidateDeps } from "./helpers.ts";

const norm = (p: string) => resolve(p).replace(/\\/g, "/");

describe("Bug 776（validation 半）—— 依赖文件变更的 self-排除", () => {
  beforeEach(() => {
    clearValidationState();
  });

  it("变更文件自己 ⇒ 不重检自己（无自激重检）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776e-"));
    try {
      const file = join(dir, "self.js");
      const src = `export function s(x) { return x; }\n`;
      writeFileSync(file, src, "utf-8");
      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(file), { uri: `file://${file}`, version: 2, getText: () => src }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      // 初验：登记 knownFiles（module graph 需要）
      await validateText(file, `file://${file}`, src, 2, deps, false);
      const afterInitial = published;
      expect(afterInitial).toBeGreaterThan(0);

      // 变更文件自己 ⇒ 不得再触发一次对自己的重检
      await handleNudoDepFileChanged(file, deps);
      expect(published).toBe(afterInitial);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("真正的 parent（@nudo:import 依赖方）仍被重检（self-排除不得误伤）", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nudo-bug776f-"));
    try {
      const parent = join(dir, "a.js");
      const dep = join(dir, "shapes.nudo.js");
      writeFileSync(dep, "export const positive = number().gt(0);\n");
      const parentSrc = `/// @nudo:import { positive } from "./shapes.nudo.js"
export function needsPositive(x) {
  return x;
}
`;
      writeFileSync(parent, parentSrc);
      registerNudoImportDeps(parent, parentSrc);

      let published = 0;
      const deps = makeValidateDeps({
        docs: [[norm(parent), { uri: `file://${parent}`, version: 2, getText: () => parentSrc }]],
        lookupKey: norm,
        onPublish: () => {
          published++;
        },
      });
      await handleNudoDepFileChanged(dep, deps);
      expect(published).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
