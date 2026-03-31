# Plan: Full ADO YAML LST Support in OpenRewrite

## Context

The user wants to understand:
1. Whether OpenRewrite's Helm support is "full LST" or just scalar text
2. What building a type-attributed LST for Azure DevOps YAML template syntax would require
3. What the code would look like, how hard it is, and what the roadmap looks like

---

## 1. Current Reality: Helm is NOT Full LST

**What actually happens today (YamlParser.java:56 + lines 108–150):**

```
HELM_TEMPLATE_PATTERN = Pattern.compile("\\{\\{[^{}\\n\\r]*}}")

Input:    vmImage: ${{ parameters.vmImage }}
Step 1:   vmImage: 3f8a-uuid-here          ← UUID replaces ${{ ... }} before SnakeYAML
Step 2:   SnakeYAML parses → Yaml.Scalar(value="3f8a-uuid-here")
Step 3:   post-parse visitor restores → Yaml.Scalar(value="${{ parameters.vmImage }}")
```

The scalar value field ends up as the **raw string** `"${{ parameters.vmImage }}"`.
There is **no typed node** representing the expression structure.
This is scalar text storage — Helm support is a parsing workaround, not semantic intelligence.

**The gap this creates:**
- A recipe that renames parameter `environmentName` → `targetEnvironment` must grep the raw
  scalar string with a regex. It cannot know whether `environmentName` is a parameter reference,
  a variable name, part of a job identifier, or a coincidental substring.
- No cross-file "find all references" — the expression is opaque to the visitor.
- No type-safe validation (e.g., "this parameter was never declared").

---

## 2. What "Full LST" Would Mean for ADO YAML

Currently the LST for `vmImage: ${{ parameters.vmImage }}` is:

```
Yaml.Mapping.Entry
  key:   Yaml.Scalar(value="vmImage")
  value: Yaml.Scalar(value="${{ parameters.vmImage }}")  ← opaque string
```

A full LST would produce:

```
Yaml.Mapping.Entry
  key:   Yaml.Scalar(value="vmImage")
  value: Yaml.AdoTemplateExpression
           kind: PARAMETER_REF
           name: "vmImage"        ← typed, queryable
           rawText: "${{ parameters.vmImage }}"  ← preserved for round-trip
```

A `RenameAdoParameter` recipe could then do:

```java
visitAdoTemplateExpression(expr) {
    if (expr.getKind() == PARAMETER_REF && expr.getName().equals("environmentName")) {
        return expr.withName("targetEnvironment");
        // printer outputs: ${{ parameters.targetEnvironment }}
    }
}
```

---

## 3. Three Tiers of Enhancement

### Tier 1 — Marker Enrichment (low-cost, non-breaking, ~200–400 lines)

Post-parse: attach typed metadata to existing `Yaml.Scalar` nodes via the `Marker` system.
No changes to Yaml.java, YamlParser.java, or YamlPrinter.java.

**New files:**

```java
// marker/AdoExpressionMarker.java
@Value
public class AdoExpressionMarker implements Marker {
    UUID id;
    Kind kind;
    String expression;       // raw content inside ${{ }}
    @Nullable String name;   // for PARAMETER_REF / VARIABLE_REF

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
// EnrichAdoExpressions.java  (Recipe — runs as a ScanningRecipe or chained recipe)
public class EnrichAdoExpressions extends Recipe {
    private static final Pattern ADO_EXPR = Pattern.compile(
        "\\$\\{\\{\\s*(parameters|variables)\\.([\\w.]+)\\s*}}");

    @Override
    public TreeVisitor<?, ExecutionContext> getVisitor() {
        return new YamlIsoVisitor<ExecutionContext>() {
            @Override
            public Yaml.Scalar visitScalar(Yaml.Scalar scalar, ExecutionContext ctx) {
                Matcher m = ADO_EXPR.matcher(scalar.getValue());
                if (m.find()) {
                    Kind kind = "parameters".equals(m.group(1))
                        ? Kind.PARAMETER_REF : Kind.VARIABLE_REF;
                    AdoExpressionMarker marker =
                        new AdoExpressionMarker(randomId(), kind, m.group(), m.group(2));
                    return scalar.withMarkers(
                        scalar.getMarkers().add(marker));
                }
                return scalar;
            }
        };
    }
}
```

