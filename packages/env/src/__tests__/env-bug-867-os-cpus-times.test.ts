/**
 * 族 29 · Bug 867：`os.cpus()` 的结果对象**缺 `times` 槽** ⇒
 * `cpus()[0].times.user` 读出 **exact `undefined`** ⇒ 引擎判「property
 * 'user' on undefined ⇒ 定抛 TypeError」——**假红**（原生正常返回数字）。
 *
 * 原生 oracle（Node v26）：`os.cpus()[0]` 的自有键 = model / speed / times，
 * `times` 的键 = user / nice / sys / idle / irq。
 * 旧面只建模 model / speed ⇒ times 缺槽 ⇒ 读出 exact undefined（不是精度债，
 * 是**确定的错值**）。
 */
import { describe, it, expect } from "vitest";
import { formatShape } from "@nudojs/core";
import os from "node:os";
import { envMember, slotsOf } from "./env-bug-s3-helpers.ts";

describe("Bug 867 · os.cpus() 的 times 成员表", () => {
  it("1. cpus() 元素含 times 槽（user/nice/sys/idle/irq 全在）", () => {
    const ret = envMember("node:os", "cpus");
    expect(ret.shape.k).toBe("fn");
    const fn = ret.shape as { returnType?: { shape: unknown } };
    const arr = fn.returnType!;
    expect(arr.shape).toMatchObject({ k: "arr" });
    const el = (arr.shape as { element: Parameters<typeof slotsOf>[0] }).element;
    const slots = slotsOf(el);
    expect(Object.keys(slots).sort()).toEqual(["model", "speed", "times"]);
    const times = slots["times"]!.value;
    const tslots = slotsOf(times);
    expect(Object.keys(tslots).sort()).toEqual(["idle", "irq", "nice", "sys", "user"]);
    for (const k of ["user", "nice", "sys", "idle", "irq"]) {
      expect(formatShape(tslots[k]!.value), `times.${k}`).toBe("number");
    }
  });

  it("2. 原生 oracle 对拍：声明的 times 成员名 = 原生 os.cpus()[0].times 的键", () => {
    const native = os.cpus()[0];
    expect(native, "本机应至少有一个 cpu").toBeDefined();
    const nativeTimes = Object.keys(native!.times).sort();
    const nativeCpu = Object.keys(native!).sort();
    const slots = slotsOf(
      (envMember("node:os", "cpus").shape as { returnType?: { shape: { element: Parameters<typeof slotsOf>[0] } } })
        .returnType!.shape.element,
    );
    expect(Object.keys(slots).sort()).toEqual(nativeCpu);
    expect(Object.keys(slotsOf(slots["times"]!.value)).sort()).toEqual(nativeTimes);
  });

  it("3. 反向钉：times 缺槽 ⇒ 成员读出 exact undefined（原生没有 undefined 成员）", () => {
    const el = (envMember("node:os", "cpus").shape as { returnType?: { shape: { element: Parameters<typeof slotsOf>[0] } } })
      .returnType!.shape.element;
    const slots = slotsOf(el);
    // 原生 times.user 是数字；声明面必须给出**成员槽**（而不是缺槽）
    expect(slots["times"]).toBeDefined();
    expect(slotsOf(slots["times"]!.value)["user"]).toBeDefined();
  });
});
