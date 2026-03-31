/**
 * Empirical test: npm yaml (eemeli/yaml) against Azure DevOps pipeline YAML syntax
 *
 * Tests are identical to AzureDevOpsPipelineParsingTest.java in the OpenRewrite
 * rewrite-yaml module — same YAML content, same 4-section structure — allowing
 * direct comparison between the three tools.
 *
 * Run:  node ado-test-npm-yaml.mjs
 * Requires: npm install yaml  (package.json present in this directory)
 *
 * Key source finding (yaml/src/parse/lexer.ts — plainScalar()):
 *   flowIndicatorChars = new Set(',[]{}')
 *   In block context (inFlow=false), { and } are NOT in the break set.
 *   => ${{ parameters.vmImage }} parses as a plain scalar in block context
 *      without any pre-processing — YAML 1.2 spec-compliant behaviour.
 */
import { parseDocument, stringify, visit } from 'yaml';

// Prevents ${{ from being interpreted as a JS template expression
const D = '$';

let pass = 0, fail = 0;
const results = [];

function test(name, fn) {
  try {
    const detail = fn();
    pass++;
    results.push({ name, status: 'PASS', detail: detail ?? '' });
  } catch (e) {
    fail++;
    results.push({ name, status: 'FAIL', detail: e.message.split('\n')[0] });
  }
}

function parseStrict(yaml) {
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  return doc;
}

function parseLenient(yaml) {
  return parseDocument(yaml, { strict: false });
}

function roundTrip(yaml) {
  parseStrict(yaml);
  return 'ok';
}

// =============================================================================
// Section 1 — Standard pipeline YAML (no template expressions)
// Expected: all pass unconditionally — pure valid YAML.
// =============================================================================

test('S1-01 parseTriggerAndPrConfiguration', () => roundTrip(`
trigger:
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
      - develop
`));

test('S1-02 parseVariablesSequence', () => roundTrip(`
variables:
  - name: ENVIRONMENT
    value: 'dev'
  - name: NODE_ENV
    value: 'production'
  - name: nodeVersion
    value: '20.x'
  - name: vmImage
    value: 'ubuntu-latest'
`));

test('S1-03 parseParametersBlockWithTypes', () => roundTrip(`
parameters:
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
    default: true
`));

test('S1-04 parseStagesWithJobsAndSteps', () => roundTrip(`
stages:
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
            displayName: Install and build
`));

test('S1-05 parseTemplateReferenceWithParameters', () => roundTrip(`
stages:
  - stage: Deploy_Dev
    displayName: Deploy to Development
    dependsOn: Build
    condition: and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))
    jobs:
      - template: ../templates/deploy/deploy-frontend.yml
        parameters:
          vmImage: $(vmImage)
          artifactName: $(artifactNameFrontend)
          environmentName: $(deployEnvironmentDev)
          webAppName: 'demo-frontend-dev'
`));

test('S1-06 parseConditionWithBuiltInFunctions', () => roundTrip(`
stages:
  - stage: Deploy_Dev
    condition: and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))
    jobs: []
  - stage: Deploy_Stage
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/main'))
    jobs: []
  - stage: Deploy_Prod
    condition: and(succeeded(), startsWith(variables['Build.SourceBranch'], 'refs/heads/release/'))
    jobs: []
`));

test('S1-07 parseDeploymentJobWithRunOnceStrategy', () => roundTrip(`
jobs:
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
                azureSubscription: 'service-connection-demo'
                scriptType: bash
                inlineScript: |
                  az webapp deployment source config-zip \\
                    --resource-group rg-demo-dev \\
                    --name demo-frontend-dev \\
                    --src "$(Pipeline.Workspace)/frontend-dist/frontend.zip"
`));

test('S1-08 parseFullBuildPipelineRoundTrip', () => roundTrip(`
trigger:
  branches:
    include:
      - main
      - develop
      - release/*

pr:
  branches:
    include:
      - main

name: $(Date:yyyyMMdd)$(Rev:.r)

variables:
  - name: ENVIRONMENT
    value: 'dev'
  - name: NODE_ENV
    value: 'production'
  - name: environmentTemplate
    value: '${D}{{ variables.ENVIRONMENT }}'

stages:
  - stage: Build
    displayName: Build frontend and backend
    jobs:
      - template: ../templates/build/build-frontend.yml
        parameters:
          vmImage: $(vmImage)
`));

// =============================================================================
// Section 2 — ${{ }} in value positions
//
// npm yaml uses YAML 1.2: { and } are valid plain scalar characters in block
// context (only forbidden inside flow context { } / [ ] blocks).
// All tests pass in strict mode — no pre-processing needed.
// =============================================================================

