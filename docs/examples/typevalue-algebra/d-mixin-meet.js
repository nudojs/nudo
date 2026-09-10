// 示例 D：mixin / 交叉（meet）
// 考察：装饰器式组合在 brand shape 上做槽位 meet

function withLogging(Base) {
  return class extends Base {
    log(msg) {
      console.log(msg);
    }
  };
}

function withTiming(Base) {
  return class extends Base {
    time(label, fn) {
      return fn();
    }
  };
}

class Service {
  fetch(id) {
    return { id, ok: true };
  }
}

const Svc = withTiming(withLogging(Service));
const svc = new Svc();
svc.fetch(1);
svc.log("hi");
svc.time("t", () => 1);

module.exports = { withLogging, withTiming, Service, Svc };
