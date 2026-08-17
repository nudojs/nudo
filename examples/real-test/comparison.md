# Nudo vs TypeScript: Real-World Comparison

## Project: User Service API Client

A realistic user service with 10 functions demonstrating dependency injection, validation, caching, and event handling.

---

## 1. Code Metrics

| Metric | Nudo | TypeScript | Difference |
|--------|------|------------|------------|
| Source lines (functions) | 120 | 120 | 0% |
| Type definitions | 0 | 85 | -100% |
| Interface definitions | 0 | 12 | -100% |
| Mock setup code | 0 | 30 | -100% |
| **Total lines** | **120** | **235** | **-49%** |

---

## 2. Function Signatures

### Nudo
```javascript
function fetchUser(url, options) { ... }
function validateUser(user) { ... }
function enrichUser(user) { ... }
function getCachedUser(userId) { ... }
function dispatchEvent(event) { ... }
function processBatch(users) { ... }
function fetchDataWithRetry(url, maxRetries) { ... }
function buildConfig() { ... }
function formatApiResponse(data) { ... }
function checkPermission(userId, action) { ... }
```

### TypeScript
```typescript
function fetchUser(url: string, options: RequestInit, deps: Pick<Dependencies, 'httpClient'>): User | { error: string; status: number } { ... }
function validateUser(user: { name: string; email: string }, deps: Pick<Dependencies, 'isString' | 'isEmail' | 'isNotEmpty'>): ValidationResult { ... }
function enrichUser(user: User, deps: Pick<Dependencies, 'formatName' | 'addTimestamp'>): EnrichedUser { ... }
function getCachedUser(userId: number | string, deps: Pick<Dependencies, 'cacheGet' | 'cacheSet'>): CachedUser { ... }
function dispatchEvent(event: Event, deps: Pick<Dependencies, 'validateEvent' | 'transformEvent' | 'logEvent'>): EventResult { ... }
function processBatch(users: User[], deps: Pick<Dependencies, 'isValidUser' | 'summarize'>): BatchResult[] { ... }
function fetchDataWithRetry(url: string, maxRetries: number, deps: Pick<Dependencies, 'fetchWithRetry'>): RetryResult { ... }
function buildConfig(deps: Pick<Dependencies, 'getEnv' | 'getSecret'>): Config { ... }
function formatApiResponse<T>(data: T, deps: Pick<Dependencies, 'formatResponse'>): ApiResponseFormatted<T> { ... }
function checkPermission(userId: number, action: string, deps: Pick<Dependencies, 'getUserRole' | 'getPermissions' | 'hasPermission'>): PermissionResult { ... }
```

---

## 3. Mock Definition

### Nudo (in comments)
```javascript
// @nudo:mock httpClient = stub().returns({ status: 200, data: { id: 1, name: "Alice" } })
// @nudo:mock isString = (v) => typeof v === "string"
// @nudo:mock formatName = (user) => ({ ...user, displayName: user.name.toUpperCase() })
```

### TypeScript (runtime code)
```typescript
const mockDeps: Dependencies = {
  httpClient: (url, options) => ({ status: 200, data: { id: 1, name: "Alice", email: "alice@example.com" } }),
  isString: (v): v is string => typeof v === "string",
  isEmail: (v) => v.includes("@"),
  isNotEmpty: (v) => v.length > 0,
  formatName: (user) => ({ ...user, displayName: user.name.toUpperCase() }),
  addTimestamp: (user) => ({ ...user, fetchedAt: Date.now() }),
  cacheGet: (key) => ({ id: 1, name: "Cached User", email: "cached@example.com" }),
  cacheSet: (key, value, ttl) => true,
  validateEvent: (event) => event.type !== undefined,
  transformEvent: (event) => ({ ...event, processed: true }),
  logEvent: (event) => event,
  isValidUser: (user) => user.id > 0,
  summarize: (user) => ({ id: user.id, name: user.name }),
  fetchWithRetry: (url, retries) => ({ data: "success", attempts: retries }),
  getEnv: (key) => "production",
  getSecret: (key) => "secret-value",
  formatResponse: (data) => ({ success: true, data, timestamp: Date.now() }),
  getUserRole: (userId) => "admin",
  getPermissions: (role) => ["read", "write", "delete"],
  hasPermission: (permissions, action) => permissions.includes(action),
};
```

---

## 4. Test Execution

### Nudo
```bash
pnpm infer user-service.js
```

**Output:**
```
=== fetchUser ===
Case "fetch-user": ("/api/users/1", { method: "GET" }) => { id: 1, name: "Alice", email: "alice@example.com" }

=== validateUser ===
Case "valid": ({ name: "Alice", email: "alice@example.com" }) => { valid: true, user: { name: "Alice", email: "alice@example.com" } }
Case "invalid-email": ({ name: "Bob", email: "not-an-email" }) => { valid: false, error: "Invalid email" }
Case "missing-name": ({ name: "", email: "alice@example.com" }) => { valid: false, error: "Invalid name" }

=== enrichUser ===
Case "transform": ({ id: 1, name: "Alice", email: "alice@example.com" }) => { id: 1, name: "Alice", email: "alice@example.com", displayName: "ALICE", fetchedAt: number }

=== processBatch ===
Case "batch": ([{ id: 1, name: "Alice" }, { id: -1, name: "Invalid" }, { id: 2, name: "Bob" }]) => { id: 1 | 2, name: "Alice" | "Bob" }[]

=== buildConfig ===
Case "config": () => { env: "production", apiKey: "secret-value", debug: false, timestamp: number }

=== checkPermission ===
Case "admin-delete": (1, "delete") => { role: "admin", permissions: ["read", "write", "delete"], action: "delete", allowed: true }
```

### TypeScript
```bash
npx tsc --noEmit user-service.ts
```

**Output:** (type-check only, no runtime inference)
```
(no output if successful)
```

---

## 5. Key Differences

| Aspect | Nudo | TypeScript |
|--------|------|------------|
| **Dependency injection** | Mocks in comments | Extra `deps` parameter |
| **Type inference** | Automatic from mocks | Manual interface definitions |
| **Test cases** | `@nudo:case` directives | Separate test file |
| **Mock definition** | `@nudo:mock` in comments | Runtime `mockDeps` object |
| **Type updates** | Change mock, types update | Change interface + mock |
| **IDE support** | Nudo LSP | TypeScript LSP |
| **Runtime validation** | Generated guards | Manual validation |

---

## 6. Advantages

### Nudo Advantages
1. **49% less code** - No type definitions or interfaces needed
2. **Self-documenting** - Mocks define both behavior and types
3. **Faster iteration** - Change mock, see type changes immediately
4. **Built-in test cases** - `@nudo:case` directives serve as documentation
5. **Automatic type narrowing** - Union types from control flow

### TypeScript Advantages
1. **Explicit contracts** - Interfaces clearly define data shapes
2. **IDE support** - Full IntelliSense and refactoring
3. **Ecosystem** - Works with all JS tools and libraries
4. **Runtime safety** - Can add runtime validation
5. **Team familiarity** - Most developers know TypeScript

---

## 7. Recommendation

**Use Nudo when:**
- Prototyping or exploring APIs
- Testing higher-order functions
- You want minimal boilerplate
- JavaScript-first projects

**Use TypeScript when:**
- Building production libraries
- Large team collaboration
- Need explicit API contracts
- Runtime type checking required

**Hybrid approach:**
Use Nudo for rapid prototyping and testing, then migrate to TypeScript for production. Nudo's inferred types can generate `.d.ts` files for TypeScript consumption.
