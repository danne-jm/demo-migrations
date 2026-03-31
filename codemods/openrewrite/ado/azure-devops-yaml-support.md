# OpenRewrite — Azure DevOps Pipeline YAML Support

Research and architecture analysis. Companion to `json-yaml-recipe-analysis.md`.

---

## 1. How much Helm support is already in the YAML module?

### Scale of the work

All Helm support lives entirely inside `YamlParser.java`. There are no Helm-specific recipe classes, no Helm-specific visitor classes, and no new AST node types. The AST itself (`Yaml.java`) is completely unmodified — Helm expressions end up stored as plain string content in the `prefix` fields of adjacent AST nodes (as YAML comments with UUID keys).

**Lines of code in `YamlParser.java` directly attributable to Helm:**

| Section | Location | Lines |
|---------|----------|-------|
| Static regex patterns | Lines 54–62 | 9 |
| UUID substitution pre-processor | Lines 102–168 | 67 |
| `convertStandaloneHelmLinesToComments()` | Lines 676–725 | 50 |
| Post-parse UUID restoration visitor | Lines 515–596 | 82 |
| Helper methods (line ending handling) | Lines 727–769 | 43 |
| **Total** | | **~251** |

There is one dedicated test class: `HelmTemplateParsingTest.java` — 535 lines, 22 test methods.
No other files were added or modified to implement Helm support.

### What the mechanism does

Four types of problematic patterns are pre-processed before the file is handed to SnakeYAML. Each gets a random UUID substituted in place, and a mapping of `UUID → original expression` is stored in a local `HashMap`:

| Map | Pattern | What it handles | Example |
|-----|---------|----------------|---------|
| `helmTemplateByUuid` | `\{\{[^{}\n\r]*}}` | Helm `{{ }}` directives and expressions | `{{ .Values.name }}`, `{{- if .Values.enabled }}` |
| `singleBraceTemplateByUuid` | `\{[A-Za-z][^{}\n\r]*\s[^{}\n\r]*}` | Single-brace placeholders with a space inside (used by some CI tools) | `{C App}`, `{Build Stage}` |
| `variableByUuid` | `:\s+(@[^\n\r@]+@)` | OpenRewrite's own `@variable@` substitution markers | `: @myvar@` |
| `variableByUuid` | `:\s+(\*{2,}[^\n\r]*)` | Credential masks in YAML values | `: *** REMOVED ***` |

A fifth pass handles standalone Helm control-flow lines. Any line whose only content (after stripping whitespace) is a UUID is converted to a YAML comment (`#uuid`). This makes structure like:

```yaml
{{ if .Values.enabled }}
  replicas: 3
{{ end }}
```

safe for SnakeYAML by becoming:

```yaml
# 550e8400-e29b-41d4-a716-446655440000
  replicas: 3
# 550e8400-e29b-41d4-a716-446655440001
```

After SnakeYAML parses the sanitised source, a post-parse `YamlIsoVisitor<Integer>` walks the entire AST and restores the UUIDs back to their original expressions everywhere they appear — in node `prefix` fields, in `openingBracePrefix`, `closingBracePrefix`, `beforeMappingValueIndicator`, sequence bracket prefixes, and document-end prefix. The comment-wrapped UUIDs (`#uuid`) flow into the prefix of the next node and are restored there.

### How it was built (git history)

Helm support was added and stabilised over five commits to `YamlParser.java`:

| Commit | Description |
|--------|-------------|
| `c26936b` | "Add initial Helm support in YamlParser (#5766)" — first working version |
| `9674b87` | "Helm template placeholders in comments (#5990)" — improved comment wrapping |
| `9364362` | "Fix YAML parser idempotency issues with flow mappings and single-brace templates (#6604)" |
| `5755b01` | "Support standalone Helm control flow directives in YAML parsing (#6625)" — `convertStandaloneHelmLinesToComments` |
| `5715b70` | "Handle asterisk placeholder values in YAML parser (#6626)" — credential mask support |

The initial implementation was a single PR. The four follow-up PRs addressed edge cases that surfaced during real-world use. This iterative pattern is typical — the mechanism is simple in principle but accumulates corner cases.

### Summary verdict on Helm support scope

Small, self-contained, non-invasive. ~250 lines in a single file. No new AST types. No new recipe or visitor classes. The YAML module's recipes, visitors, and AST are completely unaware of Helm — they simply see the restored expressions as regular string content in scalars and prefix fields.

