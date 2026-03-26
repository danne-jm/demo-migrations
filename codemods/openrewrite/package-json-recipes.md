# OpenRewrite — Scenario 1: package.json migrations

## What the recipe does

Applies four transformations to every `package.json` in the monorepo:

| # | Transformation | Recipe |
|---|---|---|
| 1 | Add `"author": "Acme Corp"` and `"repository": {...}` | `AddKeyValue` (×2) |
| 2 | Remove `"private": true` | `DeleteKey` |
| 3 | Sort `"scripts"` keys alphabetically | `SortJsonObjectKeys` (custom) |
| 4 | Rename `"version"` → `"_comment_version"` (JSON has no comment syntax) | `ChangeKey` |

Affected files: `package.json`, `backend/package.json`, `frontend/package.json`,
`codemods/tsmorph/package.json`, `custom-packages/fictional-logger/package.json`,
`custom-packages/realistic-logger/package.json`.

---

## Run results

All four transformations executed correctly on all six files. Logical content is
100% correct — every scenario objective is achieved. The issues described below
are formatting only.

---

## Issue classification

Three issues were observed in the run output. The table below identifies the
source of each and whether it is a **formatting error** (cosmetic — JSON remains
valid and fully functional) or a **structural error** (breaks JSON validity or
runtime behaviour).

| # | Issue | Source | In your hands? | Type |
|---|---|---|---|---|
| 1 | `scripts` closing `}` on same line as last entry; indent 4→2 | **Our recipe** — `SortJsonObjectKeys.java` calls `autoFormat()` | ✅ Yes — fixable by removing `autoFormat()` and reusing original prefix whitespace | Formatting only |
| 2 | `dependencies`/`devDependencies` closing `}` also merged (those objects weren't sorted) | **Our recipe** — `autoFormat()` propagates up to the parent document | ✅ Yes — same fix as #1 | Formatting only |
| 3 | `author`/`repository` appended inline on the last `}` of the file | **Built-in `AddKeyValue`** — no newline is inserted before new members | ❌ No — built-in recipe, no config option; needs a custom replacement recipe | Formatting only |

There was previously a fourth issue — `_comment_version` emitted without quotes
(invalid JSON). That was a **structural error** (breaks JSON parsers) caused by a
typo in the YAML config (`newKey: "_comment_version"` instead of
`newKey: '"_comment_version"'`). It is **fixed** in the current recipe file.

### Are any remaining issues functional breakage?

**No.** All three remaining issues are purely cosmetic. The output is valid JSON
in every case:

- Closing `}` on the same line as the last entry is legal JSON.
- Members appended inline are legal JSON.
- `npm install`, `node`, and all standard JSON parsers will read the files
  correctly.
- `npm run <script>` will work — script names and values are untouched.

The files look messy in a diff viewer but are functionally identical to
correctly-indented equivalents.

---

## OpenRewrite vs jq / yq

### Where OpenRewrite wins

| Strength | Detail |
|---|---|
| Monorepo traversal | Single recipe run touches every matching file — no shell loop needed |
| Idempotent | `AddKeyValue` is a no-op if the key already exists |
| Dry-run | `mod run --dry-run` previews diffs without writing |
| Audit trail | Every run produces a patch file and telemetry CSV |
| Unmodified nodes | Nodes not structurally changed are genuinely format-preserved — whitespace and key order are untouched |

### Where jq / yq win

| Strength | Detail |
|---|---|
| Sorting | `jq '.scripts \|= (to_entries \| sort_by(.key) \| from_entries)'` — one line, no custom Java |
| Insertion | `jq '. + {"author": "Acme Corp"}'` — new key lands on its own indented line |
| No runtime | Lightweight CLI; no JVM, no Gradle, no Moderne daemon |
| Consistent output | Fully reformats — predictable, diff-friendly results |

jq weakness: reformats the entire file (destroys original whitespace everywhere),
not just the changed nodes. Also requires a shell loop for monorepo use and is
not idempotent by default.

---

## Issue detail

### Issue 1 & 2 — `autoFormat()` in `SortJsonObjectKeys.java` (our recipe)

After sorting, `autoFormat()` applies its own normalisation rather than mirroring
the original style:

- 4-space indent → 2-space
- closing `}` placed on the same line as the last entry
- reformatting propagates to sibling objects (`dependencies`, `devDependencies`)
  that were not sorted at all

**Root cause:** `autoFormat()` normalises the entire subtree it receives, and
the parent context propagates the effect to adjacent objects.

**Fix:** Remove the `autoFormat()` call in `SortJsonObjectKeys.java`. Instead,
when building the sorted member list, transfer the prefix whitespace from each
member's original position to the member that moves into that position. This
keeps per-file indentation style intact and does not touch sibling objects.

**jq comparison:** jq reformats the whole file uniformly — no degradation
relative to the rest of the file, but no preservation either.

---

### Issue 3 — `AddKeyValue` inline-append (built-in recipe, out of your hands)

New keys are appended inline on the same line as the closing `}` of the last
existing member:

```
"@types/node": "^25.5.0"}, "author": "Acme Corp", "repository": {"type": "git", ...}}
```

instead of:

```json
    "@types/node": "^25.5.0"
  },
  "author": "Acme Corp",
  "repository": { "type": "git", ... }
}
```

**Root cause:** `AddKeyValue` does not prepend a newline/indent before the new
`Json.Member` node. There is no configuration option to change this.

**Fix:** Write a custom `AddKeyValue`-like recipe that copies the prefix
whitespace of the preceding member and prepends it to the new member before
inserting. This is non-trivial but straightforward in `JsonIsoVisitor`.

**jq comparison:** `jq '. + {"author": "Acme Corp"}'` places the new key on its
own properly-indented line — one case where jq's full-reformat is preferable.

---

### Former issue (fixed) — `ChangeKey` YAML quoting footgun

```yaml
newKey: "_comment_version"    # was: emitted  _comment_version: "0.1.0"  ← invalid JSON (unquoted key)
newKey: '"_comment_version"'  # now: emits   "_comment_version": "0.1.0" ← valid
```

The YAML string value is used verbatim as the key source. YAML single-quotes
preserve the embedded double-quotes that JSON requires around key names.

---

## Summary verdict

> OpenRewrite's "format-preserving" guarantee applies only to nodes that are
> **not structurally changed**. Recipes that reorder or insert members trigger
> `autoFormat()` or inline-append behaviour — producing comparably reformatted
> output to jq for those specific nodes.

For this scenario:

| Dimension | OpenRewrite | jq / yq |
|---|---|---|
| Logical correctness | ✅ | ✅ |
| Formatting fidelity on untouched nodes | ✅ | ❌ full reformat |
| Formatting on changed nodes | ⚠ degraded (issues 1–3 above) | ✅ consistent reformat |
| Monorepo scale, idempotency, dry-run | ✅ | ❌ |
| Ease of one-off transforms | ❌ JVM + build required | ✅ |
| Issues fixable without forking OpenRewrite | ✅ issues 1–2 fixable in our recipe | — |
