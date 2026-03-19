# Codemod Scenarios: Azure Pipeline YAML Manipulation

This document outlines several codemod use cases testing the capabilities of tools like OpenRewrite or Comby on Azure DevOps Pipeline YAML files. These scenarios mirror real-world DevOps migrations, testing variable modification, block manipulation, and targeting across different files in the `.azure/` folder structure.

## Overview of Targets
The workspace pipeline structure:
- `.azure/pipelines/fullstack-ci-cd.yml` (Main pipeline)
- `.azure/templates/deploy/deploy-backend.yml` (Backend deploy template)
- `.azure/templates/deploy/deploy-frontend.yml` (Frontend deploy template)

---

## Scenario 1: Variable Manipulations (Targets ALL YAML files)
This scenario ensures the codemod engine can intelligently traverse and apply changes to variable blocks globally, handling both mapping scalars and sequence elements.

### Expected Transformations:
1. **Add new variables:** 
   - Add `AZURE_SUBSCRIPTION: "sp-main-production"` to every file's `variables` block globally.
2. **Rename variables:** 
   - Rename any occurrence of the variable `ENVIRONMENT` to `AZ_ENV` globally, both in the definition and in usage (`${{ variables.ENVIRONMENT }}` to `${{ variables.AZ_ENV }}` or `$(ENVIRONMENT)` to `$(AZ_ENV)`).
3. **Remove variables:** 
   - Completely delete the `NODE_ENV` variable definition from any place where it is defined.

---

## Scenario 2: Inline Step Modifications (Targets strictly the Main Pipeline)
Testing the ability to scope modifications strictly to a single pipeline file (e.g., `fullstack-ci-cd.yml`) and alter properties deeply within strings without overwriting the entire script block.

### Expected Transformations:
1. **Targeting:** Run *only* on `.azure/pipelines/fullstack-ci-cd.yml`.
2. **Modify Single Lines in Multi-line Scripts:** 
   - Inside a `script:` block that currently runs an `npm install` and `npm build`, inject an additional line exactly between those two commands:
     - `npm audit fix --audit-level=high`
   - *Constraint:* Do not replace the existing script string completely; utilize regex or string manipulation functions to patch the interior.
3. **Modify Tasks:**
   - Change instances of `task: NodeTool@0` to `task: UseNode@1` and simultaneously update its nested input `versionSpec: '16.x'` to `version: '20.x'`.

---

## Scenario 3: Block Manipulation (Targets Specific Deploy Templates)
Testing the codemod's structural awareness: injecting, replacing, and stripping whole nested YAML nodes in specific module templates.

### Expected Transformations:
1. **Targeting:** Run *only* on `.azure/templates/deploy/deploy-backend.yml`.
2. **Add entire YAML Block (Security Scan Step):**
   - Inject a new security scanning step *before* any step containing the word "Deploy":
     ```yaml
     - task: AdvancedSecurity-Codeql-Init@1
       inputs:
         languages: 'javascript, typescript'
     ```
3. **Remove YAML Block:** 
   - Find any step that references a deprecated task (e.g., `task: CopyFiles@2`) and delete the entire block, including its `inputs:` and any conditional `condition:` or `displayName:` sub-properties automatically.

---

## Scenario 4: Complex Usecase - Dependency & Stage Linking
Testing the ability to restructure complex sequence relations organically inside a multi-stage pipeline, requiring AST-aware modifications over plain text diffing.

### Expected Transformations:
1. **Targeting:** Run *only* on `.azure/pipelines/fullstack-ci-cd.yml`.
2. **Modify `dependsOn` arrays:** 
   - Locate the `stages:` list.
   - Find the stage named `DeployToProduction`.
   - Modify its `dependsOn:` array. If it is a string (e.g., `dependsOn: Build`), convert it to an array and add a new dependency:
     ```yaml
     dependsOn: 
       - Build
       - SecurityAudit
       - E2ETesting
     ```
3. **Add Global Resource Repository:** 
   - Inject a new `resources:` block at the top of the file mapping to an external repository:
     ```yaml
     resources:
       repositories:
         - repository: templates
           type: git
           name: DevOps/Pipelines
     ```
   - *Constraint:* Ensure this injects correctly below `trigger:` but above `variables:`.