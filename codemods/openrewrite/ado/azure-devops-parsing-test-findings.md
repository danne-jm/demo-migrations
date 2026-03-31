# Azure DevOps Pipeline YAML — OpenRewrite Parsing Test Findings

> Source: `AzureDevOpsPipelineParsingTest.java` in `rewrite-yaml`
> Engine version: 8.77.0-SNAPSHOT
> Run command: `./gradlew :rewrite-yaml:test --tests "org.openrewrite.yaml.AzureDevOpsPipelineParsingTest" --configure-on-demand`

---

## 1. What was changed — and what was not

**Tests only.** No engine source code was modified. Every file touched was under
`rewrite-yaml/src/test/java/`. The OpenRewrite parser, visitor infrastructure, recipe
implementations, and YAML LST model are all unmodified from the upstream state.

This matters for interpreting the results: everything that passes does so because of
capabilities that already exist in the engine today.

---

## 2. Test results summary

| Section | Tests | Pass | Disabled (known limitation) | Fail |
|---------|-------|------|-----------------------------|------|
| 1 — Standard pipeline YAML | 8 | 8 | 0 | 0 |
| 2 — `${{ }}` in value positions | 6 | 6 | 0 | 0 |
| 3 — `${{ expr }}:` as mapping keys | 7 | 4 | 3 | 0 |
| 4 — Mutations (built-in recipes) | 5 | 5 | 0 | 0 |
| **Total** | **26** | **23** | **3** | **0** |

The 3 disabled tests represent a known parser limitation, documented in section 5.
All 23 remaining tests pass with zero failures.

---

## 3. For passing tests: is the LST fully accurate and "intelligent"?

### Short answer

Yes — for the syntax that parses, OpenRewrite builds a complete, lossless, structurally
accurate LST, identical in quality to what it would build for any ordinary `.yaml` file.
It is not a degraded or partial model.

### What "lossless" means concretely

The YAML LST (`Yaml.Documents → Yaml.Document → Yaml.Mapping / Yaml.Sequence / Yaml.Scalar`)
stores every whitespace character, every newline, every comment — not just the structure.
The `prefix` field on each node holds the leading whitespace and any comments that precede
it. Round-tripping the LST back to text reproduces the original file byte-for-byte.
This is the `requirePrintEqualsInput` check in `YamlParser.java` — if the printed LST
diverges from the original source, it is itself treated as a parse error.

### How `${{ expression }}` values survive round-trip

The mechanism is the **Helm UUID substitution** pre-processor already built into
`YamlParser.java`. Before the file reaches SnakeYAML, the pattern
`\{\{[^{}\n\r]*}}` (double-brace, no nested braces, no newlines) scans the raw text.
For every match it:

1. Generates a UUID
2. Records `uuid → original_text` in a map
3. Replaces `{{ ... }}` with the UUID in the input given to SnakeYAML

The `$` before `${{ }}` is transparent — the pattern only matches `{{ }}`, leaving the `$`
as a literal character. So `${{ parameters.vmImage }}` becomes `$abcd1234-...` in the
SnakeYAML input. SnakeYAML sees a plain scalar string `$abcd1234-...` and stores it
correctly. After parsing, a post-processing visitor walks the LST and restores every UUID
back to its original `{{ ... }}` text, leaving the `$` intact.

The result: `${{ parameters.vmImage }}` is stored as the string value of a `Yaml.Scalar`
node — exactly as it appears in the source.

### What the LST does and does NOT know about `${{ }}`

**Does know:**
- The full original text of the expression (`"${{ parameters.vmImage }}"`)
- Its position in the document structure (which key it belongs to, its indentation, etc.)
- Whether it is a scalar value, a mapping key, part of a multi-expression string, etc.

**Does not know:**
- That `${{ }}` is an Azure DevOps template expression (it is opaque text within a `Yaml.Scalar`)
- The type of the expression (parameter reference, variable reference, etc.)
- The expression's evaluated value at runtime