---

## 2. Can Azure DevOps support be added as a recipe only, or does it require parser changes?

**It requires parser changes. A recipe alone cannot solve this.**

Here is why:

A recipe operates on an already-parsed AST. If the YAML parser (SnakeYAML, via OpenRewrite's `YamlParser.java`) fails to parse the file, there is no AST — the file is skipped with a parse error and no recipe ever runs against it.

The reason current YAML parsers reject Azure DevOps pipeline files is that `${{ if condition }}:` contains `{{` and `}}`, and YAML's flow indicator rules forbid `{` and `}` inside plain (unquoted) scalars in block context (YAML 1.1 spec, which SnakeYAML enforces). The parser rejects the file before any recipe sees it.

The only recipe-only workaround would be to target the file as a `PlainText` source (OpenRewrite's text-file recipe type) and apply regex transformations — which loses all structural YAML understanding and gives up the entire value of OpenRewrite.

The fix must be in `YamlParser.java`, using the same pre/post-processing strategy already proven for Helm.

---

## 3. Why Azure DevOps is actually simpler than Helm to add

Helm has a key structural complexity that Azure DevOps does NOT:

```yaml
# Helm — standalone directive with NO colon (not a mapping key)
{{ if .Values.enabled }}
  key: value
{{ end }}
```

These lines have no YAML structure. They must be converted to comments (`#uuid`) to avoid breaking SnakeYAML. This is the entire reason `convertStandaloneHelmLinesToComments` exists.

```yaml
# Azure DevOps — ALL structural directives have a colon (they ARE mapping keys)
${{ if condition }}:
  key: value
${{ elseif otherCondition }}:
  key: otherValue
${{ else }}:
  key: fallback
${{ each var in expr }}:
  key: ${{ var }}
${{ insert }}:
  injectedKey: value
```

Every Azure DevOps template directive that creates structure has a trailing `:`. The `${{ expression }}` part is the YAML key, and `:` is the standard YAML mapping value separator. This means:

- After substituting `${{ expression }}` with a UUID, the file becomes `uuid:\n  key: value` — **already valid YAML**, no comment conversion needed.
- The `convertStandaloneHelmLinesToComments` mechanism is **not needed** for Azure DevOps.
- `${{ parameters.x }}` as a value (no colon) is already handled: it is just a string scalar, UUID-substituted and restored exactly like Helm `{{ }}` in values.

The `$` prefix also prevents any pattern collision with the existing Helm substitution.

---

## 4. Implementation roadmap

### Phase 1 — Parser: enable Azure DevOps files to be parsed (small)

All changes are in `YamlParser.java`.

**Step 1.1 — New pattern and map (2 lines)**

```java
// New static pattern — add alongside existing patterns at lines 54-62
private static final Pattern AZURE_DEVOPS_TEMPLATE_PATTERN =
    Pattern.compile("\\$\\{\\{[^{}\\n\\r]*}}");

// New map — add alongside existing maps at lines 104-106
Map<String, String> adoTemplateByUuid = new HashMap<>();
```

**Step 1.2 — Pre-processor substitution (~20 lines)**

Add a substitution block mirroring the Helm block (lines 108–118), replacing `${{ ... }}` with UUIDs. This runs before SnakeYAML sees the file. Since ALL `${{ ... }}` constructs (whether as keys or values) are replaced by the same UUID pattern, the file becomes structurally valid YAML:

```yaml
${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
  pool: ubuntu-agents
```
becomes:
```yaml
uuid-abc123:
  pool: ubuntu-agents
```

**Step 1.3 — Post-parse restoration (~10 lines)**

Add the new map to the existing restoration visitor at lines 515–596. The UUID in the key scalar is restored to `${{ if eq(...) }}`. The resulting `Yaml.Mapping.Entry` has:
- `key`: `Yaml.Scalar` with `value = "${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}"`
- `value`: `Yaml.Mapping` containing `pool: ubuntu-agents`

The printer emits this back as the original YAML, because the `:` is the mapping value indicator stored in `beforeMappingValueIndicator` (not part of the key string).

**Step 1.4 — Tests**

A new `AzureDevOpsTemplateParsingTest.java` covering:
- Conditional blocks (`${{ if }}:`, `${{ elseif }}:`, `${{ else }}:`)
- Each loops (`${{ each }}:`)
- Insert directives (`${{ insert }}:`)
- Nested conditionals
- Expression values in scalars (`pool: ${{ parameters.poolName }}`)
- Complex expressions with `variables['key']`, `parameters.x`, function calls
- Round-trip fidelity: parse → print equals input
- Parse + mutate + print: confirm unrelated YAML remains untouched

**Estimated effort for Phase 1: 1–3 days** for someone familiar with `YamlParser.java`. The mechanism is identical to Helm; the differences are the pattern, the map name, and the absence of `convertStandaloneHelmLinesToComments`. Most of the time goes to comprehensive test cases and edge-case hardening.

---

### Phase 2 — New AST node type: `Yaml.ConditionalEntry` (medium)

After Phase 1, Azure DevOps pipeline files parse correctly, but the AST treats conditional blocks as ordinary mapping entries — the key just happens to be a string that starts with `${{`. Existing recipes like `ChangeValue`, `DeleteKey`, and `MergeYaml` can operate on the content inside conditional blocks without understanding them.

For recipes that need to **reason about conditionality** (e.g. "add this entry only to the `else` branch" or "find all content gated by a specific variable"), a new AST node type is needed.

**New type in `Yaml.java`:**

```java
// Marker interface or concrete class
public interface ConditionalEntry extends Yaml {
    String getExpression();   // "${{ if eq(variables['env'], 'prod') }}"
    ConditionalKind getKind(); // IF, ELSEIF, ELSE, EACH, INSERT
    Block getBody();           // The nested YAML block
}
```

This node is created during Phase 1 post-processing: after UUID restoration, if a mapping entry's key matches `^\$\{\{.*}}$`, it is promoted from `Yaml.Mapping.Entry` to `Yaml.ConditionalEntry`.

New visitor methods in `YamlVisitor` and `YamlIsoVisitor`:

```java
public Yaml visitConditionalEntry(Yaml.ConditionalEntry entry, P p) { ... }
```

**Estimated effort for Phase 2: 1 week**. New class, two updated visitor base classes, updated printer, tests.

---

### Phase 3 — New recipes for Azure DevOps-specific operations (medium, incremental)

Once Phase 1 and optionally Phase 2 are complete, purpose-built recipes can be added:

| Recipe | Purpose |
|--------|---------|
| `AddConditionalBlock` | Wrap existing keys/values inside a new `${{ if }}:` block |
| `ChangeConditionalExpression` | Modify the expression inside an existing `${{ if }}:` key |
| `DeleteConditionalBlock` | Remove a conditional block (and optionally its content) |
| `UnwrapConditionalBlock` | Remove the `${{ if }}:` wrapper, keeping the content unconditionally |
| `AddParameterDefinition` | Add an entry to the top-level `parameters:` sequence |
| `ChangeParameterDefault` | Modify the `default:` value of a named parameter |
| `AddTemplateReference` | Add a `- template: path.yml` entry to a steps/jobs/stages sequence |

Each recipe is a separate, standard `Recipe` subclass targeting `Yaml.Documents`. They build on the existing `ChangeValue`, `MergeYaml`, and `DeleteKey` infrastructure. Phase 2's `Yaml.ConditionalEntry` node makes the conditional-specific recipes cleaner, but they can be written against Phase 1 output too (matching on key string pattern).

**Estimated effort per recipe: 0.5–1 day each.**

---

### Phase 4 — Expression evaluator (optional, advanced)

For recipes that need to reason about the *semantics* of expressions (e.g. "only apply this migration if the `${{ if }}` condition references `variables['DEPLOY_ENV']`"), a lightweight expression parser is useful.

The Azure DevOps expression grammar is simple:

- Literals: `true`, `false`, `null`, numbers, `'single-quoted strings'`, version strings
- Variable references: `variables['key']`, `variables.key`, `parameters.x`, `dependencies.job.result`, `stageDependencies.stage.job.outputs['step.var']`
- ~26 named functions: `eq()`, `ne()`, `gt()`, `and()`, `or()`, `not()`, `contains()`, `startsWith()`, `format()`, `join()`, `split()`, `iif()`, `coalesce()`, `lower()`, `upper()`, `trim()`, etc.
- Operators: None (all operations are function calls)
- Precedence: Left-to-right; functions are prefix notation

A recursive-descent parser for this grammar is ~300–400 lines of Java. No external library is needed.

**Estimated effort for Phase 4: 3–5 days.**

---

## 5. Existing OSS tools — what could be reused?

### The landscape

| Tool | Language | Stars | License | Handles `${{ }}`? | Reusable in Java? |
|------|----------|-------|---------|-------------------|------------------|
| `microsoft/azure-pipelines-agent` | C# | ~1,900 | MIT | Partially (old syntax only) | No — parser not open; expression engine not on NuGet |
| `ChristopherHX/runner.server` | C# | ~232 | MIT | **Yes — fully** | Subprocess / HTTP only |
| `samsmithnz/AzurePipelinesToGitHubActionsConverter` | C# | ~155 | MIT | Schema model only | Reference only |
| `microsoft/azure-pipelines-language-server` | TypeScript | ~43 | MIT | Partially (known open bugs) | Node subprocess only |
| `sharpliner/sharpliner` | C# | ~311 | MIT | Generates YAML, no parsing | No |
| `aelij/azure-pipelines-template-parser` | C# | ~1 | MIT | Unclear | No (dormant) |
| npm `yaml` (eemeli) | JavaScript | — | MIT | No | No |
| yq (mikefarah, Go) | Go | — | MIT | No | No |
| yq (kislyuk, Python) | Python | — | MIT | No | No |

### Why nothing can be directly embedded

All serious candidates are C# libraries (the ADO agent ecosystem is C#). None are available as a Java/JVM library or as a cleanly extractable parsing API. The most complete implementation — `runner.server` — is an emulator, not a parser library. Its `${{ }}` handling is tightly integrated with its execution engine.

Microsoft's own `azure-pipelines-agent` has the `PipelineParser.cs` source (MIT), but:
1. The relevant class handles the **old** `{{variable}}` syntax, not modern `${{ expression }}`
2. The modern expression engine (`Microsoft.TeamFoundation.DistributedTask.Expressions`) is compiled into proprietary assemblies that run inside the Azure DevOps service and are not published to NuGet ([agent issue #767](https://github.com/microsoft/azure-pipelines-agent/issues/767) confirmed this is by design)
3. No gRPC/HTTP interface exists; no WASM build exists

### No formal grammar published

Microsoft has published no formal grammar (EBNF, ANTLR, PEG) for Azure Pipelines YAML or its expression language. The [design specs in microsoft/azure-pipelines-yaml](https://github.com/microsoft/azure-pipelines-yaml/blob/master/design/each-expression.md) are prose and example-based. The [expression docs](https://learn.microsoft.com/en-us/azure/devops/pipelines/process/expressions?view=azure-devops) list all functions and literal types but contain no formal grammar.

### No tree-sitter grammar exists

`tree-sitter-azure-pipelines` does not exist. Generic YAML tree-sitter grammars (ikatyang, zed-industries) handle standard YAML and would fail on `${{ }}` keys for the same reasons as all other standard parsers.

### Microsoft's VS Code extension has open unresolved issues

The `azure-pipelines-language-server` npm package (which backs the VS Code Azure Pipelines extension) has had false-positive parse errors on `${{ if }}:` and `${{ each }}:` keys since [issue #187 (filed 2020, never resolved)](https://github.com/microsoft/azure-pipelines-vscode/issues/187). Even Microsoft's own tooling does not correctly handle this syntax in a parser context.

### Practical conclusion on reuse

**There is nothing to embed.** The expression grammar is simple enough to implement from scratch in Java in 2–3 days (see Phase 4). The YAML pre-processing layer (Phase 1) follows the already-proven Helm pattern in `YamlParser.java`. Neither requires a dependency on an external library.

The one reuse opportunity is **reference**: `samsmithnz/AzurePipelinesToGitHubActionsConverter`'s C# model classes are well-structured and cover the full Azure Pipelines schema. Reading them is useful for understanding the complete set of constructs to handle (pipelines, stages, jobs, steps, variables, parameters, resources, triggers) without reading all of Microsoft's documentation.

---

## 6. What the parser change replaces vs. what stays

A common question: does adding support require forking OpenRewrite or touching infrastructure beyond the YAML module?

**Nothing outside `rewrite-yaml` needs to change.** The complete scope of Phase 1:

| File | Change type |
|------|------------|
| `rewrite-yaml/.../YamlParser.java` | Extend existing mechanism (~30 new lines) |
| `rewrite-yaml/.../tree/Yaml.java` | No change (Phase 1); new node type (Phase 2 only) |
| `rewrite-yaml/.../YamlVisitor.java` | No change (Phase 1); new visit method (Phase 2 only) |
| `rewrite-yaml/.../YamlIsoVisitor.java` | No change (Phase 1); new visit method (Phase 2 only) |
| New test file | `AzureDevOpsTemplateParsingTest.java` |

The rest of the rewrite-yaml module — all existing recipes, all existing visitors — works without modification after Phase 1. Recipes like `ChangeValue`, `DeleteKey`, and `MergeYaml` operate on the restored AST and are already capable of targeting content inside conditional blocks using JsonPath.

---

## 7. Summary comparison: Helm vs Azure DevOps

| Dimension | Helm (done) | Azure DevOps (proposed) |
|-----------|-------------|------------------------|
| New static pattern | 1 (HELM_TEMPLATE_PATTERN) | 1 (AZURE_DEVOPS_TEMPLATE_PATTERN) |
| New UUID map | 1 (helmTemplateByUuid) | 1 (adoTemplateByUuid) |
| Pre-processor block | Yes — ~20 lines | Yes — ~20 lines (same structure) |
| `convertStandaloneHelmLinesToComments` | Yes — 50 lines (standalone `{{ }}` lines) | **Not needed** (all ADO directives have `:`) |
| Post-parse restoration | Shared visitor (add ~10 lines) | Same shared visitor |
| New AST node type | None | Optional (`Yaml.ConditionalEntry` for Phase 2) |
| New recipe classes | None | Phase 3 recipes (optional, incremental) |
| New visitor methods | None | Phase 2 only |
| Test class | HelmTemplateParsingTest.java (535 lines, 22 tests) | New file, similar scale |
| Total parser change (Phase 1) | ~251 lines | **~30 lines** (Helm already did the heavy lifting) |
| PRs to stabilise | 5 (over time) | Likely similar (edge cases emerge from real files) |
| Requires external library | No | No |
| Requires forking OpenRewrite | No | No |

Phase 1 alone (parser support, ~30 lines) is a much smaller change than the full Helm implementation was — because the mechanism already exists and just needs an additional pattern. The iterative refinement pattern (5 follow-up PRs for Helm) will almost certainly repeat: real Azure DevOps pipeline files will surface edge cases in expression complexity and formatting that tests miss.

---

## 8. Existing tools — CRUD support matrix

For reference, what each tool can and cannot do today with Azure DevOps pipeline YAML:

| Tool | Regular YAML keys | `${{ expr }}` as value | `${{ if }}:` block | `${{ each }}:` block | `${{ parameters.x }}` | `- template: path` |
|------|:-----------------:|:---------------------:|:------------------:|:--------------------:|:---------------------:|:-----------------:|
| OpenRewrite (current) | ✅ | ✅ (string) | ❌ parse error | ❌ parse error | ✅ (string) | ✅ |
| OpenRewrite (Phase 1) | ✅ | ✅ | ✅ structure preserved | ✅ structure preserved | ✅ | ✅ |
| OpenRewrite (Phase 2+) | ✅ | ✅ | ✅ semantic | ✅ semantic | ✅ | ✅ |
| npm `yaml` (eemeli) | ✅ | ❌ parse error | ❌ parse error | ❌ parse error | ❌ parse error | ✅ |
| yq (mikefarah, Go) | ✅ | ❌ parse error | ❌ parse error | ❌ parse error | ❌ parse error | ✅ |
| yq (Python, kislyuk) | ✅ | ❌ parse error | ❌ parse error | ❌ parse error | ❌ parse error | ✅ |
| azure-pipelines-language-server | ✅ | Partial | False positive errors | False positive errors | Partial | ✅ |
| Renovate Bot | ✅ | N/A | N/A | N/A | N/A | ✅ (task versions only) |
| Regex/string manipulation | Unsafe | Unsafe | Unsafe | Unsafe | Unsafe | Unsafe |

"Parse error" = the entire file is rejected; no operations are possible on it.
"Unsafe" = works but has no structural awareness; can corrupt files.
