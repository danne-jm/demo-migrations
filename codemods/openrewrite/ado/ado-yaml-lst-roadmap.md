# Azure DevOps YAML — Full LST Support Roadmap for OpenRewrite

> Research document — no engine changes were made.
> References: `AzureDevOpsPipelineParsingTest.java`, `YamlParser.java`, `tree/Yaml.java`,
> `YamlVisitor.java`, `HelmTemplateParsingTest.java`, git history of `rewrite-yaml`.

---

## 1. What "Full LST" Means vs. What Exists Today

### The current model: scalar text

OpenRewrite's YAML LST has these core node types:

```
Yaml.Documents → Yaml.Document → Yaml.Mapping
                                  └─ Yaml.Mapping.Entry
                                       key:   Yaml.Scalar
                                       value: Yaml.Scalar | Yaml.Mapping | Yaml.Sequence
```

For a line like `vmImage: ${{ parameters.vmImage }}`, the LST produced today is:

```
Yaml.Mapping.Entry
  key:   Yaml.Scalar(value="vmImage")
  value: Yaml.Scalar(value="${{ parameters.vmImage }}")   ← opaque string
```

The `${{ parameters.vmImage }}` expression lives inside the `value` field of a `Yaml.Scalar`
as a raw string. The YAML visitor has no way to ask "is this a parameter reference?", "what
parameter name does this reference?", or "show me every place `vmImage` is referenced."

A recipe wanting to rename parameter `vmImage` → `poolImage` must do:

```java
// Today — fragile string matching:
if (scalar.getValue().contains("${{ parameters.vmImage }}")) {
    return scalar.withValue(
        scalar.getValue().replace("${{ parameters.vmImage }}",
                                   "${{ parameters.poolImage }}"));
}
```

This is the equivalent of text search-replace: it can hit false positives, misses partial
occurrences, and cannot distinguish a parameter reference from a job name that happens to
contain the same substring.

### What a full LST would look like

A fully type-attributed LST would replace the opaque scalar with a typed node:

```
Yaml.Mapping.Entry
  key:   Yaml.Scalar(value="vmImage")
  value: Yaml.AdoTemplateExpression
           kind: PARAMETER_REF
           name: "vmImage"
           rawText: "${{ parameters.vmImage }}"   ← preserved for round-trip
```

A rename recipe becomes:

```java
// Full LST — semantic, unambiguous:
@Override
public Yaml visitAdoTemplateExpression(Yaml.AdoTemplateExpression expr, ExecutionContext ctx) {
    if (expr.getExpression() instanceof AdoExpression.ParameterRef ref
            && ref.name().equals("vmImage")) {
        return expr.withExpression(new AdoExpression.ParameterRef("poolImage"))
                   .withRawText("${{ parameters.poolImage }}");
    }
    return expr;
}
```

This is the same difference as IntelliJ's "Rename refactoring" vs Ctrl+H find-replace.

---

## 2. How the Helm UUID Substitution Works (Current Mechanism)

Understanding Helm support is the foundation for understanding the ADO roadmap.

### What it does

Before `YamlParser.java` sends anything to SnakeYAML, it scans the raw source text with:

```java
// YamlParser.java:56
Pattern HELM_TEMPLATE_PATTERN = Pattern.compile("\\{\\{[^{}\\n\\r]*}}");
```

For every `{{ ... }}` match (single-line, no nested braces), it:
1. Generates a UUID
2. Records `uuid → "{{ original text }}"` in a map
3. Replaces `{{ ... }}` with the UUID in the text fed to SnakeYAML

The `$` before `${{ }}` is transparent — the pattern only targets `{{ }}`, leaving `$` as a
plain character. So `${{ parameters.vmImage }}` becomes `$abc123-uuid` in SnakeYAML's input —
a valid plain scalar. After the LST is built, a post-process visitor walks all nodes and
restores UUIDs back to the original expression text.

### The standalone line problem (solved Jan 29, 2026)

Helm control flow directives like:

```yaml
{{- if .Values.ingress.enabled }}
spec:
  rules:
    ...
{{- end }}
```

