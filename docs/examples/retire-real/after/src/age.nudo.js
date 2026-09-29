import { fn, number, string, nullable } from "@nudojs/core";

/**
 * 来自 before/src/age.ts 注解 + ms 声明（contract --from-dts 审阅后接受）。
 *
 * parseAge：ms 对非法时长（不匹配的字符串 / 超长串）返回 undefined，
 * 故返回位是 nullable(number())，不是裸 number()——这是真实包行为，
 * 不是引擎债（此前契约过强，后置门禁会红）。
 */
export const formatAge = fn({ durationMs: number() }, string());
export const parseAge = fn({ text: string() }, nullable(number()));