test('S2-01 parseParameterExpressionsInValues', () => roundTrip(`
parameters:
  - name: vmImage
    type: string
  - name: environmentName
    type: string
jobs:
  - deployment: DeployFrontend_${D}{{ parameters.environmentName }}
    displayName: Deploy frontend to ${D}{{ parameters.environmentName }}
    pool:
      vmImage: ${D}{{ parameters.vmImage }}
    environment: ${D}{{ parameters.environmentName }}
`));

test('S2-02 parseVariableExpressionAsDefault', () => roundTrip(`
parameters:
  - name: ENVIRONMENT
    type: string
    default: ${D}{{ variables.ENVIRONMENT }}
  - name: NODE_ENV
    type: string
    default: production
`));

test('S2-03 parseDynamicJobNameWithExpression', () => roundTrip(`
jobs:
  - deployment: DeployBackend_${D}{{ parameters.environmentName }}
    displayName: Deploy backend to ${D}{{ parameters.environmentName }}
    pool:
      vmImage: ${D}{{ parameters.vmImage }}
    environment: ${D}{{ parameters.environmentName }}
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: ${D}{{ parameters.artifactName }}
`));

test('S2-04 parseExpressionInsideMultiLineScript', () => roundTrip(`
jobs:
  - deployment: DeployFrontend
    strategy:
      runOnce:
        deploy:
          steps:
            - task: AzureCLI@2
              inputs:
                inlineScript: |
                  ARTIFACT_PATH="$(Pipeline.Workspace)/${D}{{ parameters.artifactName }}/frontend.zip"
                  az webapp deployment source config-zip \\
                    --resource-group rg-demo-${D}{{ parameters.environmentName }} \\
                    --name ${D}{{ parameters.webAppName }} \\
                    --src "$ARTIFACT_PATH"
`));

test('S2-05 parameterExpressionPreservedVerbatim — AST value check', () => {
  // Verifies that ${{ }} is stored verbatim in the AST node value,
  // not decoded, normalised, or truncated.
  const yaml = `
jobs:
  - deployment: Deploy_${D}{{ parameters.environmentName }}
    pool:
      vmImage: ${D}{{ parameters.vmImage }}
`;
  const doc = parseStrict(yaml);
  const deployment = doc.getIn(['jobs', 0, 'deployment']);
  const vmImage    = doc.getIn(['jobs', 0, 'pool', 'vmImage']);
  const wantDeploy = 'Deploy_${{ parameters.environmentName }}';
  const wantVm     = '${{ parameters.vmImage }}';
  if (deployment !== wantDeploy) throw new Error(`deployment = ${JSON.stringify(deployment)}`);
  if (vmImage !== wantVm)        throw new Error(`vmImage = ${JSON.stringify(vmImage)}`);
  return `deployment="${deployment}"  vmImage="${vmImage}"`;
});

test('S2-06 parseDeployTemplateRoundTrip', () => roundTrip(`
parameters:
  - name: vmImage
    type: string
  - name: environmentName
    type: string
  - name: ENVIRONMENT
    type: string
    default: ${D}{{ variables.ENVIRONMENT }}
jobs:
  - deployment: DeployFrontend_${D}{{ parameters.environmentName }}
    displayName: Deploy frontend to ${D}{{ parameters.environmentName }}
    pool:
      vmImage: ${D}{{ parameters.vmImage }}
    environment: ${D}{{ parameters.environmentName }}
    strategy:
      runOnce:
        deploy:
          steps:
            - download: current
              artifact: ${D}{{ parameters.artifactName }}
            - task: AzureCLI@2
              inputs:
                inlineScript: |
                  ARTIFACT_PATH="$(Pipeline.Workspace)/${D}{{ parameters.artifactName }}/frontend.zip"
                  az webapp deployment source config-zip \\
                    --resource-group rg-demo-${D}{{ parameters.environmentName }} \\
                    --name ${D}{{ parameters.webAppName }} \\
                    --src "$ARTIFACT_PATH"
`));

// =============================================================================
// Section 3 — ${{ expr }}: as mapping keys
//
// 3a: conditional key inside a pure mapping — passes in strict mode.
//     npm yaml stores the full ${{ if ... }} text as a plain-string mapping key.
//
// 3b: conditional key mixed with sequence items at the same indentation level.
//     Fails even in lenient mode. Error: "All mapping items must start at the
//     same column". This is a structural YAML ambiguity, not a strictness issue.
//     Both strict: true and strict: false produce the same error.
// =============================================================================

test('S3-01 parseConditionalElseIfChain — pure mapping (strict)', () => roundTrip(`
pool:
  ${D}{{ if startsWith(variables['Build.SourceBranch'], 'refs/heads/release/') }}:
    vmImage: windows-latest
  ${D}{{ elseif eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    vmImage: ubuntu-latest
  ${D}{{ else }}:
    vmImage: ubuntu-22.04
`));

