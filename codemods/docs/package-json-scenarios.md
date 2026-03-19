# Codemod Scenarios: \`package.json\` manipulation

This document outlines several codemod use cases testing the capabilities of tools like OpenRewrite or Comby on JSON/JSONC structures across a monorepo setup.

## Scenario 1: Global Manipulations (Targets ALL \`package.json\` files)
This scenario ensures the codemod engine can traverse and apply changes to all \`package.json\` files, including the root workspace and all children.

### Expected Transformations:
1. **Add new keys:** 
   - Add \`"author": "Acme Corp"\` to the top level.
   - Add a nested object: \`"repository": { "type": "git", "url": "https://github.com/acme/demo-migrations.git" }\`
2. **Remove keys:** Remove the \`"private": true\` key entirely.
3. **Alphabetical Sorting:** Recursively sort all keys inside the \`"scripts"\` object alphabetically.
4. **Commenting Strings:** Comment out the \`"version"\` key (if the codemod engine supports JSONC formatting like \`// "version": "0.1.0"\`). Alternatively, prefix the key with `_comment_` (e.g. `"_comment_version": "0.1.0"`).

## Scenario 2: Monorepo Target Manipulations (Targets ONLY nested \`frontend/package.json\` & \`backend/package.json\`)
This scenario tests the codemod's ability to scope its execution to specific project sub-directories (or by identifying files lacking a \`"workspaces"\` array).

### Expected Transformations:
1. **Change values:** Bump the \`"version"\` key from \`"0.1.0"\` to \`"1.0.0-beta"\`.
2. **Nested Property Edits:** 
   - Inside \`"scripts"\`, add a new key \`"start:prod": "node dist/index.js"\`.
   - Change the \`"lint"\` script value to use a new global linter command: \`"npm run lint --workspace root"\`.
3. **Remove keys in nested blocks:** Remove \`"eslint"\` from the \`"devDependencies"\` block.
4. **Alphabetical Sorting:** Ensure \`"dependencies"\` and \`"devDependencies"\` keys are strictly alphabetically sorted.
5. **Structural Standardization:** Clone the \`{"engines": {"node": ">=20.10.0"}}\` property from the root \`package.json\` into these children \`package.json\` files. 

## Scenario 3: Complex Usecase - Dependency Hoisting & Synchronization
Testing advanced traversal, cross-file context, and dependency management.

### The Objective:
In a unified Monorepo, tools often want to hoist shared dependencies up to the root to avoid version mismatches and save install time. 

### Expected Transformations:
1. **Cross-file lookup:** The codemod must scan all child \`(frontend|backend)/package.json\` files and identify the \`"typescript"\` and \`"eslint"\` dependencies inside \`"devDependencies"\`.
2. **Action in Children:** Remove these dependencies from the child \`package.json\` files.
3. **Action in Root:** Insert \`"typescript"\` and \`"eslint"\` into the root \`package.json\`'s \`"devDependencies"\`, taking the highest semver version found across the children.
4. **Sort Validation:** Re-sort \`"devDependencies"\` in the root file alphabetically after insertion to keep formatting clean.

## Scenario 4: Complex Usecase - Bulk Object Extraction
Testing deep object manipulation and restructuring.

### Expected Transformations:
1. Take all nested scripts that begin with \`dev:\` (e.g. \`dev:frontend\`, \`dev:backend\` in the root).
2. Extract them from the \`"scripts"\` object.
3. Move them into a newly created custom JSON block called \`"developmentConfig"\` at the root object level, grouped by the package name:
   \`\`\`json
   "developmentConfig": {
     "frontend": "npm --workspace frontend run dev",
     "backend": "npm --workspace backend run dev"
   }
   \`\`\`
   
## How to execute tests
You can define these recipes inside `codemods/openrewrite/package-json-recipes.yml` or your respective `comby` configuration tools.