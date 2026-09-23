/**
 * this 绑定精度：函数体内成员调用把 receiver 注入为 thisVal，调用点路径
 * 精确——compute(5) 内 circle.area() → 25 #exact、compute(3) → 9 #exact。
 *
 * 指令路径带字面量实参同样精确（case "member" (5) → (5) => 25）；空实参表
 * 时形参 unknown → unknown #partial（见 guides/semantics.md）。
 *
 * 成员调用（circle.area()）作为调用点采集（Class.method / 裸 method），
 * 与具名调用一样合成 call@ case。
 */

class Circle {
  constructor(r) { this.radius = r; }
  area() { return this.radius * this.radius; }
}

function compute(r) {
  const circle = new Circle(r);
  return circle.area();
}

compute(5);   // → 25
compute(3);   // → 9
