// object 形状契约模板
import { number, string, shape } from "@nudojs/core";

/** readXY 的参数形状：x / y 必填（义务来自契约，不是 body 扫描） */
export const xy = shape({
  x: number(),
  y: number(),
});
