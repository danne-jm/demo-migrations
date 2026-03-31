#!/usr/bin/env bash
# Empirical test: yq v4 against Azure DevOps pipeline YAML syntax
#
# Tests are identical to AzureDevOpsPipelineParsingTest.java in the OpenRewrite
# rewrite-yaml module — same YAML content, same 4-section structure — allowing
# direct comparison between the three tools (OpenRewrite, yq, npm yaml).
#
# Run:  bash ado-test-yq.sh
# Requires: yq v4 (mikefarah/yq) installed and on PATH
#
# Key source finding (yq/go.mod):
#   yq uses github.com/goccy/go-yaml v1.19.2 — NOT gopkg.in/yaml.v3
#   goccy/go-yaml implements YAML 1.2 block-context plain scalar rules:
#   { and } are only forbidden inside flow context ({...} or [...]).
#   => ${{ parameters.vmImage }} parses as a plain scalar in block context
#      without any pre-processing — same result as npm yaml, different from
#      OpenRewrite (which uses UUID pre-substitution as a SnakeYAML workaround).
#
# NOTE: yq installed via snap cannot access /tmp — temp files are written to $HOME.

YQ="yq"
PASS=0
FAIL=0
RESULTS=()

# Helper: write YAML to a temp file, run yq, return exit code
run_yq() {
  local yaml="$1"
  local expr="${2:-.}"
  local tmpf
  tmpf=$(mktemp "$HOME/ado-yq-test-XXXX.yaml")
  printf '%s' "$yaml" > "$tmpf"
  local out
  out=$($YQ "$expr" "$tmpf" 2>&1)
  local rc=$?
  rm -f "$tmpf"
  echo "$out"
  return $rc
}

# test_case NAME YAML [EXPR] [expect_pass=true|false]
test_case() {
  local name="$1"
  local yaml="$2"
  local expr="${3:-.}"
  local expected_pass="${4:-true}"

  local out
  out=$(run_yq "$yaml" "$expr" 2>&1)
  local rc=$?

  if [ "$expected_pass" = "true" ]; then
    if [ $rc -eq 0 ]; then
      PASS=$((PASS+1))
      RESULTS+=("PASS|$name|")
    else
      FAIL=$((FAIL+1))
      local err
      err=$(echo "$out" | head -2 | tr '\n' ' ')
      RESULTS+=("FAIL|$name|$err")
    fi
  else
    if [ $rc -ne 0 ]; then
      PASS=$((PASS+1))
      RESULTS+=("PASS|$name|(expected failure — $(echo "$out" | head -1))")
    else
      FAIL=$((FAIL+1))
      RESULTS+=("FAIL|$name|(expected failure but succeeded)")
    fi
  fi
}

# ─── SECTION 1: Standard pipeline YAML ───────────────────────────────────────

