/**
 * 差分语料全量 barrel：batch1–21（含 14a-f / 15a-d / 16a-d / 17a-b 拆分与
 * 18-readprobes / 19-method-early-return / 20-transpile-adversarial /
 * 21-ctor-battery 命名批次）集中 re-export。
 * differential-basic / edge / recent 与根目录 eval-fallback 各自从本模块
 * 取子集（FILES 选择在测试文件内保持不变）——语料内容零改动。
 */
export * as batch1 from "./corpus/batch1.ts";
export * as batch2 from "./corpus/batch2.ts";
export * as batch3 from "./corpus/batch3.ts";
export * as batch4 from "./corpus/batch4.ts";
export * as batch5 from "./corpus/batch5.ts";
export * as batch6 from "./corpus/batch6.ts";
export * as batch7 from "./corpus/batch7.ts";
export * as batch8 from "./corpus/batch8.ts";
export * as batch9 from "./corpus/batch9.ts";
export * as batch10 from "./corpus/batch10.ts";
export * as batch11 from "./corpus/batch11.ts";
export * as batch12 from "./corpus/batch12.ts";
export * as batch13 from "./corpus/batch13.ts";
export * as batch14a from "./corpus/batch14a.ts";
export * as batch14b from "./corpus/batch14b.ts";
export * as batch14c from "./corpus/batch14c.ts";
export * as batch14d from "./corpus/batch14d.ts";
export * as batch14e from "./corpus/batch14e.ts";
export * as batch14f from "./corpus/batch14f.ts";
export * as batch15a from "./corpus/batch15a.ts";
export * as batch15b from "./corpus/batch15b.ts";
export * as batch15c from "./corpus/batch15c.ts";
export * as batch15d from "./corpus/batch15d.ts";
export * as batch16a from "./corpus/batch16a.ts";
export * as batch16b from "./corpus/batch16b.ts";
export * as batch16c from "./corpus/batch16c.ts";
export * as batch16d from "./corpus/batch16d.ts";
export * as batch17a from "./corpus/batch17a.ts";
export * as batch17b from "./corpus/batch17b.ts";
export * as batch18Readprobes from "./corpus/batch18-readprobes.ts";
export * as batch19MethodEarlyReturn from "./corpus/batch19-method-early-return.ts";
export * as batch20TranspileAdversarial from "./corpus/batch20-transpile-adversarial.ts";
export * as batch21CtorBattery from "./corpus/batch21-ctor-battery.ts";
