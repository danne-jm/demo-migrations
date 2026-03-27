# OpenRewrite — JSON & YAML Recipe Analysis

Sourced from: `rewrite/rewrite-json` and `rewrite/rewrite-yaml` (OpenRewrite monorepo).

---

## Modules and shared infrastructure

OpenRewrite splits format support into two modules:

| Module | Package root | Parser | AST root type |
|--------|-------------|--------|---------------|
| `rewrite-json` | `org.openrewrite.json` | JSON5 / ANTLR | `Json.Document` |
| `rewrite-yaml` | `org.openrewrite.yaml` | SnakeYAML | `Yaml.Documents` |

Both modules share the same ANTLR-generated **JsonPath** infrastructure
(`JsonPathMatcher`, `JsonPathLexer`, `JsonPathParser`). The grammar files live
separately in each module but are identical — the path expression language is
unified across JSON and YAML.

All recipes operate on a **Lossless Semantic Tree (LST)**. Every byte of
whitespace, every comment, and every indentation character is stored as `Space`
objects attached to AST nodes. When a recipe leaves a node untouched, it prints
identically to the source. This is what OpenRewrite calls "format-preserving".

---

## JSON recipes

### Summary table

| Recipe | Category | Path targeting | Type awareness | False-positive guards | Idempotent | Caveat |
|--------|----------|---------------|---------------|----------------------|-----------|--------|
| `AddKeyValue` | Transform | JsonPath (parent object) | Partial — parses the new value as JSON | Key-exists check before insert | Yes | Calls `autoFormat()` after insert → known formatting side-effect (see Scenario 1 notes) |
| `ChangeKey` | Transform | JsonPath (member) | None — renames key string only | None beyond path match | Yes | No file-type or filename guard |
| `ChangeValue` | Transform | JsonPath (member) | Strong — new value is parsed and validated as JSON | `Changed` marker with options hash; won't re-apply same change | Yes | Most guarded of the transform recipes |
| `DeleteKey` | Transform | JsonPath (member) | None | Prefix-transfer guard on array first-element | Yes | Deletes anything at the path; no type check |
| `CopyValue` | Transform | JsonPath × 2 (source + dest) | Implicit — copies serialised value verbatim | Optional file-path filter; delegates to `AddKeyValue` for idempotency | Yes | Two-phase `ScanningRecipe`; cross-file capable |
| `SortJsonObjectKeys` | Transform | JsonPath (object) | None | Already-sorted check; ≥ 2 members guard | Yes | Calls `autoFormat()` → reformats indentation on sorted object and propagates to siblings |
| `FindKey` | Search | JsonPath (member) | None | N/A (read-only) | Yes | Marks results; also has a static `find()` helper for programmatic use |
| `CreateJsonFile` | File creation | File path (exact) | Yes — parses content before writing | Overwrite guard (`overwriteExisting` flag) | Yes | Supports inline content or URL |
| `AutoFormat` | Formatting | Global (whole document) | None | N/A | Yes | Intentional full reformat; style autodetected via `Autodetect` |
| `Indents` | Formatting | Global | None | N/A | Yes | Normalises tabs/spaces; autodetected style |
| `WrappingAndBraces` | Formatting | Global | None | N/A | Yes | Controls newlines around braces; autodetected style |

### Recipe detail

#### `AddKeyValue`
Adds a new `"key": value` pair at the path specified by a JsonPath expression
pointing to the **parent object**. The value parameter accepts any JSON type —
string, number, boolean, object, or array — and is parsed once at recipe
initialisation to validate syntax. If the key already exists the recipe is a
no-op. Supports a `prepend` flag to insert at the start of the object rather
than appending.

**Watch out for:** `autoFormat()` is called after insertion, which re-indents
the modified object using OpenRewrite's style autodetection. In practice this
collapses 4-space indentation to 2-space and can merge closing `}` brackets onto
the preceding line. This is the root cause of Issues 1–3 in the Scenario 1
analysis.

---

#### `ChangeKey`
Renames a JSON key identified by a JsonPath expression. Preserves the value
unchanged. Handles both quoted and unquoted key forms. Minimal protection —
relies entirely on the JsonPath being specific enough not to hit unintended
members.

---

#### `ChangeValue`
Replaces the value at a JsonPath expression. Validates the new value as JSON
before applying. Uses a `Changed` marker containing a hash of the recipe options
to prevent re-application: if the same path has already been changed by this
recipe with the same `value` parameter, subsequent runs are no-ops even if the
source file was not committed.

---