In practice, this means recipes can locate and change `${{ ... }}` values using standard
JsonPath (`$.pool.vmImage`) and the full text of the expression is preserved. What recipes
cannot do today is inspect or manipulate the *internals* of the expression (e.g., rename a
parameter from `vmImage` to `poolImage` everywhere it appears inside `${{ }}`).

### AST assertion test result

`parameterExpressionPreservedVerbatim()` confirmed via `afterRecipe` callback that:

```java
deploymentScalar.getValue()  // → "Deploy_${{ parameters.environmentName }}"
vmImageScalar.getValue()     // → "${{ parameters.vmImage }}"
```

The expression text is stored verbatim, not normalized or mangled.

---

## 4. What Section 3 passing tests reveal

The four passing conditional-key tests are:

| Test | Pattern |
|------|---------|
| `parseConditionalElseIfChain` | `${{ if/elseif/else }}:` as keys in a pure mapping (`pool:`) |
| `parseEachLoopOverList` | `${{ each env in ... }}:` as sole key under `stages:` |
| `parseInsertDirective` | `${{ insert }}:` as a key in a mapping-only `variables:` block |
| `parseConditionalInTemplateParameters` | `${{ if/else }}:` inside a `parameters:` mapping passed to a template |

**What these have in common:** the `${{ }}:` key appears in a context where all sibling
entries at the same indentation are also mapping entries — there are no sequence items
(`- key: value`) mixed in at the same level.

After UUID substitution, `${{ if startsWith(...) }}:` becomes `$uuid:` — a perfectly legal
YAML plain-scalar mapping key. SnakeYAML parses it, the LST stores it, and the UUID is
restored post-parse. The resulting LST node is a `Yaml.Mapping.Entry` whose key is a
`Yaml.Scalar` containing the full `${{ if startsWith(...) }}` text.

---

## 5. The known limitation — why 3 tests are disabled

### Root cause

The 3 disabled tests all have this structure:

```yaml
variables:
  - name: BASE_IMAGE        # ← sequence item
    value: ubuntu-latest
  ${{ if eq(...) }}:        # ← mapping key at same level
    - name: DEPLOY_ENV
      value: production
```

Azure DevOps allows this. YAML 1.1 (which SnakeYAML implements) does not. A YAML block
container can be either a sequence OR a mapping — not both. Here `variables:` has a
sequence item (`- name:`) and a mapping key (`${{ if }}:`) at the same indentation, which
is structurally ambiguous and rejected.

The UUID substitution mechanism does not help here. After substitution the structure becomes:

```yaml
variables:
  - name: BASE_IMAGE
    value: ubuntu-latest
  $abcd1234-...:             # still a mapping key mixed with sequence items
    - name: DEPLOY_ENV
      value: production
```

SnakeYAML still rejects this with:
```
while parsing a block collection
expected <block end>, but found '?'
```

The `?` indicator is SnakeYAML's explicit-mapping-key token, emitted when it encounters
what looks like a mapping key inside an already-established block sequence.

### What this means in practice

This pattern is one of the **most common** Azure DevOps conditional variable patterns:

```yaml
variables:
  - name: SHARED_VAR
    value: common
  ${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production
  ${{ else }}:
    - name: DEPLOY_ENV
      value: staging
```

Any pipeline file containing this construct **cannot be parsed by OpenRewrite** in its
current state. The file will not crash the engine (see section 6), but it will not be
transformed either.

Purely mapping-level conditionals (choosing `vmImage`, `environment`, etc.) work fine:

```yaml
pool:
  ${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    vmImage: ubuntu-latest
  ${{ else }}:
    vmImage: ubuntu-22.04
```

---

## 6. What happens when the engine encounters an unparseable file

The engine does **not** crash. It does **not** silently skip the file. The behavior is:

1. SnakeYAML throws a `YAMLException`
2. `YamlParser.parseInputs()` catches `Throwable` in its `catch` block:
   ```java
   } catch (Throwable t) {
       ctx.getOnError().accept(t);          // report the error to the execution context
       return ParseError.build(this, input, relativeTo, ctx, t);  // wrap the file
   }
   ```