Have `{{ }}` on a line by themselves. After UUID substitution, the UUID is alone on a line —
valid YAML scalar, but structurally wrong (a document cannot be a bare string between mapping
blocks). The fix (commit `5755b014c`, Jan 29, 2026): detect UUIDs that are the only content on
a line, prepend `#` to make them YAML comments. SnakeYAML naturally stores comments as `prefix`
text on the adjacent node. On restore, `#uuid` → original Helm directive.

### What Helm support is NOT

The UUID mechanism is a **parsing workaround**, not a semantic model:

- `{{ .Values.image.tag }}` ends up as `Yaml.Scalar(value="{{ .Values.image.tag }}")` — the
  `.Values.image.tag` accessor chain is invisible to the visitor.
- Helm `if/range/end` directives stored as YAML comment prefix text on adjacent nodes. The
  "body" of an `{{- if }}` block has no distinct LST node — it is just regular YAML siblings
  that happen to share a prefix comment.
- Recipes can change values and keys around these expressions, but cannot inspect or manipulate
  the expression internals.

The Helm mechanism had 5 commits from July 21, 2025 through January 29, 2026 as new edge cases
were discovered. It remains an incrementally-patched workaround with no path to semantic typing.

---

## 3. The Three-Tier ADO Roadmap

### Tier 1 — Marker Enrichment
**Scope:** ~300 lines, 0 existing file changes, additive only

A post-parse recipe attaches typed metadata to existing `Yaml.Scalar` nodes via the `Marker`
system (same mechanism as the existing `OmitColon` marker). The scalar value stays as-is;
the marker is metadata only and is never printed.

**New files:**

```java
// marker/AdoExpressionMarker.java
@Value
public class AdoExpressionMarker implements Marker {
    UUID id;
    Kind kind;
    String expression;       // raw content inside ${{ }}
    @Nullable String name;   // for PARAMETER_REF and VARIABLE_REF

    public enum Kind {
        PARAMETER_REF,   // ${{ parameters.foo }}
        VARIABLE_REF,    // ${{ variables.foo }}
        CONDITIONAL,     // ${{ if condition }}
        ELSEIF,          // ${{ elseif condition }}
        ELSE,            // ${{ else }}
        EACH,            // ${{ each x in collection }}
        INSERT           // ${{ insert }}
    }
}
```

```java
// EnrichAdoExpressions.java  (Recipe)
// Post-parse visitor: scans scalars for ${{ }} patterns,
// parses the expression kind, attaches AdoExpressionMarker.
// Existing scalar.getValue() unchanged; marker is metadata.
```

**What this unlocks:**
- `scalar.getMarkers().findFirst(AdoExpressionMarker.class)` in any recipe
- `RenameAdoParameter` can filter: `marker.getKind() == PARAMETER_REF && marker.getName().equals("vmImage")`
- Round-trip unchanged; existing recipes unaffected

**What this does NOT do:** The scalar is still an opaque string — the marker is advisory
metadata, not a typed visitor target. `visitScalar()` is still the dispatch point.

---

### Tier 2 — New LST Node Type
**Scope:** ~800 lines, 4 small additions to existing files + 3 new files, no regressions

Replace the opaque `Yaml.Scalar` with a first-class `Yaml.AdoTemplateExpression` node whenever
the scalar value is a well-formed `${{ }}` expression.

**New expression model:**

```java
// tree/AdoExpression.java  (new file)
public sealed interface AdoExpression permits
    AdoExpression.ParameterRef,
    AdoExpression.VariableRef,
    AdoExpression.Conditional,
    AdoExpression.ElseIf,
    AdoExpression.Else,
    AdoExpression.Each,
    AdoExpression.Insert,
    AdoExpression.Raw
{
    record ParameterRef(String name) implements AdoExpression {}
    record VariableRef(String name)  implements AdoExpression {}
    record Conditional(String condition) implements AdoExpression {}
    record ElseIf(String condition)      implements AdoExpression {}
    record Else()                        implements AdoExpression {}
    record Each(String variable, String collection) implements AdoExpression {}
    record Insert()                      implements AdoExpression {}
    record Raw(String text)              implements AdoExpression {} // fallback
}
```

**New LST node (addition to `tree/Yaml.java`):**

