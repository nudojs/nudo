import { fn } from "@nudojs/core";
import { positive, positive4 } from "./std.nudo.js";

// 顶层手写契约根（add4）；add2 的契约由下行推导生成
export const add4 = fn({ x: positive }, positive4);