3. The file is returned as a **`ParseError` node** — a `SourceFile` implementation that:
   - Stores the raw original text of the file
   - Stores the exception (type, message, stack trace) in a `ParseExceptionResult` marker
   - Has the correct `sourcePath` so it can be identified in results
4. All other files continue to be parsed and transformed normally
5. Recipes that encounter a `ParseError` node simply skip it (they match on specific LST
   types like `Yaml.Documents`; a `ParseError` is neither)

### In the `RewriteTest` framework (tests only)

The test framework registers an `onError` listener that converts any reported parse error
into an `AssertionError: Failed to parse sources or run recipe`. This is why the test
throws rather than silently degrading — the test environment is deliberately strict.

In production (Gradle plugin, Moderne CLI), `onError` defaults to logging the exception.
The pipeline file with the bad syntax gets a `ParseError` entry in the run report, the
other files are transformed normally, and the run continues.

### Summary: failure modes for unparseable ADO files

| Scenario | Outcome |
|----------|---------|
| Engine crash | ✗ Does not happen |
| Other files affected | ✗ Unaffected |
| File silently skipped | ✗ Always surfaced via `ParseError` or `onError` |
| File partially transformed | ✗ Either fully parsed or fully rejected |
| Error surfaced in report | ✓ `ParseError` node with exception detail |
| File text lost | ✗ Raw text preserved in `ParseError.text` |

---

## 7. Section 4 mutation test finding — `ChangePropertyValue` vs `ChangeValue`

One initially failing mutation test exposed an important recipe limitation:

`ChangePropertyValue` uses Spring Boot-style dot notation (`pool.vmImage`). It navigates
nested **mappings** but does **not** traverse into sequences. When `pool:` is nested inside
`stages[*].jobs[*].job`, dot-notation cannot reach it.

The fix: use `ChangeValue` with recursive-descent JsonPath:
```java
new ChangeValue("$..pool.vmImage", "ubuntu-24.04", null)
```

`$..pool.vmImage` (double-dot = recursive descent) traverses the entire tree regardless of
nesting depth, updating every `pool.vmImage` in every stage, job, and deployment job in a
single pass. This is the correct recipe for "change X wherever it appears" in ADO pipelines.

---

## 8. Support matrix

| ADO YAML Construct | Parses | Builds LST | Recipes can transform |
|--------------------|--------|------------|-----------------------|
| Standard YAML (triggers, variables, stages, steps) | ✓ | ✓ full LST | ✓ |
| `${{ expr }}` in scalar values | ✓ | ✓ scalar text | ✓ (text replacement) |
| `${{ expr }}` in unquoted values | ✓ | ✓ scalar text | ✓ |
| `${{ expr }}` inside block scalar (`\|`) | ✓ | ✓ scalar text | ✓ |
| `${{ if/elseif/else }}:` in pure mapping | ✓ | ✓ mapping key as scalar | limited (key is opaque text) |
| `${{ each }}:` as sole key | ✓ | ✓ mapping key as scalar | limited |
| `${{ insert }}:` | ✓ | ✓ mapping key as scalar | limited |
| `${{ if }}:` mixed with sequence items | ✗ → `ParseError` | ✗ | ✗ |
| `${{ if }}:` / `${{ else }}:` in sequence | ✗ → `ParseError` | ✗ | ✗ |
| Named sequence recipes (`ChangeNamedSequenceEntry`) | ✓ | ✓ | ✓ |
| JsonPath recursive descent across sequences (`$..x`) | ✓ | ✓ | ✓ |

---

## 9. Path to fixing the limitation

The failing case requires a pre-processing step **before** SnakeYAML sees the file:
detect lines matching `^\s*\$\{\{[^}]*\}\}:` (a `${{ }}:` directive line with no preceding
`-`), strip them from the YAML input (replacing with blank lines or UUID comment markers),
parse the YAML, then reattach the directives as LST prefix text on adjacent nodes —
the same approach used by `convertStandaloneHelmLinesToComments()` for Helm control-flow
lines.

This is the **Phase 1** change described in `azure-devops-yaml-support.md`. It is a
~30–50 line addition to `YamlParser.java` with no changes required to the LST model,
recipes, or visitor infrastructure.
