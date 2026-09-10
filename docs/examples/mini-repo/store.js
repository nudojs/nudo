export class MemoryStore {
  constructor() {
    this.items = {};
  }
  set(key, value) {
    this.items[key] = value;
    return true;
  }
  get(key) {
    return this.items[key];
  }
}
