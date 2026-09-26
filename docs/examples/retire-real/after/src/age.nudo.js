import { fn, number, string } from "@nudojs/core";

/** 来自 before/src/age.ts 注解 + ms 声明（contract --from-dts 审阅后接受） */
export const formatAge = fn({ durationMs: number() }, string());
export const parseAge = fn({ text: string() }, number());