```java
@Value
@EqualsAndHashCode(callSuper = false, onlyExplicitlyIncluded = true)
@With
class AdoTemplateExpression implements Block, YamlKey {
    @EqualsAndHashCode.Include
    UUID id;

    String prefix;
    Markers markers;
    AdoExpression expression;     // parsed, typed
    String rawText;               // "${{ parameters.vmImage }}" — for lossless print

    @Override
    public String getValue() { return rawText; }  // implements YamlKey

    @Override
    public YamlKey copyPaste() {
        return new AdoTemplateExpression(randomId(), prefix, Markers.EMPTY, expression, rawText);
    }

    @Override
    public <P> Yaml acceptYaml(YamlVisitor<P> v, P p) {
        return v.visitAdoTemplateExpression(this, p);  // new visitor dispatch
    }
}
```

**Additions to existing files (each ~5–10 lines):**

| File | Change |
|------|--------|
| `YamlVisitor.java` | Add `visitAdoTemplateExpression(expr, p)` default method |
| `YamlIsoVisitor.java` | Type-safe override returning `Yaml.AdoTemplateExpression` |
| `YamlPrinter.java` | Print case: `p.append(expr.getPrefix()); p.append(expr.getRawText())` |
| `YamlParser.java` | In UUID-restore step, upgrade qualifying scalars to `AdoTemplateExpression` |

**What this unlocks:**
- `visitAdoTemplateExpression()` with `instanceof AdoExpression.ParameterRef` checks
- `RenameAdoParameter`, `ValidateAdoExpressions`, `FindAdoParameterUsages` (cross-file scanning)
- Section 3a conditional keys (`${{ if }}:`, `${{ each }}:`) become typed mapping keys

---

### Tier 3 — Section 3b Parser Fix
**Scope:** ~2000+ lines, high regression risk, Tier 2 prerequisite

Fixes the three currently-disabled tests where `${{ if }}:` mapping keys appear at the same
indentation as `- name:` sequence items:

```yaml
variables:
  - name: SHARED_VAR          # sequence item
    value: common
  ${{ if eq(...) }}:          # mapping key — YAML cannot be both
    - name: DEPLOY_ENV
      value: production
```

**Technique:** The same approach used for standalone Helm `{{- if }}` lines (commit `5755b014c`):
detect `${{ expr }}:` lines that appear at the same indent level as sequence items, convert them
to `#uuid` YAML comments before SnakeYAML runs, parse the sequence, then reconstruct the
conditional structure from the comment markers in post-processing.

The difference from Helm: rather than leaving the restored content as comment prefix text (the
Helm approach), Tier 2 node types allow the post-processor to reconstruct typed
`Yaml.AdoConditionalBlock` nodes wrapping both the condition expression and the conditional body.

**Why this is harder than Helm's fix:**
- Helm's standalone lines are structurally isolated — they occupy full lines with no adjacent
  YAML context to preserve.
- ADO's S3b lines are interleaved with valid sequence items at the same indentation. The
  pre-processor must understand indentation scope to know where the conditional body ends.
- A new `Yaml.AdoConditionalBlock` node shape (wrapping condition + body Sequence) needs to be
  defined, printed, and visited.

---

## 4. Test Coverage Matrix

Coverage levels:
- **❌ ParseError** — file rejected; no LST, no recipes apply
- **⚠️ Scalar text** — parses; expression is opaque string; recipes match by path+string only
- **🟡 Enriched scalar** — Tier 1: typed `AdoExpressionMarker` metadata; semantic recipe filtering
- **✅ Full LST node** — Tier 2/3: dedicated typed node; visitor dispatch; semantic recipes

S1 and S4 tests contain no ADO expressions — they are plain YAML, always Full LST.

