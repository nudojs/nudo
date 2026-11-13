/**
 * watch 去抖窗口的 **FSEvents 噪声过滤** 确定性回归钉。
 *
 * 背景：macOS 的 `fs.watch` 在目录级上会顺带报告同一批次里**未被触碰**的
 * 文件。改 `a.js` 时 `sub/b.js` 也可能进 `pendingChanged` ⇒ 增量轮把两个
 * 文件都重跑，Bug 684 / 685 的「重跑的是被改的那个」断言变成概率性红
 * （同一夹具重复跑约 1/3 失败）。`startWatch` 现在按 `(size, mtimeMs)`
 * 指纹过滤；本夹具直接钉住纯函数的各分支，避免只靠概率验证。
 *
 * 语义红线：只丢「tracked 且指纹未变」的噪声；删除、新建、非 tracked
 * （配置 / 侧车 / env 模板）一律放行，不得让过滤吃掉真实变更。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stablePathKey } from "@nudojs/service";
import {
  filterUnchangedWatchPaths,
  watchPathVersion,
} from "../commands/shared.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-watch-noise-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const keyed = (paths: string[], versionOf = watchPathVersion): Map<string, string> =>
  new Map(
    paths.flatMap((p) => {
      const v = versionOf(p);
      return v === undefined ? [] : [[stablePathKey(p), v] as [string, string]];
    }),
  );

describe("watch FSEvents 噪声过滤", () => {
  it("指纹未变的同批文件 ⇒ 丢弃（正是 Bug 684/685 的 flaky 来源）", () => {
    const a = join(dir, "a.js");
    const b = join(dir, "sub", "b.js");
    mkdirSync(join(dir, "sub"), { recursive: true });
    writeFileSync(a, "export const a = 1;\n");
    writeFileSync(b, "export const b = 2;\n");
    const known = keyed([a, b]);

    // 只改 a.js；FSEvents 顺带把没碰过的 b.js 也报进来
    writeFileSync(a, "export const a = 11;\n");
    expect(filterUnchangedWatchPaths([a, b], known)).toEqual([a]);
  });

  it("内容变了（size 变）⇒ 保留", () => {
    const f = join(dir, "x.js");
    writeFileSync(f, "one\n");
    const known = keyed([f]);
    writeFileSync(f, "a much longer content\n");
    expect(filterUnchangedWatchPaths([f], known)).toEqual([f]);
  });

  it("只 touch（内容不变但 mtime 变）⇒ 仍保留，不吃掉真实事件", () => {
    const f = join(dir, "t.js");
    writeFileSync(f, "same\n");
    const known = keyed([f]);
    utimesSync(f, new Date(1_600_000_000_000 / 1000), new Date(1_600_000_000_000 / 1000));
    expect(filterUnchangedWatchPaths([f], known)).toEqual([f]);
  });

  it("文件被删除 ⇒ stat miss 放行（驱逐语义不变）", () => {
    const f = join(dir, "gone.js");
    writeFileSync(f, "bye\n");
    const known = keyed([f]);
    unlinkSync(f);
    expect(watchPathVersion(f)).toBeUndefined();
    expect(filterUnchangedWatchPaths([f], known)).toEqual([f]);
  });

  it("未记录的路径（新建文件 / 配置 / 侧车 / env 模板）⇒ 一律放行", () => {
    const tracked = join(dir, "a.js");
    writeFileSync(tracked, "a\n");
    const known = keyed([tracked]);
    const fresh = join(dir, "new.js");
    const sidecar = join(dir, "a.nudo.js");
    const config = join(dir, "package.json");
    const envTpl = join(dir, ".env.js");
    for (const p of [fresh, sidecar, config, envTpl]) writeFileSync(p, "x\n");

    expect(
      filterUnchangedWatchPaths([tracked, fresh, sidecar, config, envTpl], known),
    ).toEqual([fresh, sidecar, config, envTpl]);
  });

  it("全批都是噪声 ⇒ 返回空数组（去抖轮不产生增量分析）", () => {
    const a = join(dir, "a.js");
    const b = join(dir, "b.js");
    writeFileSync(a, "a\n");
    writeFileSync(b, "b\n");
    const known = keyed([a, b]);
    expect(filterUnchangedWatchPaths([a, b], known)).toEqual([]);
  });

  it("空 knownVersions ⇒ 全部放行（首轮之前不臆断身份）", () => {
    const a = join(dir, "a.js");
    writeFileSync(a, "a\n");
    expect(filterUnchangedWatchPaths([a], new Map())).toEqual([a]);
  });
});