#### `DeleteKey`
Removes the member (key + value) at a JsonPath expression. When deleting the
first element of a JSON array the indentation prefix is transferred to the new
first element so the array formatting is preserved. No type check — will delete
a scalar, object, or array equally.

---

#### `CopyValue`
A two-phase `ScanningRecipe`. Phase 1 (scanner) traverses all matching source
files, serialises the value at `sourceKeyPath`, and stores it in an accumulator.
Phase 2 (visitor) calls `AddKeyValue` on the destination. Optional
`sourceFilePath` and `destinationFilePath` glob filters scope which files each
phase touches. Cross-file capable, meaning it can copy a value from one repo
file into another in the same run.

---

#### `SortJsonObjectKeys`
Sorts the keys of the JSON object targeted by a JsonPath expression into
ascending alphabetical order using a `Comparator`. Performs a dual-level path
check (current node and parent) to handle the distinction between a member
(`$.scripts`) and the object value of that member. Skips the sort if the list is
already ordered — idempotent. Calls `autoFormat()` after sorting with the same
formatting side-effects described under `AddKeyValue`.

---

#### `FindKey`
Read-only search. Marks matching members with a `SearchResult` marker so they
appear highlighted in diffs and reports. Provides a static helper:
`FindKey.find(Json j, String key)` for programmatic use in composite recipes.

---

#### `CreateJsonFile`
Creates a new JSON file at the given relative path. Parses the content at
creation time to validate JSON syntax. Guards against duplicate creation and
optionally overwrites existing files. Supports fetching content from a URL via
`Remote.builder()`.

---

#### `AutoFormat`, `Indents`, `WrappingAndBraces`
Global formatting recipes that rewrite whitespace across the entire document.
Use `Autodetect.detector().sample(doc).build()` to infer the existing indent
style before normalising. These are intentional full reformats — appropriate as
a standalone step but should not be mixed into a targeted migration because they
touch every node.

---

## YAML recipes

### Summary table

| Recipe | Category | Path targeting | Type awareness | False-positive guards | Idempotent | Caveat |
|--------|----------|---------------|---------------|----------------------|-----------|--------|
| `AddCommentToProperty` | Transform | Dot-notation (Spring-style) | None | Duplicate-comment check; `filePattern` filter | Yes | Relaxed binding enabled by default |
| `AppendToSequence` | Transform | JsonPath (sequence) | Scalar style detection | `AlreadyReplaced` marker; optional existing-values guard | Yes | Preserves PLAIN/QUOTED scalar style of neighbours |
| `ChangeKey` | Transform | JsonPath (mapping entry) | None | None beyond path match | No explicit marker | No idempotency guard — running twice on a partially-migrated repo can double-rename |
| `ChangeNamedSequenceEntry` | Transform | JsonPath + `name:` field value | Mapping in sequence | Exact name-value match | Yes | Explicitly designed for Azure Pipelines / Kubernetes / GitHub Actions `name:`-keyed sequences |
| `ChangePropertyKey` | Transform | Dot-notation | None | Circular-ref guard; `except` list; `filePattern` | No explicit marker | Glob wildcards supported (`*.enabled`) |
| `ChangePropertyValue` | Transform | Dot-notation | None (string comparison) | `oldValue` / regex guard; value-equality check; `filePattern` | Yes | `regex` option available; relaxed binding |
| `ChangeValue` | Transform | JsonPath (mapping entry) | Preserves anchor/tag | Value-equality check; `filePattern` | Yes | Respects `&anchor` and `!!tag` metadata on existing value |
| `CoalesceProperties` | Transform | JsonPath exclusions/applyTo | None | JsonPath exclusions list | No | Merges nested maps to dot keys; inverse of `UnfoldProperties` |
| `CommentOutProperty` | Transform | Dot-notation | None | None explicit | No | State machine across document boundaries; no idempotency guard |
| `DeleteKey` | Transform | JsonPath (mapping entry) | None | `filePattern`; prefix-transfer on first element | Yes | No type guard |
| `DeleteNamedSequenceEntry` | Transform | JsonPath + `name:` field value | Mapping in sequence | Exact name-value match; `filePattern` | Yes | Same Azure Pipelines / Kubernetes / GHA use case as `ChangeNamedSequenceEntry` |
| `DeleteProperty` | Transform | Dot-notation | None | `ToBeRemoved` marker; resolves YAML aliases first; `filePattern` | Yes | Resolves `*alias` references before deleting — correct but may be surprising |
| `MergeYaml` | Transform | JsonPath (insertion point) | Parses YAML snippet | `filePattern`; `acceptTheirs` conflict mode; `objectIdentifyingProperty` | Partially | Multi-document aware; `InsertMode` (Before/After/Last); not trivially idempotent without precise paths |
| `UnfoldProperties` | Transform | JsonPath+ (regex filters) | None | Only acts on keys containing `.` | Yes | Inverse of `CoalesceProperties`; custom regex matcher on property names |
| `CreateYamlFile` | File creation | File path (exact) | Parses content | Overwrite guard | Conditional | URL or inline content |
| `FindKey` | Search | JsonPath | None | N/A | Yes | Marks matching entries with `SearchResult` |
| `FindProperty` | Search | Dot-notation | None | Optional value filter; relaxed binding | Yes | Static `find()` helper available |
| `RemoveUnused` | Cleanup | Global | Structural (empty detection) | N/A | Yes | Removes mappings/sequences with no value |
| `Indents` | Formatting | Global | None | N/A | Yes | Autodetect indent level |
| `CopyValue` | Transform | JsonPath × 2 | Implicit | Optional file-path filters; delegates to `MergeYaml` | Yes | Two-phase `ScanningRecipe`; cross-file; chains `UnfoldProperties` |