| Test | Today | Tier 1 | Tier 2 | Tier 3 |
|------|-------|--------|--------|--------|
| **S1-01** parseTriggerAndPrConfiguration | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-02** parseVariablesSequence | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-03** parseParametersBlockWithTypes | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-04** parseStagesWithJobsAndSteps | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-05** parseTemplateReferenceWithParameters | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-06** parseConditionWithBuiltInFunctions | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-07** parseDeploymentJobWithRunOnceStrategy | ✅ Full LST | ✅ | ✅ | ✅ |
| **S1-08** parseFullBuildPipelineRoundTrip | ✅ Full LST | ✅ | ✅ | ✅ |
| **S2-01** parseParameterExpressionsInValues | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S2-02** parseVariableExpressionAsDefault | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S2-03** parseDynamicJobNameWithExpression | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S2-04** parseExpressionInsideMultiLineScript | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S2-05** parameterExpressionPreservedVerbatim | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S2-06** parseDeployTemplateRoundTrip | ⚠️ Scalar | 🟡 Enriched | ✅ Full LST | ✅ |
| **S3a-01** parseConditionalElseIfChain | ⚠️ Scalar¹ | 🟡 Enriched | ✅ Full LST | ✅ |
| **S3a-02** parseEachLoopOverList | ⚠️ Scalar¹ | 🟡 Enriched | ✅ Full LST | ✅ |
| **S3a-03** parseInsertDirective | ⚠️ Scalar¹ | 🟡 Enriched | ✅ Full LST | ✅ |
| **S3a-04** parseConditionalInTemplateParameters | ⚠️ Scalar¹ | 🟡 Enriched | ✅ Full LST | ✅ |
| **S3b-01** parseConditionalIfBlock | ❌ ParseError | ❌ | ❌ | ✅ Full LST² |
| **S3b-02** parseConditionalIfElseBlock | ❌ ParseError | ❌ | ❌ | ✅ Full LST² |
| **S3b-03** parseConditionalVariableBlock | ❌ ParseError | ❌ | ❌ | ✅ Full LST² |
| **S4-01** changeVariableValue | ✅ Full LST | ✅ | ✅ | ✅ |
| **S4-02** renameVariableWithNamedSequenceEntry | ✅ Full LST | ✅ | ✅ | ✅ |
| **S4-03** deleteVariableByName | ✅ Full LST | ✅ | ✅ | ✅ |
| **S4-04** changeParameterDefaultValue | ✅ Full LST | ✅ | ✅ | ✅ |
| **S4-05** changeVmImageAcrossAllPools | ✅ Full LST | ✅ | ✅ | ✅ |

¹ S3a: conditional/each/insert **keys** (`${{ if }}:`) are opaque scalar text today — the
  mapping structure parses correctly; only the key's internal expression structure is opaque.

² S3b: Tier 3 would parse these into a new `Yaml.AdoConditionalBlock` node wrapping the
  condition expression and the conditional body (a sequence of mappings). Exact shape TBD.

**Coverage summary:**

| | Full LST | Enriched scalar | Scalar text | ParseError |
|-|---------|----------------|------------|-----------|
| Today | 13 | 0 | 10 | 3 |
| After Tier 1 | 13 | 10 | 0 | 3 |
| After Tier 2 | 23 | 0 | 0 | 3 |
| After Tier 3 | 26 | 0 | 0 | 0 |

---

## 4a. Per-Group LST State at Each Tier

One representative snippet per test group showing only the affected YAML and what the LST node looks like at each tier.

---

**S1 — Standard pipeline YAML** _(S1-01 through S1-08)_

```yaml
vmImage: ubuntu-latest
```
| Tier | LST node for the value |
|------|----------------------|
| Today | `Yaml.Scalar(value="ubuntu-latest")` |
| Tier 1 | `Yaml.Scalar(value="ubuntu-latest")` — no change; no expression to enrich |
| Tier 2 | same |
| Tier 3 | same |

S1 is plain YAML with no template expressions. The LST is already fully typed at every tier.

---

**S2 — `${{ }}` in value positions** _(S2-01 through S2-06)_

```yaml
vmImage: ${{ parameters.vmImage }}
```
| Tier | LST node for the value |
|------|----------------------|
| Today | `Yaml.Scalar(value="${{ parameters.vmImage }}")` — opaque string |
| Tier 1 | `Yaml.Scalar(value="...")` + `AdoExpressionMarker(PARAMETER_REF, name="vmImage")` |
| Tier 2 | `Yaml.AdoTemplateExpression(ParameterRef("vmImage"), rawText="${{ parameters.vmImage }}")` |
| Tier 3 | same as Tier 2 |

