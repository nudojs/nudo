// 接口约束定义（与 zod/valibot 同构的 Pred 字符串）
// 由 /// @nudo:import * as V from "./interface.nudo.js" 引入

/** 延时必须为正 */
export const delay = "ms > 0";

/** 百分比 0–100 */
export const percent = { pred: "n >= 0" };

/** 端口 */
export const port = "port >= 1";