### Recipe detail

#### `AddCommentToProperty`
Inserts a `# comment` line on the line immediately preceding the target property.
Uses Spring Boot-style dot-notation for the path (e.g. `spring.datasource.url`).
Checks for duplicate comments before inserting. A `filePattern` glob (e.g.
`**/application.yml`) limits which files are touched. Relaxed binding is on by
default, meaning `spring.dataSource.url` and `spring.data-source.url` are treated
as equivalent targets.

---

#### `AppendToSequence`
Appends a new entry to a YAML sequence identified by a JsonPath expression.
An optional `existingSequenceValues` list can be used as a precondition — the
recipe only fires if the sequence already contains those entries (in any order if
`matchExistingSequenceValuesInAnyOrder` is set). Guards against double-insertion
via an `AlreadyReplaced` marker. Detects and preserves the scalar style
(PLAIN, SINGLE_QUOTED, DOUBLE_QUOTED, etc.) of neighbouring entries.

---

#### `ChangeKey` (YAML)
Renames a YAML mapping entry key using a JsonPath expression. **Has no
idempotency marker.** If a migration run is interrupted and restarted on
partially-migrated repos, this recipe may attempt to rename again and silently
match the wrong key or fail. Use with care when running against many repositories.

---

#### `ChangeNamedSequenceEntry`
Renames the `name:` field of an item in a sequence-of-mappings. This pattern is
ubiquitous in:

```yaml
# Azure Pipelines
variables:
  - name: ENVIRONMENT    # ← this is the "name" field
    value: production
  - name: REGION
    value: us-east-1
```

The recipe locates the containing sequence via a JsonPath expression, then
matches items by their `name` field value (exact string match). Only that one
`name:` scalar is rewritten — all other fields in the item are untouched. An
optional `filePattern` scopes it to specific files (e.g. `**/azure-pipelines.yml`).

---

#### `ChangePropertyKey`
Renames a YAML property using dot-notation with full support for glob wildcards
(`*.enabled` renames the `enabled` child of every top-level key), an `except`
list of child properties to leave in place, and a circular-reference guard.
Relaxed binding is on by default. No idempotency marker, but the path match is
precise enough that double-application is unlikely to cause silent errors.

---

#### `ChangePropertyValue`
Changes the value of a dot-notation property. Can require the current value to
match an `oldValue` (literal or regex) before replacing — this is the primary
false-positive guard and should always be set when running at scale. Idempotent
via value-equality check: no change is made if the current value already equals
the new value.

---

#### `ChangeValue` (YAML)
Changes the value at a JsonPath path. More powerful than `ChangePropertyValue`
because it targets any YAML node including those whose keys are not simple
strings. Respects YAML anchors (`&anchor`) and type tags (`!!str`) on the
existing value — these are preserved on the new scalar. `filePattern` scoping
available.

---

#### `CoalesceProperties`
Merges a nested YAML hierarchy into dot-separated keys:

```yaml
# before
spring:
  datasource:
    url: jdbc:...
# after
spring.datasource.url: jdbc:...
```

The inverse of `UnfoldProperties`. JsonPath `exclusions` and `applyTo` lists
control scope. No idempotency guard — running twice is safe structurally but
would re-flatten already-flat keys.

---