The YAML text is identical at every tier — only the internal representation changes.

---

**S3a — Conditional keys in pure mapping context** _(S3a-01 through S3a-04)_

```yaml
${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
  vmImage: ubuntu-latest
${{ else }}:
  vmImage: ubuntu-22.04
```
| Tier | LST node for the **key** of this mapping entry |
|------|----------------------------------------------|
| Today | `Yaml.Scalar(value="${{ if eq(...) }}")` — key is opaque string |
| Tier 1 | `Yaml.Scalar(value="...")` + `AdoExpressionMarker(CONDITIONAL, expression="eq(...)")` |
| Tier 2 | `Yaml.AdoTemplateExpression(Conditional("eq(...)"), rawText="${{ if eq(...) }}")` |
| Tier 3 | same as Tier 2 |

The mapping structure (`key → nested mapping with vmImage`) parses correctly today. Only the expression inside the key is opaque. Tier 2 makes the key typed; the value subtree (`vmImage: ubuntu-latest`) is unchanged.

---

**S3b — Conditional keys mixed with sequence items** _(S3b-01 through S3b-03)_

```yaml
variables:
  - name: BASE_IMAGE
    value: ubuntu-latest
  ${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production
```
| Tier | Outcome |
|------|---------|
| Today | `ParseError` — SnakeYAML rejects mixing `- name:` sequence items with `${{ if }}:` mapping keys at the same indent |
| Tier 1 | `ParseError` — marker enrichment is post-parse; cannot help if parse fails |
| Tier 2 | `ParseError` — new node types are post-parse; root cause unresolved |
| Tier 3 | `variables` becomes `Yaml.Sequence` containing: <br>`SequenceEntry(Mapping(name=BASE_IMAGE, value=ubuntu-latest))` <br>`SequenceEntry(AdoConditionalBlock(condition=Conditional("eq(...)"), body=Sequence([Mapping(name=DEPLOY_ENV, value=production)])))` |

Tier 3 pre-processes the `${{ if }}:` line into a `#uuid` comment so SnakeYAML parses the surrounding sequence, then post-processing reconstructs the `AdoConditionalBlock` node in the correct position.

---

## 5. Helm vs. ADO: Workaround or Final Solution?

The Helm support and ADO Tier 3 **share the same parser preprocessing technique** — convert
problematic standalone expression lines to `#uuid` YAML comments before SnakeYAML runs, then
restore them in post-processing. The parser-layer trick is architecturally identical.

But the two approaches diverge at the AST level:

| Aspect | Helm (all current tiers) | ADO Tier 1 | ADO Tier 2 / 3 |
|--------|-------------------------|-----------|----------------|
| Expression stored as | Opaque `Yaml.Scalar` string | Opaque scalar + typed `Marker` metadata | Typed `Yaml.AdoTemplateExpression` node |
| Visitor dispatch point | `visitScalar()` | `visitScalar()` | `visitAdoTemplateExpression()` |
| Rename param/var semantically | ❌ Regex on string value | ✅ Marker predicate filter | ✅ Type dispatch on expression kind |
| Parser preprocessing technique | UUID substitution | Same | Same (for S3b fix in Tier 3) |
| "Final solution"? | ❌ Growing workaround | 🟡 Semantic enrichment | ✅ Typed semantic model |

**Key distinction:** Helm got the parser workaround and stopped there — it never got typed AST
nodes. ADO Tier 2 uses the same parser workaround as a foundation but then builds a genuine
semantic model on top. These are orthogonal contributions: Tier 3 reuses the Helm-proven parsing
trick for Section 3b; Tier 2 adds semantic node types that Helm never received.

The ADO roadmap, if implemented through Tier 2, would be the first time OpenRewrite has
first-class typed AST nodes for an embedded expression language in YAML.

---

## 6. Recipe Compatibility After Tier 2 / Tier 3

A common concern when adding new node types is breaking existing recipes. The answer here is
largely positive because `Yaml.AdoTemplateExpression` implements the existing `YamlKey`
interface (with `getValue()` returning rawText), so JsonPath matching and cursor navigation
continue to work unchanged.

