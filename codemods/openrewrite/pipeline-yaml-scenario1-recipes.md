# OpenRewrite — Scenario 1: Azure Pipeline YAML Variable Manipulations

## What the recipe does

Applies three transformations to Azure Pipeline YAML files under `.azure/`:

| # | Transformation | Files | Recipe |
|---|---|---|---|
| 1 | Add `AZURE_SUBSCRIPTION: "sp-main-production"` to `variables:` | `fullstack-ci-cd.yml` only | `MergeYaml` |
| 2a | Rename `ENVIRONMENT` → `AZ_ENV` in `variables:` definition | `fullstack-ci-cd.yml` | `ChangeNamedSequenceEntry` (custom) |
| 2b | Rename `ENVIRONMENT` → `AZ_ENV` in `parameters:` definition | `deploy-backend.yml`, `deploy-frontend.yml` | `ChangeNamedSequenceEntry` (custom) |
| 2c | Rename `${{ variables.ENVIRONMENT }}` → `${{ variables.AZ_ENV }}` in string values | all `.azure/**/*.yml` | `FindAndReplace` |
| 3a | Remove `NODE_ENV` entry from `variables:` | `fullstack-ci-cd.yml` | `DeleteNamedSequenceEntry` (custom) |
| 3b | Remove `NODE_ENV` entry from `parameters:` | `deploy-backend.yml`, `deploy-frontend.yml` | `DeleteNamedSequenceEntry` (custom) |

---

## Run results

All objectives are met. The diff output for each file:

**`fullstack-ci-cd.yml`** — ENVIRONMENT renamed to AZ_ENV, NODE_ENV entry deleted, string value updated, AZURE_SUBSCRIPTION appended to end of variables block.
**`deploy-backend.yml`** — ENVIRONMENT renamed to AZ_ENV, NODE_ENV entry deleted, default string value updated.
**`deploy-frontend.yml`** — same changes as deploy-backend.yml.

One cosmetic observation: `AZURE_SUBSCRIPTION` is appended at the **end** of the `variables:` sequence rather than at a specific position. The scenario spec does not prescribe an insertion point, so this is correct behaviour.

---

## Recipe provenance — new vs pre-built

| Recipe | Origin | Notes |
|---|---|---|
| `org.openrewrite.yaml.MergeYaml` | **Pre-built, used as-is** | No code changes; `acceptTheirs` parameter removed (see bugs below) |
| `org.openrewrite.yaml.ChangeNamedSequenceEntry` | **Brand new — written from scratch** | Renames the `name:` field of a sequence-of-mappings item; inspired by `AppendToSequence` and `ChangeValue` visitor patterns |
| `org.openrewrite.yaml.DeleteNamedSequenceEntry` | **Brand new — written from scratch** | Deletes a sequence-of-mappings item by `name:` field; inspired by `DeleteKey` visitor pattern including its prefix-transfer logic |
| `org.openrewrite.text.FindAndReplace` | **Pre-built, used as-is** | No code changes |

No pre-built recipe was extended or subclassed. The two custom recipes implement `Recipe` and `YamlIsoVisitor` from scratch, using `JsonPathMatcher` for sequence-path scoping and `ListUtils.map` for AST modification and deletion — the same primitives used throughout the built-in YAML recipe library.

---

## Is this safe to run on unrelated repos?

**Short answer: safe for repos without `.azure/` directories; needs care otherwise.**

| Safeguard | Scope it provides |
|---|---|
| `preconditions: FindSourceFiles "**/.azure/**/*.yml"` | Entire recipe is a no-op unless the repo has files under a `.azure/` subdirectory |
| `filePattern: "**/.azure/pipelines/fullstack-ci-cd.yml"` on `MergeYaml` | AZURE_SUBSCRIPTION only inserted if a file with exactly this name exists |
| `filePattern: "**/.azure/templates/**/*.yml"` on parameter recipes | Parameter changes only affect files nested under `.azure/templates/` |
| `ChangeNamedSequenceEntry` / `DeleteNamedSequenceEntry` match by name field value | Both are structural no-ops if the named entry is absent; no side effects on unrelated sequences |

**Residual risks for repos that do have `.azure/**/*.yml` files:**

1. **`FindAndReplace` "variables.ENVIRONMENT"** — matches anywhere in `.azure/**/*.yml`, including comments and script steps, not just Azure Pipelines variable reference syntax. If another repo uses `variables.ENVIRONMENT` as a shell variable name or in a script body inside a pipeline YAML, it will be renamed.

2. **`ChangeNamedSequenceEntry` for `$.variables`** — will rename any `variables:` sequence item whose `name:` field is `ENVIRONMENT`, regardless of what that pipeline does. If another repo has a legitimately named variable called `ENVIRONMENT` that they do not want renamed, it will be renamed.

3. **`MergeYaml` position** — `AZURE_SUBSCRIPTION` is appended at the end of the variables block. No check is made for whether an existing variable with the same name but a different value is already present (because `objectIdentifyingProperty: "name"` only deduplicates exact-name matches, not partial ones). This is intentional behaviour.

To share safely: review whether the target repos' `.azure/**/*.yml` files use `ENVIRONMENT` or `NODE_ENV` variable names in an unrelated capacity before running.

---

## Bugs found during development

### Bug 1 — `MergeYaml` `acceptTheirs: true` silently prevents all sequence additions

**Symptom:** `MergeYaml` produced no diff; `AZURE_SUBSCRIPTION` was never added.

**Root cause:** `MergeYamlVisitor.mergeSequence()` line 276:

```java
private Yaml.Sequence mergeSequence(Yaml.Sequence s1, Yaml.Sequence s2, P p, Cursor cursor) {
    if (acceptTheirs) {
        return s1;  // exits immediately — no entries added
    }
```

