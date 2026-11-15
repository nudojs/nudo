/**
 * Bug 931 — node env 的 `node:child_process.spawnSync` 返回域是**闭合 4 槽对象**
 * （status / stdout / stderr / error）⇒ 缺 `pid` / `output` / `signal` ⇒
 * `spawnSync(...).pid` 读出 **exact `undefined`**（**错值**：原生是 number）、
 * `spawnSync(...).output[0]` 落「在 undefined 上取下标」⇒ 引擎**证明**
 * 「必抛 TypeError」⇒ L2 门禁**假红**。
 *
 * 原生 oracle（Node v26.10.0 独立进程实测）：
 *   Object.keys(spawnSync(process.execPath, ["-e", "0"])) =
 *     ["status", "signal", "output", "pid", "stdout", "stderr"]
 *   （`error` 只在 spawn 失败时出现——失败时原生**确实**带 error 键）
 *   pid     = number（进程 pid）
 *   output  = [null, Buffer, Buffer]（stdio 未接管 stdout 时首项为 null）
 *   signal  = null（成功时）
 *   status  = 0（成功时）
 *
 * 新建模：返回域补齐 `pid` / `output` / `signal`（并保留 `error`：spawn 失败时
 * 原生确实带该键）。
 *
 * 断言双向：正向钉住「成员表齐全 + 类型与原生一致」；
 * 反向（把返回域改回 4 槽闭合对象）本文件必须失败。
 */
import { describe, it, expect } from "vitest";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { formatShape, type Abs } from "@nudojs/core";
import { defineEnv } from "../node.ts";

const env = defineEnv();
const cp = env.modules!["child_process"]!;

/** obj 槽位（obj shape ⇒ slots） */
function slotsOf(a: Abs): Record<string, Abs> {
  const shape = a.shape as { k: string; slots?: Record<string, { value: Abs }> };
  expect(shape.k).toBe("obj");
  const out: Record<string, Abs> = {};
  for (const [k, slot] of Object.entries(shape.slots ?? {})) out[k] = slot.value;
  return out;
}

/** spawnSync 的**声明返回面** */
function declaredFace(): Abs {
  const fn = cp.spawnSync!;
  expect(fn.shape.k).toBe("fn");
  const rt = (fn.shape as { returnType?: Abs }).returnType;
  expect(rt, "spawnSync must declare a return face").toBeTruthy();
  return rt!;
}

describe("Bug 931 · spawnSync 返回域补齐 pid / output / signal", () => {
  it("1. 声明返回面含原生全部成员（pid / output / signal / status / stdout / stderr）", () => {
    const slots = slotsOf(declaredFace());
    for (const key of ["pid", "output", "signal", "status", "stdout", "stderr"]) {
      expect(Object.keys(slots), `spawnSync face must expose ${key}`).toContain(key);
    }
  });

  it("2. 原生 oracle 的键集与 env 声明面一致（error 另计：仅 spawn 失败时出现）", () => {
    const native = nodeSpawnSync(process.execPath, ["-e", "0"]);
    const nativeKeys = Object.keys(native).sort();
    const slots = slotsOf(declaredFace());
    const envKeys = Object.keys(slots).filter((k) => k !== "error").sort();
    expect(envKeys).toEqual(nativeKeys);
  });

  it("3. pid 是 number（不是 undefined）；output 元素是 Buffer | null；signal 是 string | null", () => {
    const slots = slotsOf(declaredFace());
    expect(formatShape(slots.pid!)).toBe("number");
    expect(formatShape(slots.output!)).toContain("null");
    expect(formatShape(slots.signal!)).toContain("null");
    expect(formatShape(slots.status!)).toContain("null");
  });

  it("4. 反向对照：旧 4 槽面读 pid 会得到 exact undefined", () => {
    const slots = slotsOf(declaredFace());
    // 旧建模没有 pid 槽 ⇒ 读出 exact undefined（这里必须读得到槽）
    expect(Object.keys(slots)).toContain("pid");
    expect(slots.pid).toBeTruthy();
  });
});