### Existing recipes that work unchanged

| Recipe | Why unaffected |
|--------|---------------|
| `ChangeValue` (JsonPath) | Finds `Entry` by JsonPath, sets value to new `Yaml.Scalar`. Replacing an `AdoTemplateExpression` with a plain scalar is correct semantics for "set this value to X". JsonPath matching uses `YamlKey.getValue()` which returns rawText. |
| `ChangePropertyValue` (dot notation) | `getProperty(cursor)` calls `.getValue()` on each key via `YamlKey` — rawText is returned, path matching unchanged. |
| `ChangeNamedSequenceEntry` | Searches for `name:` scalar fields inside sequence items — these are always plain values, never ADO expressions. |
| `DeleteNamedSequenceEntry` | Same. |
| `MergeYaml` | Operates at mapping/sequence level; uses `YamlKey.getValue()` for duplicate key detection — rawText provides identity. |

### One existing recipe needing a minor update

| Recipe | What changes | Fix required |
|--------|-------------|-------------|
| `ChangeKey` | Has `if (e.getKey() instanceof Yaml.Scalar)` guard. ADO conditional keys (S3a/S3b after Tier 2) are `AdoTemplateExpression`, not `Yaml.Scalar` — the `instanceof` check silently skips them. | Add `else if (e.getKey() instanceof Yaml.AdoTemplateExpression)` branch constructing a new expression node. ~5 lines. |

### New ADO-specific recipes enabled by Tier 2

| Recipe | Purpose |
|--------|---------|
| `RenameAdoParameter(oldName, newName)` | Rename `parameters.X` → `parameters.Y` across all references in a file |
| `RenameAdoVariable(oldName, newName)` | Same for variable references |
| `FindAdoParameterUsages` | `ScanningRecipe` — collect all `ParameterRef(name)` nodes across files |
| `ValidateAdoExpressions` | Error-mark any `${{ parameters.X }}` where X is never declared in `parameters:` |
| `ExtractAdoCondition` | Move inline `${{ if }}:` blocks to a reusable template file |

---

## 7. Feasibility Assessment

| Tier | New lines | Changes to existing files | Regression risk | Estimated effort |
|------|-----------|--------------------------|-----------------|-----------------|
| Tier 1 — Markers | ~300 | None | Zero | 1–2 days |
| Tier 2 — New node | ~800 | 4 additions (~10 lines each) | Low | 3–5 days |
| Tier 3 — S3b fix | ~2000+ | YamlParser.java deeply | Medium–High | 2–4 weeks |

Tiers 1 and 2 are **not a huge refactor** — they are additive extensions using the standard
OpenRewrite patterns (Marker enrichment, new LST node). Every existing test continues to pass.
The only meaningful risk surface in Tier 2 is the UUID-upgrade step in `YamlParser.java` and
the printer case, both of which are covered by `requirePrintEqualsInput` round-trip testing.

Tier 3 carries more risk because the pre-parser must be YAML-indentation-aware — subtle bugs
there can affect any file, not just ADO files. The Helm `5755b014c` fix is the direct
predecessor to validate the approach.

---

## 8. Recommended Implementation Order

1. **Tier 1 first** — `AdoExpressionMarker` + `EnrichAdoExpressions` recipe. Ships in isolation,
   zero risk, immediately enables marker-filtered recipes for the 10 S2/S3a test cases.

2. **Tier 2 second** — `Yaml.AdoTemplateExpression` + sealed expression hierarchy. One sprint.
   Gates `RenameAdoParameter` and the `FindAdoParameterUsages` scanning recipe. 23/26 tests
   reach full typed LST coverage.

3. **Tier 3 as a tracked issue** — Section 3b (`${{ if }}:` inside variable sequences) is a
   real ADO pattern but architecturally the hardest. File it, implement standalone, validate
   extensively against the existing Helm tests to ensure no regressions.

---

## 9. Migration Confidence Assessment — Current ADO Support vs Alternatives

### Is current OpenRewrite ADO support safe to use?