When `acceptTheirs: true`, the method returns the existing sequence without processing incoming entries at all. This affects new entries that have no conflict, not just conflicting ones. The documentation describes `acceptTheirs` as applying to *conflicting* keys only, but the implementation applies it to the entire sequence merge.

**Fix:** Remove `acceptTheirs: true` from the `MergeYaml` recipe invocation. Idempotency is handled by `objectIdentifyingProperty: "name"` — if AZURE_SUBSCRIPTION already exists, `keyMatches()` finds it and the merge is a no-op rather than a duplicate insert.

---

### Bug 2 — `FindAndReplace` converts YAML files to plain text, breaking subsequent YAML AST visitors

**Symptom:** `DeleteNamedSequenceEntry` produced no diff when placed after `FindAndReplace` in the recipe list, but worked correctly in isolation.

**Root cause:** `org.openrewrite.text.FindAndReplace` operates at the text level. After it runs, the source files are held in memory as `PlainText` representations for the remainder of the composite recipe's execution. YAML AST visitors that follow (`YamlIsoVisitor` subclasses like `DeleteNamedSequenceEntry`) traverse a YAML node tree — they do not receive `PlainText` sources and produce no changes.

This is a general rule for any composite recipe mixing AST-based YAML recipes and `FindAndReplace`:

> **All YAML AST recipes must run before any `FindAndReplace` step in the same `recipeList`.**

**Fix:** Move both `DeleteNamedSequenceEntry` steps to before `FindAndReplace`. The ordering in the final recipe is: MergeYaml → ChangeNamedSequenceEntry (×2) → DeleteNamedSequenceEntry (×2) → FindAndReplace.

---

## OpenRewrite viability for YAML

### What the built-in library covers

OpenRewrite's `rewrite-yaml` module ships ~19 production recipes. Most operate on **dot-notation property paths** (Spring Boot `application.yml` style) rather than structural sequence-of-mappings patterns. The full-AST recipes are:

| Category | Recipes |
|---|---|
| Value-level | `ChangeValue` (JsonPath), `ChangePropertyKey`, `ChangePropertyValue` |
| Key-level | `ChangeKey`, `DeleteKey` (JsonPath), `DeleteProperty` |
| Insertion | `MergeYaml`, `AppendToSequence`, `AddCommentToProperty` |
| Formatting | `CoalesceProperties`, `UnfoldProperties`, `Indents` |
| Search | `FindKey`, `FindProperty` |

`DeleteKey` and `ChangeValue` accept full JsonPath predicate expressions (`$.variables[?(@.name == 'NODE_ENV')]`), so sequence-of-mapping operations are possible without custom Java — but only if you know the predicate syntax. This is underdocumented.

### Where OpenRewrite for YAML is strong

| Strength | Detail |
|---|---|
| Format-preserving | Unchanged nodes keep their original whitespace — no full-file reformat |
| Monorepo scale | Single recipe run touches every matching file |
| Idempotent | `MergeYaml` + `objectIdentifyingProperty` prevents duplicate inserts |
| Structural matching | AST recipes match node *type and position*, not text patterns; won't match inside comments or string values |
| Dry-run + audit | `mod run` produces a patch file and telemetry CSV; nothing is written without `mod git apply` |

### Where yq wins

| Weakness | Detail |
|---|---|
| Thin built-in library | No built-in recipe for "rename item in sequence-of-mappings by name field" — the most common Azure/Kubernetes pipeline operation. Required writing two custom Java recipes |
| `FindAndReplace` ordering footgun | Text recipes must go last; silently breaks AST visitors if placed first |
| Custom recipe overhead | Custom recipes need Java, Gradle, Lombok, JUnit, and a SNAPSHOT build — not lightweight |
| `acceptTheirs` sequence bug | Built-in `MergeYaml` silently no-ops sequence additions when `acceptTheirs: true`; poorly documented |

**yq equivalents** (all three scenario operations in shell):

```bash
# Rename ENVIRONMENT → AZ_ENV
yq e '(.variables[] | select(.name == "ENVIRONMENT")).name = "AZ_ENV"' -i fullstack-ci-cd.yml

# Delete NODE_ENV
yq e 'del(.variables[] | select(.name == "NODE_ENV"))' -i fullstack-ci-cd.yml

# Add AZURE_SUBSCRIPTION
yq e '.variables += [{"name": "AZURE_SUBSCRIPTION", "value": "sp-main-production"}]' -i fullstack-ci-cd.yml
```

yq weakness: each command is a separate process; no idempotency by default; no dry-run patches; requires a shell loop for monorepo use.

### Verdict

> OpenRewrite is viable for YAML at scale — but the built-in library assumes Spring Boot property files, not CI/CD pipeline structures. Operations on `sequence-of-mappings` (the dominant pattern in Azure Pipelines, Kubernetes, and GitHub Actions) require custom Java recipes. Once those are written, the framework's monorepo scale, idempotency, and dry-run capabilities are genuinely useful. For one-off transforms on individual files, yq is substantially simpler.

| Dimension | OpenRewrite | yq |
|---|---|---|
| Logical correctness | ✅ | ✅ |
| Format preservation on untouched nodes | ✅ | ❌ full reformat |
| Built-in CI/CD pipeline primitives | ❌ thin library | ✅ |
| Monorepo scale, idempotency, dry-run | ✅ | ❌ |
| Ease for one-off transforms | ❌ JVM + custom Java | ✅ one-liner |
| `sequence-of-mappings` without custom Java | ⚠ possible via predicate JsonPath (underdocumented) | ✅ |