**What this unlocks:**
- Recipes can filter scalars by marker: `scalar.getMarkers().findFirst(AdoExpressionMarker.class)`
- `RenameAdoParameter` becomes unambiguous — only targets PARAMETER_REF markers with matching name
- Round-trip unchanged — markers are metadata, never printed
- **Does NOT solve Section 3b** (structural ambiguity)

**Cost:** 2 new Java files, 0 changes to existing files. Testable in ~1 day.

---

### Tier 2 — New LST Node Type (medium-cost, additive, ~600–1000 lines)

Add `Yaml.AdoTemplateExpression` as a first-class LST node, replacing the opaque `Yaml.Scalar`
when the value is a well-formed `${{ }}` expression.

**Changes required:**

#### 2a. New expression model (new file: `tree/AdoExpression.java`)

```java
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

#### 2b. New LST node (added to `tree/Yaml.java`)

```java
@Value
@EqualsAndHashCode(callSuper = false, onlyExplicitlyIncluded = true)
@With
class AdoTemplateExpression implements Block, YamlKey {
    @EqualsAndHashCode.Include
    UUID id;

    String prefix;
    Markers markers;
    AdoExpression expression;
    String rawText;   // original "${{ parameters.vmImage }}" — for printing

    @Override
    public String getValue() { return rawText; }

    @Override
    public YamlKey copyPaste() {
        return new AdoTemplateExpression(randomId(), prefix, Markers.EMPTY, expression, rawText);
    }

    @Override
    public <P> Yaml acceptYaml(YamlVisitor<P> v, P p) {
        return v.visitAdoTemplateExpression(this, p);
    }
}
```

#### 2c. YamlVisitor.java — add one new method

```java
public Yaml visitAdoTemplateExpression(Yaml.AdoTemplateExpression expr, P p) {
    return expr;  // leaf node, no children to recurse
}
```

And `YamlIsoVisitor.java`:
```java
@Override
public Yaml.AdoTemplateExpression visitAdoTemplateExpression(
    Yaml.AdoTemplateExpression expr, P p) {
    return (Yaml.AdoTemplateExpression) super.visitAdoTemplateExpression(expr, p);
}
```

#### 2d. YamlPrinter.java — add one case

```java
@Override
public Yaml visitAdoTemplateExpression(Yaml.AdoTemplateExpression expr, PrintOutputCapture<P> p) {
    p.append(expr.getPrefix());
    p.append(expr.getRawText());  // always prints verbatim — lossless
    return expr;
}
```

#### 2e. YamlParser.java — upgrade UUID restoration

After UUID restore, if the restored string matches `${{ ... }}`, upgrade to `AdoTemplateExpression`:

```java
// In the UUID-restoration visitor, after restoring a scalar's value:
if (scalar.getValue().startsWith("${{") && scalar.getValue().endsWith("}}")) {
    AdoExpression parsed = AdoExpressionParser.parse(scalar.getValue());
    return new Yaml.AdoTemplateExpression(
        scalar.getId(), scalar.getPrefix(), scalar.getMarkers(),
        parsed, scalar.getValue());
}
```

A small `AdoExpressionParser.parse(String raw)` utility maps the expression text to
the sealed hierarchy (parameter/variable/if/each/insert/etc.).

**What this unlocks:**
- Fully typed visitor: `visitAdoTemplateExpression()` with `expr.getExpression()` instanceof checks
- `RenameAdoParameter(oldName, newName)` recipe trivially walks and renames
- Future: `FindAdoParameterUsages` cross-file scanning recipe
- `validateAdoExpressions` — check all `${{ parameters.x }}` references have a matching parameter definition

**Does NOT solve Section 3b** — the SnakeYAML structural issue remains.

**Cost:** ~4 files modified (Yaml.java, YamlParser.java, YamlVisitor.java, YamlPrinter.java) +
~3 new files (AdoExpression.java, AdoExpressionParser.java, tests). ~3–5 days.
**Risk:** Low — purely additive. `requirePrintEqualsInput` tests on Helm files will still pass
because rawText is preserved verbatim.

---

### Tier 3 — Fix Section 3b Structural Ambiguity (hard, high-risk, ~2000+ lines)

**The problem:**
```yaml
variables:
  - name: BASE_IMAGE       # Yaml.Sequence item
    value: ubuntu-latest
  ${{ if eq(...) }}:       # Yaml.Mapping key — DIFFERENT parent type
    - name: DEPLOY_ENV
      value: production