#### `CommentOutProperty`
Comments out a YAML property (and optionally its subtree) and prepends an
explanatory comment. Implements a state machine that tracks document boundaries
to handle multi-document YAML files. **No idempotency guard** — re-running on a
file where the property is already commented out will attempt to comment it out
again.

---

#### `DeleteKey` (YAML)
Removes the mapping entry at a JsonPath path. When deleting the first entry in a
sequence or mapping, transfers the leading whitespace prefix to the new first
entry. `filePattern` scoping available.

---

#### `DeleteNamedSequenceEntry`
Deletes an item from a sequence-of-mappings by matching on the `name:` field
value. Same use-cases as `ChangeNamedSequenceEntry` (Azure Pipelines, Kubernetes,
GitHub Actions). Preserves formatting of remaining entries.

---

#### `DeleteProperty`
Deletes a dot-notation property. Before deletion, it runs
`ReplaceAliasWithAnchorValueVisitor` to inline any YAML alias (`*alias`) that
references the property being deleted — ensuring the deletion doesn't leave
dangling references. Uses a `ToBeRemoved` marker for idempotency. Handles
multi-document files via `Yaml.Documents`. The most defensive of the YAML
delete recipes.

---

#### `MergeYaml`
Merges an arbitrary YAML snippet into a document at a JsonPath insertion point.
This is the most powerful — and least trivially idempotent — YAML recipe.
Key options:

- `acceptTheirs` — when the key already exists, keep the original value (conflict-resolution mode)
- `objectIdentifyingProperty` — for sequences-of-mappings, use this field to identify duplicate items (default: `"name"`)
- `insertMode` — `Last` (default), `Before`, or `After` relative to `insertProperty`
- `createNewKeys` — whether to create missing key paths (default: true)

Multi-document awareness: preserves newlines before `---` separators. Validates
the YAML snippet syntax before attempting the merge.

**Idempotency note:** Without `acceptTheirs` and careful `objectIdentifyingProperty`
settings, running `MergeYaml` twice can duplicate entries in sequences or
create conflicting values in mappings. Always test with `--dry-run` first.

---

#### `UnfoldProperties`
Expands dot-separated keys into nested maps — the inverse of `CoalesceProperties`.
Supports an extended JsonPath+ syntax in `exclusions`/`applyTo` that allows
regex predicates (`?(@property.match(/pattern/))`). After expansion, uses
`ShiftFormatLeftVisitor` to correct indentation. Detects the existing indent
level via `FindIndentYamlVisitor`.

---

#### `FindKey` (YAML) and `FindProperty`
Read-only search recipes. `FindKey` uses JsonPath; `FindProperty` uses
dot-notation with relaxed binding and an optional value filter. Both mark results
with `SearchResult` markers. `FindProperty` exposes a static `find()` helper for
programmatic use in composite recipes.

---

#### `RemoveUnused`
Removes YAML mappings and sequence entries that have no value (empty). Useful as
a post-processing step after a series of deletions.

---

#### `CopyValue` (YAML)
Two-phase `ScanningRecipe` that copies a YAML value from a source path (optionally
in a different file) to a destination path. Delegates to `MergeYaml` for the
write phase and chains `UnfoldProperties` to handle dot-key paths in the merged
output.

---

## Are these recipes intelligent, type-aware, or context-aware?

All OpenRewrite recipes for JSON and YAML operate on a **parsed AST** — they are
not text-search or regex tools. This gives them structural precision that tools
like `sed` or `jq` string manipulation cannot match.

However, "structural" is not the same as "semantic":

| Dimension | JSON | YAML |
|-----------|------|------|
| Knows it is reading JSON/YAML (not plain text) | Yes | Yes |
| Understands tree structure (parent/child, siblings) | Yes | Yes |
| Understands value type (string vs number vs array) | Partial — JSON parse validates syntax | Partial — YAML scalar styles preserved |
| Understands domain meaning (port number, semver, URL) | No | No |
| Understands schema constraints (required fields, allowed values) | No | No |
| Understands file purpose (package.json vs tsconfig.json) | No, unless `filePattern` is set manually | No, unless `filePattern` is set manually |
| Understands key relationships (renaming a key updates references elsewhere) | No | No |

The recipes are **precision surgical editors**: they will execute exactly what
you tell them to, against exactly the paths you specify, on exactly the files you
filter to. They will not reason about whether the change makes sense for that
file's purpose, whether the value type is appropriate, or whether renaming a key
in one place requires updating a reference elsewhere. That reasoning is the
recipe author's responsibility.

---

