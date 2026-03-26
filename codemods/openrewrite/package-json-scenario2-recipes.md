# OpenRewrite — Scenario 2: Monorepo target manipulations

## What the recipe does

Targets `frontend/package.json` and `backend/package.json` only (scoped via
`FindSourceFiles` with `filePattern: "{frontend,backend}/package.json"`).

| # | Transformation | Recipe |
|---|---|---|
| 1 | Bump `"version"` to `"1.0.0-beta"` | `ChangeValue` |
| 2a | Add `"start:prod"` inside `"scripts"` | `AddKeyValue` (keyPath `$.scripts`) |
| 2b | Change `"lint"` script value | `ChangeValue` |
| 3 | Remove `"eslint"` from `"devDependencies"` | `DeleteKey` |
| 4 | Sort `"dependencies"` and `"devDependencies"` | `SortJsonObjectKeys` (custom, ×2) |
| 5 | Clone `"engines": {"node": ">=20.10.0"}` from root | `AddKeyValue` (keyPath `$`) |

---

## Run results

5 of 6 transformations executed correctly on both files. One transformation
failed silently.

---

## Issue classification

| # | Issue | Source | In your hands? | Type |
|---|---|---|---|---|
| 1 | `start:prod` not added to scripts at all | **Built-in `AddKeyValue`** — does not support nested object paths | ❌ No — needs a custom Java recipe | Structural (missing transformation) |
| 2 | All scripts entries show as changed in diff even though only lint was modified | **`SortJsonObjectKeys` / `autoFormat()`** propagation (same as Scenario 1) | ✅ Yes — same fix: remove `autoFormat()`, reuse prefix whitespace | Formatting only |
| 3 | Scripts/dependencies closing `}` merged onto last entry; 4-space → 2-space | **`SortJsonObjectKeys` / `autoFormat()`** (same as Scenario 1) | ✅ Yes | Formatting only |
| 4 | `engines` appended inline on last `}` of file | **Built-in `AddKeyValue`** inline-append (same as Scenario 1) | ❌ No — needs custom recipe | Formatting only |

**Issue 1 is the only non-cosmetic problem.** Issues 2–4 are formatting-only;
the resulting JSON is valid and all scripts, dependencies, and engines are
functionally correct.

---

## "Are the scripts entries deleted?" — No, but the diff looks like they are

The diff shows ALL five existing scripts entries as `-`/`+` lines:

```diff
-    "lint": "eslint \"src/**/*.ts\""
-  },
+    "lint": "npm run lint --workspace root"},
```

This creates the visual impression that all scripts entries were removed and
re-inserted. They were not. What actually happened:

1. `ChangeValue` modified only the `"lint"` member value.
2. `autoFormat()` inside `SortJsonObjectKeys` then touched the entire file's
   whitespace, stripping the trailing newline from every member in the scripts
   object and merging the closing `}` onto the lint line.
3. Because whitespace changed on every line, the diff tool reports them all as
   changed — even though `"dev"`, `"build"`, `"start"`, and `"typecheck"` have
   identical key names and values.

The existing scripts entries are fully preserved.

---

## "Should the scripts object be cleared when adding a new key?" — No

`AddKeyValue` is designed to INSERT a single new member into an existing object
while leaving all other members untouched. When it silently fails (due to the
nested path issue described below), the correct behaviour is to do nothing —
which it does. The scripts object is neither cleared nor rebuilt; it simply ends
up missing the `"start:prod"` key that should have been added.

---

## Root cause: `AddKeyValue` cannot target nested objects

### The cursor position problem

In OpenRewrite's JSON LST, `$.scripts` is the JsonPath for the **Member** node
(the key-value pair `"scripts": {...}`). When `AddKeyValue` visits a
`Json.JsonObject` node, the cursor is at the **object value** — not the Member.
The path `$.scripts` does not match the object cursor; it matches the parent
Member cursor.

`keyPath: "$"` (root) works because the root JsonObject has no parent Member —
the root cursor itself matches `$`.

`keyPath: "$.scripts"` silently does nothing because the scripts JsonObject
cursor does not match `$.scripts`; only its parent Member cursor does — and
`AddKeyValue` never checks the parent.

### Why SortJsonObjectKeys doesn't have this problem

`SortJsonObjectKeys` was written with an explicit dual-cursor check:

```java
boolean matches = pathMatcher.matches(getCursor());          // handles "$" (root)
if (!matches) {
    Cursor parent = getCursor().getParent();
    if (parent != null) matches = pathMatcher.matches(parent); // handles "$.scripts"
}
```

The built-in `AddKeyValue` lacks this check.

---

## Fix: custom `AddNestedKeyValue` recipe

Adding a key to any nested JSON object (not just root) requires a custom recipe
that replicates the dual-cursor logic from `SortJsonObjectKeys`. The recipe would:

1. In `visitObject`, check both `getCursor()` and `getCursor().getParent()` against
   the keyPath, as in `SortJsonObjectKeys`.
2. When a match is found, construct a new `Json.Member` for the new key-value pair
   and append it to the object's member list.
3. Copy prefix whitespace from the last existing member so the new entry lands on
   its own indented line — avoiding the inline-append issue that `AddKeyValue`
   has at root level.

This would fix both the `start:prod` failure and the inline-append formatting
problem in one recipe.

**Until this is written, `AddKeyValue` is effectively limited to `keyPath: "$"`
(root-level insertions only) in this recipe setup.**

---

## What each transformation actually produced

### `backend/package.json`

| Transformation | Expected | Actual |
|---|---|---|
| Version | `"1.0.0-beta"` | ✅ `"1.0.0-beta"` |
| `start:prod` in scripts | Added | ❌ Not added |
| `lint` value | `"npm run lint --workspace root"` | ✅ Correct |
| `eslint` removed | Gone from devDependencies | ✅ Removed |
| `dependencies` sorted | Alphabetical | ✅ Already sorted; no-op |
| `devDependencies` sorted | `@types/koa → @types/koa-bodyparser → @types/koa__cors → @types/koa__router → @types/node → ts-node-dev → typescript` | ✅ Correct |
| `engines` added | `{"node": ">=20.10.0"}` | ✅ Added (inline, formatting issue) |

### `frontend/package.json`

| Transformation | Expected | Actual |
|---|---|---|
| Version | `"1.0.0-beta"` | ✅ `"1.0.0-beta"` |
| `start:prod` in scripts | Added | ❌ Not added |
| `lint` value | `"npm run lint --workspace root"` | ✅ Correct |
| `eslint` removed | Gone from devDependencies | ✅ Removed |
| `dependencies` sorted | Alphabetical | ✅ Already sorted; no-op |
| `devDependencies` sorted | `@types/node → @types/react → @types/react-dom → @typescript-eslint/eslint-plugin → @typescript-eslint/parser → @vitejs/plugin-react → typescript → vite` | ✅ Correct |
| `engines` added | `{"node": ">=20.10.0"}` | ✅ Added (inline, formatting issue) |

---

## Summary

| Dimension | Result |
|---|---|
| Scoping (only frontend + backend) | ✅ Correct — root, custom-packages untouched |
| Logical correctness | ⚠ 5/6 — `start:prod` missing |
| Functional breakage | ❌ None — all other output is valid, parseable JSON |
| Formatting fidelity | ⚠ Same autoFormat() degradation as Scenario 1 |
| Fixable without forking OpenRewrite | ✅ Custom `AddNestedKeyValue` Java recipe needed for `start:prod` |