```

SnakeYAML sees a sequence (the `- name:` items) then immediately a mapping key
(`${{ if }}:`). It throws `did not find expected '-' indicator`.

**The approach:**
Pre-processing must convert the mixed structure so SnakeYAML sees a homogeneous type.
One viable strategy (still experimental):

1. Detect "ADO mixed sequence/mapping" blocks: lines where a `${{ if|each|else }}:` key
   appears at the same indent as `- name:` items.
2. Convert the `${{ if }}:` and its indented body to a special comment block:
   ```
   # __ADO_CONDITIONAL_BEGIN__ <uuid>
   # __ADO_CONDITIONAL_BODY__ <escaped yaml>
   # __ADO_CONDITIONAL_END__ <uuid>
   ```
3. SnakeYAML now only sees the sequence items — parses successfully.
4. Post-parse: visitor detects these comment markers, reconstructs the conditional structure,
   and inserts new `Yaml.AdoConditionalBlock` nodes at the correct position in the sequence.

**Why this is hard:**
- Requires a pre-parser that understands ADO indentation context — essentially a YAML-aware
  regex/state machine over raw text before SnakeYAML runs.
- Post-parse reconstruction must handle deeply nested conditionals.
- Very high risk of breaking round-trip tests (`requirePrintEqualsInput` will catch regressions).
- The feature is architecturally separate from Tiers 1–2; could be built incrementally.

**Recommendation:** Leave Section 3b for a dedicated follow-on after Tier 2 ships.
In practice, `${{ if }}:` blocks inside `variables:` sequences are the minority of ADO usage —
most expressions appear in value positions (Section 2) and pure-mapping keys (Section 3a).

---

## 4. Is This a Huge Refactor?

| Tier | Lines of code | Changes to existing files | Regression risk | Timeline |
|------|--------------|--------------------------|-----------------|----------|
| Tier 1 (Markers) | ~300 | None | Zero | 1–2 days |
| Tier 2 (New node) | ~800 | 4 small additions | Low | 3–5 days |
| Tier 3 (Section 3b) | ~2000+ | YamlParser.java deeply | High | 2–4 weeks |

**Verdict: Tier 1 and 2 are NOT a huge refactor.** The OpenRewrite architecture is
explicitly designed for this pattern — `Marker` enrichment and new node types are the
standard extension mechanisms (see `OmitColon` marker as the existing example).

The existing YAML module stays intact. No recipes break. All existing tests pass.
The only new risk surface is the UUID-upgrade step in YamlParser and the printer case.

---

## 5. Recommended Implementation Order

1. **Tier 1 now** — Ship `AdoExpressionMarker` + `EnrichAdoExpressions` recipe. Immediate
   value for recipe authors without any parser risk.
2. **Tier 2 after** — Add `Yaml.AdoTemplateExpression` node. Gates `RenameAdoParameter`
   and other semantic recipes. One sprint.
3. **Tier 3 eventually** — Section 3b is a nice-to-have for edge cases in template files.
   File as a tracked issue; tackle standalone without pressure.

---

## Critical Files to Modify (Tier 2)

| File | Change |
|------|--------|
| [tree/Yaml.java](rewrite/rewrite-yaml/src/main/java/org/openrewrite/yaml/tree/Yaml.java) | Add `AdoTemplateExpression` inner class (~50 lines) |
| [YamlParser.java](rewrite/rewrite-yaml/src/main/java/org/openrewrite/yaml/YamlParser.java) | Upgrade Scalar → AdoTemplateExpression post-UUID restore (~20 lines) |
| [YamlVisitor.java](rewrite/rewrite-yaml/src/main/java/org/openrewrite/yaml/YamlVisitor.java) | Add `visitAdoTemplateExpression()` method (~5 lines) |
| [YamlIsoVisitor.java](rewrite/rewrite-yaml/src/main/java/org/openrewrite/yaml/YamlIsoVisitor.java) | Type-safe override (~5 lines) |
| [internal/YamlPrinter.java](rewrite/rewrite-yaml/src/main/java/org/openrewrite/yaml/internal/YamlPrinter.java) | Print case for new node (~8 lines) |

**New files:**
- `tree/AdoExpression.java` — sealed expression hierarchy
- `AdoExpressionParser.java` — mini-parser for `${{ }}` content
- `marker/AdoExpressionMarker.java` — Tier 1 marker (can be done first independently)
- Test class mirroring `AzureDevOpsPipelineParsingTest.java` for new node assertions

---

---

## 6. Test Coverage Matrix Per Tier

Coverage levels:
- **❌ ParseError** — file rejected entirely; no LST, no recipes apply
- **⚠️ Scalar text** — parses; expression stored as opaque string; recipes match by path+string only
- **🟡 Enriched scalar** — parses; `AdoExpressionMarker` on scalar with `kind` + `name`; semantic recipe filtering possible
- **✅ Full LST node** — parses; dedicated `Yaml.AdoTemplateExpression` node; visitor dispatch, typed recipes

**S1 tests are plain YAML with no ADO expressions — always ✅ Full LST regardless of tier.**

| Test | Today (no tiers) | After Tier 1 | After Tier 2 | After Tier 3 |
|------|-----------------|-------------|-------------|-------------|
| **S1-01** parseTriggerAndPrConfiguration | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-02** parseVariablesSequence | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-03** parseParametersBlockWithTypes | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-04** parseStagesWithJobsAndSteps | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-05** parseTemplateReferenceWithParameters | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-06** parseConditionWithBuiltInFunctions | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-07** parseDeploymentJobWithRunOnceStrategy | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S1-08** parseFullBuildPipelineRoundTrip | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S2-01** parseParameterExpressionsInValues | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S2-02** parseVariableExpressionAsDefault | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S2-03** parseDynamicJobNameWithExpression | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S2-04** parseExpressionInsideMultiLineScript | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S2-05** parameterExpressionPreservedVerbatim | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S2-06** parseDeployTemplateRoundTrip | ⚠️ Scalar text | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S3a-01** parseConditionalElseIfChain | ⚠️ Scalar text¹ | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S3a-02** parseEachLoopOverList | ⚠️ Scalar text¹ | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S3a-03** parseInsertDirective | ⚠️ Scalar text¹ | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S3a-04** parseConditionalInTemplateParameters | ⚠️ Scalar text¹ | 🟡 Enriched scalar | ✅ Full LST node | ✅ Full LST node |
| **S3b-01** parseConditionalIfBlock | ❌ ParseError | ❌ ParseError | ❌ ParseError | ✅ Full LST node² |
| **S3b-02** parseConditionalIfElseBlock | ❌ ParseError | ❌ ParseError | ❌ ParseError | ✅ Full LST node² |
| **S3b-03** parseConditionalVariableBlock | ❌ ParseError | ❌ ParseError | ❌ ParseError | ✅ Full LST node² |
| **S4-01** changeVariableValue | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S4-02** renameVariableWithNamedSequenceEntry | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S4-03** deleteVariableByName | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S4-04** changeParameterDefaultValue | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |
| **S4-05** changeVmImageAcrossAllPools | ✅ Full LST | ✅ Full LST | ✅ Full LST | ✅ Full LST |

¹ S3a: conditional/each/insert **keys** (`${{ if }}:`) are opaque scalar text today — the key IS a `Yaml.Scalar`
  containing the full expression string. The mapping structure parses fine; only the key's internals are opaque.

² S3b: Tier 3 would parse these into a new `Yaml.AdoConditionalBlock` node (or similar) wrapping both the
  condition expression and the sequence-of-mappings body. Exact shape TBD at design time.

**Coverage totals:**

| Tier | Full LST | Enriched | Scalar text | ParseError |
|------|---------|---------|------------|-----------|
| Today | 13 | 0 | 10 | 3 |
| After Tier 1 | 13 | 10 | 0 | 3 |
| After Tier 2 | 23 | 0 | 0 | 3 |
| After Tier 3 | 26 | 0 | 0 | 0 |

---

## 7. How Complete Is Helm YAML Support?

**Git history of Helm/parser work (all by Tim te Beek, Moderne):**

| Commit | Date | What it solved |
|--------|------|----------------|
| `c26936beb` | 2025-07-21 | Initial: UUID substitution for `{{ }}` in value positions |
| `9674b8774` | 2025-09-02 | Extended: `{{ }}` inside YAML comments |
| `936436249` | 2026-01-28 | Fix: idempotency bugs with flow mappings and single-brace templates |
| `5755b014c` | 2026-01-29 | **Critical**: standalone `{{- if }}`, `{{- end }}`, `{{- range }}` lines → convert to `#uuid` comments |
| `5715b7051` | 2026-01-29 | Extended: `*** REMOVED ***` credential placeholders |