test_case "S1-01 parseTriggerAndPrConfiguration" \
'trigger:
  branches:
    include:
      - main
      - develop
      - release/*
  paths:
    include:
      - frontend/*
      - backend/*
pr:
  branches:
    include:
      - main
      - develop'

test_case "S1-02 parseVariablesSequence" \
"variables:
  - name: ENVIRONMENT
    value: 'dev'
  - name: NODE_ENV
    value: 'production'
  - name: nodeVersion
    value: '20.x'
  - name: vmImage
    value: 'ubuntu-latest'"

test_case "S1-03 parseParametersBlockWithTypes" \
'parameters:
  - name: vmImage
    type: string
  - name: environmentName
    type: string
  - name: NODE_ENV
    type: string
    default: production
  - name: retryCount
    type: number
    default: 3
  - name: runSmokeTests
    type: boolean
    default: true'

test_case "S1-04 parseStagesWithJobsAndSteps" \
'stages:
  - stage: Validate
    displayName: Validate and test
    jobs:
      - job: WorkspaceValidation
        pool:
          vmImage: ubuntu-latest
        steps:
          - checkout: self
            clean: true
          - task: NodeTool@0
            displayName: Use Node.js 20.x
            inputs:
              versionSpec: 20.x
          - script: npm run build
            displayName: Install and build'

test_case "S1-05 parseTemplateReferenceWithParameters" \
"stages:
  - stage: Deploy_Dev
    displayName: Deploy to Development
    dependsOn: Build
    condition: \"and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))\"
    jobs:
      - template: ../templates/deploy/deploy-frontend.yml
        parameters:
          vmImage: \$(vmImage)
          artifactName: \$(artifactNameFrontend)
          environmentName: \$(deployEnvironmentDev)
          webAppName: demo-frontend-dev"

test_case "S1-06 parseConditionWithBuiltInFunctions" \
"stages:
  - stage: Deploy_Dev
    condition: \"and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))\"
    jobs: []
  - stage: Deploy_Stage
    condition: \"and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))\"
    jobs: []
  - stage: Deploy_Prod
    condition: \"and(succeeded(), startsWith(variables['Build.SourceBranch'], 'refs/heads/release/'))\"
    jobs: []"

test_case "S1-07 parseDeploymentJobWithRunOnceStrategy" \
'jobs:
  - deployment: DeployFrontend
    displayName: Deploy frontend
    pool:
      vmImage: ubuntu-latest
    environment: dev
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: frontend-dist
            - task: AzureCLI@2
              displayName: Deploy frontend artifact
              inputs:
                azureSubscription: service-connection-demo
                scriptType: bash
                inlineScript: |
                  az webapp deployment source config-zip \
                    --resource-group rg-demo-dev \
                    --name demo-frontend-dev \
                    --src "$(Pipeline.Workspace)/frontend-dist/frontend.zip"'

test_case "S1-08 parseFullBuildPipelineRoundTrip" \
"trigger:
  branches:
    include:
      - main
      - develop
      - release/*

pr:
  branches:
    include:
      - main

name: \$(Date:yyyyMMdd)\$(Rev:.r)

variables:
  - name: ENVIRONMENT
    value: 'dev'
  - name: NODE_ENV
    value: 'production'
  - name: environmentTemplate
    value: '\${{ variables.ENVIRONMENT }}'

stages:
  - stage: Build
    displayName: Build frontend and backend
    jobs:
      - template: ../templates/build/build-frontend.yml
        parameters:
          vmImage: \$(vmImage)"

# ─── SECTION 2: ${{ }} in value positions ────────────────────────────────────

test_case "S2-01 parseParameterExpressionsInValues" \
"parameters:
  - name: vmImage
    type: string
  - name: environmentName
    type: string
jobs:
  - deployment: DeployFrontend_\${{ parameters.environmentName }}
    displayName: Deploy frontend to \${{ parameters.environmentName }}
    pool:
      vmImage: \${{ parameters.vmImage }}
    environment: \${{ parameters.environmentName }}"

test_case "S2-02 parseVariableExpressionAsDefault" \
"parameters:
  - name: ENVIRONMENT
    type: string
    default: \${{ variables.ENVIRONMENT }}
  - name: NODE_ENV
    type: string
    default: production"

test_case "S2-03 parseDynamicJobNameWithExpression" \
"jobs:
  - deployment: DeployBackend_\${{ parameters.environmentName }}
    displayName: Deploy backend to \${{ parameters.environmentName }}
    pool:
      vmImage: \${{ parameters.vmImage }}
    environment: \${{ parameters.environmentName }}
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: \${{ parameters.artifactName }}"

test_case "S2-04 parseExpressionInsideMultiLineScript" \
"jobs:
  - deployment: DeployFrontend
    strategy:
      runOnce:
        deploy:
          steps:
            - task: AzureCLI@2
              inputs:
                inlineScript: |
                  ARTIFACT_PATH=\"\$(Pipeline.Workspace)/\${{ parameters.artifactName }}/frontend.zip\"
                  az webapp deployment source config-zip \\
                    --resource-group rg-demo-\${{ parameters.environmentName }} \\
                    --name \${{ parameters.webAppName }} \\
                    --src \"\$ARTIFACT_PATH\""

# S2-05: verify scalar value preserved verbatim — query .jobs[0].deployment
test_case "S2-05 parameterExpressionPreservedVerbatim" \
"jobs:
  - deployment: Deploy_\${{ parameters.environmentName }}
    pool:
      vmImage: \${{ parameters.vmImage }}" \
'.jobs[0].deployment'

test_case "S2-06 parseDeployTemplateRoundTrip" \
"parameters:
  - name: vmImage
    type: string
  - name: environmentName
    type: string
  - name: ENVIRONMENT
    type: string
    default: \${{ variables.ENVIRONMENT }}
jobs:
  - deployment: DeployFrontend_\${{ parameters.environmentName }}
    displayName: Deploy frontend to \${{ parameters.environmentName }}
    pool:
      vmImage: \${{ parameters.vmImage }}
    environment: \${{ parameters.environmentName }}
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: \${{ parameters.artifactName }}
            - task: AzureCLI@2
              inputs:
                inlineScript: |
                  ARTIFACT_PATH=\"\$(Pipeline.Workspace)/\${{ parameters.artifactName }}/frontend.zip\"
                  az webapp deployment source config-zip \\
                    --resource-group rg-demo-\${{ parameters.environmentName }} \\
                    --name \${{ parameters.webAppName }} \\
                    --src \"\$ARTIFACT_PATH\""

# ─── SECTION 3a: Conditional keys — pure mapping context ─────────────────────

test_case "S3-01 parseConditionalElseIfChain" \
"pool:
  \${{ if startsWith(variables['Build.SourceBranch'], 'refs/heads/release/') }}:
    vmImage: windows-latest
  \${{ elseif eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    vmImage: ubuntu-latest
  \${{ else }}:
    vmImage: ubuntu-22.04"

test_case "S3-02 parseEachLoopOverList" \
"stages:
  \${{ each env in parameters.environments }}:
    - stage: Deploy_\${{ env }}
      displayName: Deploy to \${{ env }}
      jobs:
        - template: templates/deploy.yml
          parameters:
            environment: \${{ env }}"

test_case "S3-03 parseInsertDirective" \
"jobs:
  - job: Build
    variables:
      \${{ insert }}:
      BUILD_NUMBER: \$(Build.BuildId)
    steps:
      - script: npm build"

test_case "S3-04 parseConditionalInTemplateParameters" \
"jobs:
  - template: templates/deploy.yml
    parameters:
      artifactName: frontend-dist
      \${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
        environmentName: production
        webAppName: demo-frontend-prod
      \${{ else }}:
        environmentName: staging
        webAppName: demo-frontend-stage"

# ─── SECTION 3b: Conditional keys mixed with sequence items ──────────────────
# All three tools fail these — YAML cannot be both a sequence and a mapping
# at the same indentation level. Expected failures.

test_case "S3-05 parseConditionalIfBlock (mixed seq+mapping)" \
"variables:
  - name: BASE_IMAGE
    value: ubuntu-latest
  \${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production" \
"." "false"

test_case "S3-06 parseConditionalIfElseBlock (mixed seq+mapping)" \
"variables:
  - name: SHARED_VAR
    value: common
  \${{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production
  \${{ else }}:
    - name: DEPLOY_ENV
      value: staging" \
"." "false"

test_case "S3-07 parseConditionalVariableBlock (mixed seq+mapping)" \
"variables:
  - name: SERVICE_URL
    value: https://api.example.com
  \${{ if eq(variables['ENVIRONMENT'], 'production') }}:
    - name: LOG_LEVEL
      value: warn
  \${{ else }}:
    - name: REPLICAS
      value: 1" \
"." "false"

# ─── SECTION 4: Mutations ─────────────────────────────────────────────────────

test_case "S4-01 changeVariableValue" \
"variables:
  - name: ENVIRONMENT
    value: dev
  - name: NODE_ENV
    value: production" \
'(.variables[] | select(.name == "NODE_ENV") | .value) = "staging"'

test_case "S4-02 renameVariableWithNamedSequenceEntry" \
"variables:
  - name: ENVIRONMENT
    value: dev
  - name: NODE_ENV
    value: production" \
'(.variables[] | select(.name == "ENVIRONMENT") | .name) = "AZ_ENVIRONMENT"'

test_case "S4-03 deleteVariableByName" \
"variables:
  - name: ENVIRONMENT
    value: dev
  - name: nodeVersion
    value: 20.x
  - name: vmImage
    value: ubuntu-latest" \
'del(.variables[] | select(.name == "nodeVersion"))'

test_case "S4-04 changeParameterDefaultValue" \
"parameters:
  - name: vmImage
    type: string
  - name: ENVIRONMENT
    type: string
    default: staging" \
'(.parameters[] | select(.name == "ENVIRONMENT") | .default) = "production"'

test_case "S4-05 changeVmImageAcrossAllPools" \
"stages:
  - stage: Build
    jobs:
      - job: BuildApp
        pool:
          vmImage: ubuntu-latest
  - stage: Test
    jobs:
      - job: TestApp
        pool:
          vmImage: ubuntu-latest" \
'(.. | select(has("vmImage")) | .vmImage) = "ubuntu-24.04"'

# ─── Output ───────────────────────────────────────────────────────────────────

echo ""
YQ_VERSION=$(yq --version 2>&1 | grep -oP '[\d]+\.[\d]+\.[\d]+' | head -1)
echo "=== yq v${YQ_VERSION} — Azure DevOps Pipeline Test Results ==="
echo ""

current_section=""
for r in "${RESULTS[@]}"; do
  IFS='|' read -r status name detail <<< "$r"
  id="${name%% *}"

  case "$id" in
    S1-01) echo "--- Section 1: Standard pipeline YAML ---" ;;
    S2-01) echo ""; echo "--- Section 2: \${{ }} in value positions ---" ;;
    S3-01) echo ""; echo "--- Section 3a: Conditional keys — pure mapping context ---" ;;
    S3-05) echo ""; echo "--- Section 3b: Conditional keys mixed with sequence items (expected failures) ---" ;;
    S4-01) echo ""; echo "--- Section 4: Mutations ---" ;;
  esac

  shortname="${name#"$id "}"
  if [ "$status" = "PASS" ]; then
    echo "  ✅ $shortname"
    if [ -n "$detail" ]; then echo "       → $detail"; fi
  else
    echo "  ❌ $shortname"
    if [ -n "$detail" ]; then echo "       → $detail"; fi
  fi
done

echo ""
printf '%0.s─' {1..65}; echo ""
echo "Total: $PASS PASSED, $FAIL FAILED  ($((PASS+FAIL)) tests)"
echo ""
echo "Notes:"
echo "  Section 3b failures are expected — mixing sequence items (- name:)"
echo "  and mapping keys (\${{ if }}:) at the same indentation level is a"
echo "  structural YAML ambiguity that no tool can resolve."
echo ""
echo "  yq uses github.com/goccy/go-yaml (YAML 1.2) — NOT gopkg.in/yaml.v3."
echo "  Block-context plain scalars allow { and }, so \${{ expr }} parses"
echo "  natively without pre-processing."
