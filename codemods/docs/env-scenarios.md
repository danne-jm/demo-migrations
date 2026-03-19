# Codemod Scenarios: \`.env\` manipulation

This document outlines several codemod use cases testing the capabilities of tools like OpenRewrite or Comby on \`.env\`, \`.env.example\`, and other environment variable files across a monorepo setup.

## Scenario 1: Global Manipulations (Targets ALL \`.env*\` files)
This scenario ensures the codemod engine can parse and modify simple key-value pairs separated by \`=\`, while preserving or interacting with shell-style comments (\`#\`).

### Expected Transformations:
1. **Add new keys:** 
   - Add \`COMPANY_DOMAIN="acme.com"\` to the bottom of every file.
2. **Change existing values:** 
   - Find \`LOG_LEVEL=*\` and change it to \`LOG_LEVEL="debug"\` globally.
3. **Remove keys:** 
   - Delete any line defining \`DEPRECATED_FEATURE_FLAG\`.
4. **Commenting and Uncommenting:** 
   - Find the line \`DEBUG_MODE=true\` and comment it out so it becomes \`# DEBUG_MODE=true\`.
   - Find a commented-out feature flag like \`# NEW_UI=false\` and uncomment it, changing its value to \`true\` (\`NEW_UI=true\`).

## Scenario 2: Monorepo Target Manipulations (Targets strictly \`frontend/.env*\` or \`backend/.env*\`)
Testing the ability to scope variable modifications to the specific needs of a frontend tool (Vite) vs a Node.js backend.

### Expected Transformations:
1. **Frontend Vite Standardization:** 
   - Target only the \`frontend/\` directory.
   - Vite requires environment variables to be prefixed with \`VITE_\`. Find any key like \`API_URL\` or \`TIMEOUT\` that does *not* start with \`VITE_\` and rename the key to include the prefix (e.g., \`VITE_API_URL\`).
2. **Backend Payload Injection:** 
   - Target only the \`backend/\` directory.
   - Add a required configuration block specifically for the backend:
     \`\`\`env
     # Redis Cache Configuration
     REDIS_HOST="127.0.0.1"
     REDIS_PORT=6379
     \`\`\`

## Scenario 3: Complex Usecase - Grouping and Alphabetical Sorting
Testing multi-line AST awareness, formatting constraints, and regular expression pattern matching across lines.

### Expected Transformations:
1. **Semantic Grouping:** Scan the file for any variables starting with \`AWS_\`, \`AZURE_\`, or \`GCP_\`.
2. **Extraction and Relocation:** Extract all of these scattered cloud variables from their current locations in the file.
3. **Block Creation:** Create a new section at the very end of the file with a comment header: \`# Cloud Provider Settings\`.
4. **Alphabetical Sorting:** Insert the extracted variables under this new comment header, strictly sorted in alphabetical order based on their keys.

## Scenario 4: Complex Usecase - Cross-file Synchronization (\`.env\` to \`.env.example\`)
Testing cross-file correlation. It's a common problem that developers add keys to their local \`.env\` but forget to commit them to \`.env.example\`.

### Expected Transformations:
1. **File Correlation:** The codemod engine looks at pairs of files: \`/frontend/.env\` vs \`/frontend/.env.example\`, and \`/backend/.env\` vs \`/backend/.env.example\`.
2. **Diffing:** It collects all keys from the local \`.env\` file.
3. **Injection:** It scans the \`.env.example\` file for those keys. If a key is missing in \`.env.example\`, it appends it to the file but sanitizes the value to be generic. 
   - *Example:* If \`.env\` has \`SECRET_API_KEY="sk-12345999"\`, it adds \`SECRET_API_KEY="your_value_here"\` to \`.env.example\`.
4. **Format Preservation:** The codemod must not mess up the spacing or existing comments of the \`.env.example\` file while doing this.
