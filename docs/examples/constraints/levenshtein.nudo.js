// 编辑距离契约：入参字符串、返回非负数。
// 「每个格子 ≥ 0」这一循环携带界在源文件 @nudo:invariant 声明——分工：
// 值域契约（string / number）用构建器，循环不变式引擎推导不出，用指令声明。

import { fn, number, string } from "@nudojs/core";

export const levenshtein = fn(
  { a: string(), b: string() },
  number().ge(0),
);