**Conclusion: Helm support is NOT complete; it is an actively-maintained workaround.**

The support is a series of escalating preprocessing tricks, each solving one more category of
invalid YAML that Helm produces. As of January 29, 2026 (2 months ago), it was still receiving
significant fixes. The pattern will continue: every new Helm edge case discovered in production
requires another regex/preprocessing rule.

**Why it is NOT full LST:**
- `{{ .Values.image.tag }}` is stored as an opaque `Yaml.Scalar(value="{{ .Values.image.tag }}")`.
  The `.Values.image.tag` accessor chain is invisible to the visitor.
- Helm control flow lines (`{{- if ... }}`, `{{- end }}`) are stored as YAML **comment prefix text**
  on the adjacent node — not as typed conditional block nodes. The LST structure around them is
  wrong (the logical "if block body" has no distinct node; it just reads as regular YAML siblings
  that happen to have a comment prefix).
- A recipe cannot ask "find all `range` loops" — it must grep prefix strings or scalar values.
- Renaming a Helm value path (`image.tag` → `image.repository`) requires string replacement across
  multiple scalar values — same fragility as text search-replace.

**But it is safe and practically usable for:**
- Changing values (`image.tag: latest` → `image.tag: v2.3.0`)
- Renaming YAML keys (`name: foo` → `name: bar`)
- Adding/removing entries from sequences and mappings
- All standard YAML recipes (ChangeValue, ChangeKey, MergeYaml, etc.)
- Round-trip is guaranteed lossless — `requirePrintEqualsInput` passes