## Trustworthiness at scale (dozens of repositories)

### What makes them trustworthy

| Property | Detail |
|----------|--------|
| **Idempotency** | Most recipes are no-ops when re-run on already-migrated files. `ChangeValue` uses a hash-based `Changed` marker; `AppendToSequence` uses `AlreadyReplaced`; `DeleteProperty` uses `ToBeRemoved`. |
| **Format-preservation** | The LST model stores every whitespace byte. Untouched nodes print identically to their source — verified by `requirePrintEqualsInput()` at parse time. |
| **Dry-run mode** | `mod run --dry-run` (Moderne CLI) generates a diff without writing files. All changes are reviewable before commit. |
| **Audit trail** | Each run produces a patch file and telemetry CSV. |
| **JsonPath precision** | Path expressions are compiled and matched against the full ancestor chain — not substring-matched in text. `$.scripts` only matches the object whose parent key is literally `scripts`. |
| **Preconditions system** | `Preconditions.check()` can wrap any recipe so it only runs when another condition is satisfied (e.g. only files containing a specific key). |

### Where care is required

| Risk | Recipe(s) affected | Mitigation |
|------|--------------------|-----------|
| `autoFormat()` side-effect corrupts indentation | `AddKeyValue`, `SortJsonObjectKeys` (JSON) | Remove `autoFormat()` call in custom recipe; transfer original prefix whitespace manually |
| No default file-type guard | All JSON/YAML recipes | Always set `filePattern` (e.g. `**/package.json`) unless the intent is truly monorepo-wide |
| No idempotency marker | `ChangeKey` (YAML), `ChangePropertyKey`, `CoalesceProperties`, `CommentOutProperty` | Design the JsonPath to be precise enough that a second run has nothing to match |
| `MergeYaml` can duplicate sequence entries | `MergeYaml` | Set `objectIdentifyingProperty`; use `acceptTheirs`; always dry-run first |
| Alias resolution side-effect | `DeleteProperty` | Aware of this behaviour; no action needed unless the inlined anchor value is large |
| Path overmatch on common key names | Any recipe using `$.version`, `$.name`, etc. | Narrow the JsonPath or add a `filePattern` |

**Overall verdict:** High trustworthiness when (a) JsonPath expressions are
specific, (b) `filePattern` is set, and (c) the recipe is dry-run before mass
application. The built-in formatting side-effects (`autoFormat()`) are the
primary source of surprises in practice — they are documented and fixable in
custom recipes.

---

## Repository requirements

### OpenRewrite requirements

To run OpenRewrite recipes against a repository the following must be present:

1. **Build plugin** — either the Gradle plugin (`id("org.openrewrite.rewrite")`) or
   the Maven plugin (`rewrite-maven-plugin`) in the repository's build files.
   Alternatively, the Moderne CLI (`mod run`) can apply recipes without touching
   build files, using a pre-built recipe JAR.

2. **JVM** — OpenRewrite's build tooling requires Java 8+ at runtime. The Gradle or
   Maven daemon must be startable.

3. **Recipe on classpath** — the recipe JAR (e.g. `rewrite-json`, `rewrite-yaml`,
   or a custom module) must be declared as a dependency in the `rewrite` or
   `rewriteRecipes` configuration.

4. **Source layout** — for Java/Kotlin projects, the standard `src/main` layout is
   assumed. For pure-config repos (only JSON/YAML files), any layout works because
   the file discovery is glob-based.

These requirements are specific to OpenRewrite. Other codemod tools (jscodeshift,
ts-morph, jq, sed) have their own equivalent requirements.

### Nature-of-codemodding requirements (apply to any tool)

Even with a perfect tool, safe large-scale migrations require:

| Requirement | Why |
|-------------|-----|
| **Consistent file locations** | Glob patterns like `**/application.yml` only work if every repo follows the same naming convention. Outliers are silently skipped. |
| **Stable key structure** | A JsonPath like `$.scripts.build` assumes every target file has the same nesting. Repos on different schema versions need separate recipe variants. |
| **Known schema versions** | Migrating `package.json` from one structure to another requires knowing which repos are on the old structure. OpenRewrite's search recipes can help with the audit, but the scope definition is the author's responsibility. |
| **Pre-flight dry-run** | Any batch migration should be dry-run against a representative sample before being applied to all repos. |
| **Review gate** | Automated migrations should produce pull requests for human review, not direct commits to main. |

---

## Azure DevOps YAML — edge case analysis

### What "Azure DevOps YAML" actually is

