/**
 * Bug 537 — `nudo:interface-emit-denied` 的消息里报的是**源文件**路径，而
 * 文档（diagnostics.md）的示例消息写的是**侧车**路径 → 照文档配的 allowlist
 * （侧车形态 glob）**永远**被拒，且用户被指向一个不存在的判定对象。
 *
 * 闸门本身是自洽的（allowlist 的 glob 匹配的是**源文件**路径，config.md
 * 同口径）；坏的是**消息文案**没说明路径口径。修法（emitter 侧）：消息点名
 * 被判定的**源文件**路径，并显式说明「匹配的是源文件路径、不是侧车路径」，
 * 同时把侧车路径一并给出（用户改配置时不必猜）。
 *
 * 负控制：allowlist 命中（源文件形态）时不报 emit-denied。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitInterface } from "../interface-emitter.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nudo-emit-537-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SRC = `/**
 * @nudo:case "c" (1)
 */
export function f(x) { return x + 1; }
`;

describe("Bug 537 — emit-denied 消息点名源文件路径", () => {
  it("names the source file path and states the path semantics", async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "d",
        type: "module",
        private: true,
        nudo: { contract: { emit: ["**/*.nudo.js"] } },
      }),
    );
    const file = join(dir, "src", "lib.js");
    writeFileSync(file, SRC);

    const r = await emitInterface(file, { mode: "update", all: true });
    const denied = r.issues.find((i) => i.code === "nudo:interface-emit-denied");
    expect(denied).toBeDefined();
    // 消息点名**源文件**（被判定的那条路径）
    expect(denied!.message).toContain("src/lib.js");
    // 并说清「匹配的是源文件路径、不是侧车路径」——照文档配 allowlist 的用户
    // 由此知道该配哪种路径形态
    expect(denied!.message).toContain("source file path");
    expect(denied!.message).not.toMatch(/^emit target '[^']*\.nudo\.js'/);
  });

  it("negative control: an allowlist matching the source file is not denied", async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "d",
        type: "module",
        private: true,
        nudo: { contract: { emit: ["**/*.js"] } },
      }),
    );
    const file = join(dir, "src", "lib.js");
    writeFileSync(file, SRC);
    const r = await emitInterface(file, { mode: "update", all: true });
    expect(r.issues.find((i) => i.code === "nudo:interface-emit-denied")).toBeUndefined();
    expect(r.skipped.some((s) => s.reason === "emit-denied")).toBe(false);
  });
});