---

## 8. ADO Roadmap: Workaround or Final Solution?

| Aspect | Helm (current) | ADO Tier 1 (markers) | ADO Tier 2 (new node) | ADO Tier 3 (S3b parser fix) |
|--------|---------------|---------------------|----------------------|---------------------------|
| Expression stored as | Opaque string | Opaque string + typed metadata | Typed AST node | Typed AST node |
| Can rename param/var semantically | ❌ Grep only | ✅ Marker-filtered recipe | ✅ Typed visitor | ✅ Typed visitor |
| Control flow lines (standalone `{{- if }}`) | Workaround: `#uuid` comment | Same | Same (for values only) | Workaround: comment+restore |
| Round-trip | ✅ rawText | ✅ rawText | ✅ rawText | ✅ rawText |
| Recipe sophistication | String matching | Marker predicate | Type dispatch | Type dispatch |
| Is this a "final solution"? | ❌ Workaround | 🟡 Partial | ✅ For Sections 1-3a | ✅ All 26 tests |

**Verdict:**
- Helm and ADO **Tier 3 share the same parser preprocessing technique** (convert problematic standalone lines to `#uuid` YAML comments before SnakeYAML, restore after). The parser-layer trick is identical.
- But once parsed, the ASTs diverge entirely: Helm expressions remain opaque `Yaml.Scalar` strings at every tier. ADO Tier 2 and 3 produce genuine `Yaml.AdoTemplateExpression` nodes — type-attributed, visitor-dispatched, semantically queryable.
- The correct framing: **Tier 3 reuses a Helm-proven parser workaround to fix Section 3b, then Tier 2 builds a better AST on top of it.** These are orthogonal concerns — the workaround is a parsing trick; the typed node is a semantic enhancement. Helm never got the semantic enhancement step.
- The ADO roadmap is the **first time** OpenRewrite would have first-class typed AST nodes for an embedded expression language in YAML — Helm did not achieve this.