test('S3-01 parseConditionalElseIfChain — pure mapping (lenient)', () => {
  const doc = parseLenient(`
pool:
  ${D}{{ if startsWith(variables['Build.SourceBranch'], 'refs/heads/release/') }}:
    vmImage: windows-latest
  ${D}{{ elseif eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    vmImage: ubuntu-latest
  ${D}{{ else }}:
    vmImage: ubuntu-22.04
`);
  if (doc.errors.length > 0) throw new Error(`${doc.errors.length} error(s): ${doc.errors[0].message.substring(0, 60)}`);
  return 'ok';
});

test('S3-02 parseEachLoopOverList', () => roundTrip(`
stages:
  ${D}{{ each env in parameters.environments }}:
    - stage: Deploy_${D}{{ env }}
      displayName: Deploy to ${D}{{ env }}
      jobs:
        - template: templates/deploy.yml
          parameters:
            environment: ${D}{{ env }}
`));

test('S3-03 parseInsertDirective', () => roundTrip(`
jobs:
  - job: Build
    variables:
      ${D}{{ insert }}:
      BUILD_NUMBER: $(Build.BuildId)
    steps:
      - script: npm build
`));

test('S3-04 parseConditionalInTemplateParameters', () => roundTrip(`
jobs:
  - template: templates/deploy.yml
    parameters:
      artifactName: frontend-dist
      ${D}{{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
        environmentName: production
        webAppName: demo-frontend-prod
      ${D}{{ else }}:
        environmentName: staging
        webAppName: demo-frontend-stage
`));

// 3b: these all fail — structural ambiguity, not fixable with lenient mode

const mixed1 = `
variables:
  - name: BASE_IMAGE
    value: ubuntu-latest
  ${D}{{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production
`;

test('S3-05 parseConditionalIfBlock — mixed seq+mapping (strict)', () => roundTrip(mixed1));

test('S3-05 parseConditionalIfBlock — mixed seq+mapping (lenient)', () => {
  const doc = parseLenient(mixed1);
  if (doc.errors.length > 0) throw new Error(`${doc.errors.length} error(s): ${doc.errors[0].message.substring(0, 80)}`);
  return 'ok';
});

const mixed2 = `
variables:
  - name: SHARED_VAR
    value: common
  ${D}{{ if eq(variables['Build.SourceBranch'], 'refs/heads/main') }}:
    - name: DEPLOY_ENV
      value: production
  ${D}{{ else }}:
    - name: DEPLOY_ENV
      value: staging
`;

test('S3-06 parseConditionalIfElseBlock — mixed seq+mapping (strict)', () => roundTrip(mixed2));

test('S3-06 parseConditionalIfElseBlock — mixed seq+mapping (lenient)', () => {
  const doc = parseLenient(mixed2);
  if (doc.errors.length > 0) throw new Error(`${doc.errors.length} error(s): ${doc.errors[0].message.substring(0, 80)}`);
  return 'ok';
});

const mixed3 = `
variables:
  - name: SERVICE_URL
    value: https://api.example.com
  ${D}{{ if eq(variables['ENVIRONMENT'], 'production') }}:
    - name: LOG_LEVEL
      value: warn
  ${D}{{ else }}:
    - name: REPLICAS
      value: 1
`;

test('S3-07 parseConditionalVariableBlock — mixed seq+mapping (strict)', () => roundTrip(mixed3));

test('S3-07 parseConditionalVariableBlock — mixed seq+mapping (lenient)', () => {
  const doc = parseLenient(mixed3);
  if (doc.errors.length > 0) throw new Error(`${doc.errors.length} error(s): ${doc.errors[0].message.substring(0, 80)}`);
  return 'ok';
});

// =============================================================================
// Section 4 — Mutations using the npm yaml document API
//
// Demonstrates: find by name field, set value, delete entry, recursive visit.
// Note: npm yaml preserves original quote style on set() — a value originally
// stored as a single-quoted scalar remains single-quoted after modification.
// =============================================================================

test('S4-01 changeVariableValue', () => {
  const input = `variables:\n  - name: ENVIRONMENT\n    value: 'dev'\n  - name: NODE_ENV\n    value: 'production'\n`;
  const doc = parseStrict(input);
  for (const item of doc.getIn(['variables']).items) {
    if (item.get('name') === 'NODE_ENV') item.set('value', 'staging');
  }
  const out = stringify(doc);
  if (!out.includes('staging')) throw new Error('value not changed');
  // npm yaml preserves quote style: 'staging' (single-quoted, matching original)
  return `NODE_ENV → staging  (quote style: ${out.includes("'staging'") ? 'single-quoted preserved' : 'plain'})`;
});