**Yes — with one well-defined caveat.** Current support is production-ready for the vast
majority of real pipeline files. The scalar text model is a representational detail with no
impact on whether migrations produce correct output. OpenRewrite either produces a correct,
byte-for-byte-preserved transformed file, or it produces a `ParseError` and leaves the file
untouched. It never silently corrupts output.

### What works today with full confidence

| Migration task | Works? |
|---|---|
| Change a variable value (`NODE_ENV: dev` → `production`) | ✅ |
| Rename a variable (`ENVIRONMENT` → `AZ_ENVIRONMENT`) | ✅ |
| Delete a variable by name | ✅ |
| Change a parameter default value | ✅ |
| Update pool `vmImage` everywhere at any nesting depth | ✅ |
| Add or remove steps from jobs | ✅ |
| Files using `${{ parameters.x }}` in values | ✅ expressions preserved verbatim |
| Files using `${{ if }}:` in pure mapping context (pool, template params) | ✅ |
| Multi-repo run where some files are invalid | ✅ bad files become `ParseError`, run continues |

### The one failure case — and why it is not critical

`${{ if }}:` mapping keys mixed with `- name:` sequence items at the same indentation level
fail to parse across **all three tools** (OpenRewrite, yq, npm yaml) identically. This is a
structural ambiguity in the YAML spec itself — not an OpenRewrite deficiency.

```yaml
variables:
  - name: SHARED_VAR        # sequence item
    value: common
  ${{ if eq(...) }}:        # mapping key — cannot coexist with sequence items
    - name: DEPLOY_ENV
      value: production
```

OpenRewrite wraps these files as `ParseError` nodes — the file is never touched, never
corrupted. All other files in the run continue unaffected. The failure is reported explicitly.
This is the safest possible degradation: you know exactly which files were skipped and why.

### Does the scalar text model limit migration accuracy?

No — scalar text is a limitation on a class of recipe that does not yet exist, not on the
accuracy of recipes that do exist. Changing a value, renaming a key, updating an image tag —
none of these require semantic knowledge of what is inside a `${{ }}` expression. The full
LST roadmap (Tiers 1–3) matters when you need to operate on the expression internals (rename
a parameter across all its reference sites). For standard pipeline migrations it is irrelevant.

| Migration need | Today (scalar text) | Tier 2 (typed node) |
|---|---|---|
| Change `vmImage` to `ubuntu-24.04` | ✅ | ✅ |
| Add a step to all jobs | ✅ | ✅ |
| Rename YAML key `nodeVersion` → `node_version` | ✅ | ✅ |
| Rename parameter `environmentName` → `targetEnvironment` across all `${{ }}` references | ⚠️ string grep | ✅ typed recipe |

### How current OpenRewrite compares to yq and npm yaml for migrations

All three tools share identical Section 3b failures. Beyond that, OpenRewrite is strictly
more reliable for migration work:

| Factor | OpenRewrite | yq | npm yaml |
|---|---|---|---|
| ADO parsing coverage | 23/26 | 23/26 | 22/26 |
| Format preservation | ✅ byte-for-byte | ❌ blank lines dropped | ✅ nearly lossless |
| PR diff noise from migrations | None | High — formatting changes in every file | Low |
| Bad-file failure mode | `ParseError` node, run continues | Hard exit (non-zero) | `doc.errors` array, partial AST risk |
| Cross-repo / multi-file tooling | ✅ built-in (`ScanningRecipe`, Gradle plugin) | Shell scripting only | User code required |
| Expression-semantic recipes | ❌ today, ✅ after Tier 2 | ❌ | ❌ |

yq's blank-line loss is a real problem at scale: a migration touching 40 pipeline files
produces 40 PRs each containing formatting noise unrelated to the actual change. OpenRewrite's
`requirePrintEqualsInput` guarantee eliminates this entirely.

### Summary

Use current OpenRewrite ADO support with confidence for pipeline migrations. The limitation
is narrow (one specific structural pattern, identical across all tools), fails safely
(`ParseError`, never corruption), and does not affect the accuracy of any currently-available
recipe. The scalar text model becomes relevant only when expression-semantic recipes
(`RenameAdoParameter`, `FindAdoParameterUsages`) are needed — which requires Tier 2 and
recipes that do not yet exist.