Azure Pipelines files are **not pure YAML**. They are a **meta-templating language**
that generates YAML. The Azure DevOps agent pre-processes the file before any
standard YAML parser sees it.

The two distinct syntaxes to understand:

```yaml
# 1. Template expressions — Azure DevOps meta-syntax, NOT valid YAML
${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
  - script: echo "main branch"

# 2. Expression values — valid YAML, value is a plain string
token: ${{ secrets.MY_SECRET }}
pool: ${{ parameters.poolName }}
```

### What OpenRewrite can and cannot handle

| Construct | Parseable? | Behaviour |
|-----------|-----------|-----------|
| `${{ variables.x }}` as a **value** | Yes | Parsed as a plain string scalar — can be read, changed, deleted by any recipe |
| `${{ if condition }}:` as a **key** | No | This is not valid YAML syntax; the SnakeYAML parser will reject the file entirely |
| `${{ each item in collection }}:` blocks | No | Same — pre-Azure meta-syntax, not YAML |
| `- template: my-template.yml` | Yes | This is valid YAML; the key is `template` and the value is the string `my-template.yml` |
| `parameters: ${{ parameters.someParam }}` | Yes | Value is a plain string |
| YAML anchors `&anchor` / `*alias` | Yes | Full support; `ChangeValue` preserves them; `DeleteProperty` resolves them |
| Multi-document YAML `---` | Partial | `MergeYaml` and `DeleteProperty` handle it explicitly; most others operate within individual documents |
| YAML type tags `!!str`, `!!int` | Yes | Full support via `Yaml.Tag`; `ChangeValue` preserves tags on replacement |

### Helm vs Azure DevOps handling

The OpenRewrite YAML parser includes a special case for **Helm templates** (`{{ }}`,
no leading `$`). Before passing the file to SnakeYAML, the parser replaces
`{{ ... }}` expressions with placeholder UUIDs, then restores them after parsing.
This allows Helm templates to be treated as structurally valid YAML.

**Azure DevOps `${{ }}` expressions receive no such treatment.** When they appear
as values they work fine (SnakeYAML accepts them as strings). When they appear as
keys or structural directives, the file is not valid YAML and OpenRewrite will
fail to parse it.

### The two Azure DevOps-specific recipes

`ChangeNamedSequenceEntry` and `DeleteNamedSequenceEntry` are the only OpenRewrite
recipes explicitly designed with Azure Pipelines in mind. They handle the
**sequences-of-named-mappings** pattern that appears in Azure `variables:` and
`parameters:` blocks:

```yaml
variables:
  - name: ENVIRONMENT
    value: production
  - name: API_URL
    value: https://api.example.com
```

A recipe like:
```yaml
- org.openrewrite.yaml.ChangeNamedSequenceEntry:
    sequencePath: $.variables
    entryName: ENVIRONMENT
    newEntryName: AZ_ENVIRONMENT
    filePattern: "**/azure-pipelines.yml"
```

will rename only the item whose `name: ENVIRONMENT`, leaving all other items
untouched. The same pattern covers Kubernetes `containers:` lists and GitHub
Actions `steps:`.

**These recipes do not handle conditional blocks.** A file containing:

```yaml
${{ if eq(variables.env, 'prod') }}:
  variables:
    - name: ENVIRONMENT
      value: production
```

cannot be parsed by OpenRewrite at all. The solution for conditional pipeline
files is either:
- Apply recipes to the **evaluated output** (after Azure DevOps has resolved
  templates), not the raw source files.
- Factor the conditional syntax out to a separate template file that contains
  only valid YAML (variables defined in a non-conditional block), and apply
  recipes to that file.

### Practical guidance for Azure DevOps pipelines

| Scenario | Approach |
|----------|----------|
| Rename a pipeline variable in `variables:` | `ChangeNamedSequenceEntry` with `filePattern: "**/azure-pipelines*.yml"` |
| Delete a pipeline variable | `DeleteNamedSequenceEntry` |
| Change a hardcoded value in a step | `ChangePropertyValue` or `ChangeValue` with JsonPath |
| Change a `${{ variables.x }}` expression value | Cannot be done by recipe alone — the expression is evaluated at runtime by Azure DevOps |
| Add a new variable to `variables:` | `MergeYaml` with `objectIdentifyingProperty: name` |
| File contains `${{ if ... }}:` blocks | OpenRewrite cannot parse it — pre-process or restructure the file first |
| Rename a `- template:` reference path | `ChangeValue` targeting `$.steps[*].template` or similar JsonPath |