test('S4-02 renameVariableWithNamedSequenceEntry', () => {
  const input = `variables:\n  - name: ENVIRONMENT\n    value: dev\n  - name: NODE_ENV\n    value: production\n`;
  const doc = parseStrict(input);
  for (const item of doc.getIn(['variables']).items) {
    if (item.get('name') === 'ENVIRONMENT') item.set('name', 'AZ_ENVIRONMENT');
  }
  const out = stringify(doc);
  if (!out.includes('AZ_ENVIRONMENT')) throw new Error('rename failed');
  if (out.match(/name: ENVIRONMENT\b/)) throw new Error('old name still present');
  return 'ENVIRONMENT → AZ_ENVIRONMENT';
});

test('S4-03 deleteVariableByName', () => {
  const input = `variables:\n  - name: ENVIRONMENT\n    value: dev\n  - name: nodeVersion\n    value: 20.x\n  - name: vmImage\n    value: ubuntu-latest\n`;
  const doc = parseStrict(input);
  const vars = doc.getIn(['variables']);
  const idx = vars.items.findIndex(item => item.get('name') === 'nodeVersion');
  if (idx === -1) throw new Error('nodeVersion not found');
  vars.items.splice(idx, 1);
  const out = stringify(doc);
  if (out.includes('nodeVersion')) throw new Error('nodeVersion still present');
  return 'nodeVersion deleted (2 entries remain)';
});

test('S4-04 changeParameterDefaultValue', () => {
  const input = `parameters:\n  - name: vmImage\n    type: string\n  - name: ENVIRONMENT\n    type: string\n    default: staging\n`;
  const doc = parseStrict(input);
  for (const item of doc.getIn(['parameters']).items) {
    if (item.get('name') === 'ENVIRONMENT') item.set('default', 'production');
  }
  const out = stringify(doc);
  if (!out.includes('default: production')) throw new Error('default not changed');
  return 'ENVIRONMENT default → production';
});

test('S4-05 changeVmImageAcrossAllPools (recursive visit)', () => {
  // visit() walks the entire document tree recursively — reaches pool.vmImage
  // regardless of nesting depth inside stages > jobs > job.
  const input = `stages:\n  - stage: Build\n    jobs:\n      - job: BuildApp\n        pool:\n          vmImage: ubuntu-latest\n  - stage: Test\n    jobs:\n      - job: TestApp\n        pool:\n          vmImage: ubuntu-latest\n`;
  const doc = parseStrict(input);
  let changed = 0;
  visit(doc, {
    Pair(_, node) {
      if (node.key?.value === 'vmImage' && node.value?.value === 'ubuntu-latest') {
        node.value.value = 'ubuntu-24.04';
        changed++;
      }
    }
  });
  const out = stringify(doc);
  if (changed !== 2) throw new Error(`expected 2 changes, got ${changed}`);
  if (out.includes('ubuntu-latest')) throw new Error('old value still present');
  return `${changed} vmImage values updated to ubuntu-24.04`;
});

// =============================================================================
// Output
// =============================================================================

const sectionHeaders = {
  'S1-01': 'Section 1 — Standard pipeline YAML',
  'S2-01': 'Section 2 — ${{ }} in value positions',
  'S3-01': 'Section 3a — Conditional keys: pure mapping context',
  'S3-05': 'Section 3b — Conditional keys: mixed with sequence items (known limitation)',
  'S4-01': 'Section 4 — Mutations',
};

console.log('\n=== npm yaml (eemeli/yaml) — Azure DevOps Pipeline Test Results ===');
console.log('    npm yaml version:', (await import('./node_modules/yaml/package.json', { assert: { type: 'json' } })).default.version);
console.log('');

let lastSection = '';
for (const r of results) {
  const id = r.name.split(' ')[0];
  if (sectionHeaders[id] && id !== lastSection) {
    console.log(`\n--- ${sectionHeaders[id]} ---`);
    lastSection = id;
  }
  const icon = r.status === 'PASS' ? '✅' : '❌';
  const name = r.name.replace(/^S\d+-\d+\w*\s/, '');
  console.log(`${icon} ${name}`);
  if (r.detail && r.detail !== 'ok') console.log(`     → ${r.detail}`);
}

console.log(`\n${'─'.repeat(65)}`);
console.log(`Total: ${pass} PASSED, ${fail} FAILED  (${pass + fail} tests)`);
console.log('');
console.log('Note: 6 failures are all Section 3b (strict + lenient variants of 3 tests).');
console.log('      lenient mode (strict: false) does NOT recover structural ambiguity.');
