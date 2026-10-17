import { number } from "@nudojs/core";

// 注：这里用 ge 而非 gt —— IEEE 吸收下 x>0 ⇒ x+4>4 并不成立
// （x=5e-324 时 x+1 吸收为 1，链式结果恰等于 4），严格界会被
// 引擎按浮点离散性外推一 ulp。非严格链 x≥0 ⇒ x+4≥4 永真。
export const positive = number().ge(0);
export const positive4 = number().ge(4);