---

## 10. Recipe Compatibility After Tier 2 / Tier 3

### Existing recipes that work **unchanged:**

| Recipe | Why it still works |
|--------|-------------------|
| `ChangeValue` (JsonPath) | Finds `Entry` by path, sets value to a new `Yaml.Scalar`. Replaces `AdoTemplateExpression` with a plain scalar — correct for "set this value to X". JsonPath matching unchanged because `AdoTemplateExpression.getValue()` returns rawText (implements `YamlKey`). |
| `ChangePropertyValue` (dot notation) | Same — `getProperty(cursor)` calls `.getValue()` on each key via `YamlKey` interface. |
| `ChangeNamedSequenceEntry` | Searches for `name:` scalar fields inside sequence items. These are never ADO expressions — unaffected. |
| `DeleteNamedSequenceEntry` | Same. |
| `MergeYaml` | Operates at mapping/sequence structural level. Uses `YamlKey.getValue()` for duplicate detection — `AdoTemplateExpression.getValue()` returns rawText, so key identity still works. |

### Existing recipes that need **minor updates:**

| Recipe | What breaks | Fix |
|--------|-------------|-----|
| `ChangeKey` | `instanceof Yaml.Scalar` guard at line `e.withKey(((Yaml.Scalar) e.getKey()).withValue(newKey))` silently skips ADO conditional keys (S3a cases like `${{ if }}:` keys). | Add `instanceof Yaml.AdoTemplateExpression` branch that constructs new `AdoTemplateExpression` with updated rawText and re-parses the expression. ~5 lines. |

### New ADO-specific recipes (Tier 2+ only):

| Recipe | Purpose | Requires |
|--------|---------|---------|
| `RenameAdoParameter` | Rename `parameters.oldName` → `parameters.newName` across all references in a file | `visitAdoTemplateExpression()` with `ParameterRef` check |
| `RenameAdoVariable` | Same for variable references | Same |
| `FindAdoParameterUsages` | `ScanningRecipe` that collects all `ParameterRef` nodes across files | Tier 2 node |
| `ValidateAdoExpressions` | Error-marker any `${{ }}` where the referenced parameter is never declared | Tier 2 + cross-file scan |
| `ExtractAdoCondition` | Move inline `${{ if }}:` to a separate template file | Tier 2 node + new file writing |

---

## 9. Output Document

Write `/home/daniel/Desktop/Programming/assignment/demo-migrations/codemods/openrewrite/ado-yaml-lst-roadmap.md` covering:
- Summary of current state (what Helm UUID substitution actually does and why it is NOT full LST)
- Explanation of Full LST vs Scalar Text vs Enriched Scalar with concrete ADO examples
- The 3-tier roadmap with code sketches for each tier
- The 26-test coverage matrix above
- Feasibility assessment table (lines/risk/timeline per tier)
- Recommended order of implementation

## Verification

After implementation:
1. All existing tests pass: `./gradlew :rewrite-yaml:test`
2. `requirePrintEqualsInput` passes on all 26 ADO test cases (rawText round-trip)
3. New test: `AdoTemplateExpressionTest.java` with `afterRecipe()` that asserts
   `expr instanceof Yaml.AdoTemplateExpression` and `expr.getExpression() instanceof ParameterRef`
4. New recipe test: `RenameAdoParameterTest.java` — rename across multiple occurrences in one file
