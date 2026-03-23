#!/bin/bash
# post-upgrade.sh
# Run this script using Renovate's postUpgradeTasks hooks

set -e

# This script assumes the following environment variables are passed from Renovate:
# RENOVATE_UPDATED_PACKAGE: Name of the package that was updated
# RENOVATE_OLD_VERSION: The previously installed version
# RENOVATE_NEW_VERSION: The newly updated version
# WORKSPACE_DIR: The root of the repository

echo "Running post-upgrade tasks for $RENOVATE_UPDATED_PACKAGE from $RENOVATE_OLD_VERSION to $RENOVATE_NEW_VERSION"

# Provide safer git remote parsing for tools like OpenRewrite
git remote set-url origin https://github.com/danne-jm/demo-migrations.git || true

# We assume standard node_modules structure, or local custom-packages structure
# Let's search for migrations directory in the package that was just bumped
if [ -d "node_modules/$RENOVATE_UPDATED_PACKAGE/migrations" ]; then
    MIGRATIONS_DIR="node_modules/$RENOVATE_UPDATED_PACKAGE/migrations"
elif [ -d "custom-packages/$RENOVATE_UPDATED_PACKAGE/migrations" ]; then
    # Handle if it was internally linked and bumped
    MIGRATIONS_DIR="custom-packages/$RENOVATE_UPDATED_PACKAGE/migrations"
else
    echo "No migrations folder found for $RENOVATE_UPDATED_PACKAGE. Skipping."
    exit 0
fi

echo "Found migrations folder: $MIGRATIONS_DIR"

MANIFEST_FILE="$MIGRATIONS_DIR/manifest.json"

if [ ! -f "$MANIFEST_FILE" ]; then
    echo "Manifest file not found at $MANIFEST_FILE. Skipping."
    exit 0
fi

# Use node to parse the version matching
# We need to find migrations specifically between current version and bumped version
MIGRATIONS_TO_RUN=$(node -e "
    try {
        const manifest = require('./$MANIFEST_FILE');
        const oldVersion = process.env.RENOVATE_OLD_VERSION ? process.env.RENOVATE_OLD_VERSION.replace(/^[^\d]/, '') : '0.0.0';
        const newVersion = process.env.RENOVATE_NEW_VERSION ? process.env.RENOVATE_NEW_VERSION.replace(/^[^\d]/, '') : '99.99.99';
        
        // Basic semver comparison logic 
        const cmp = (a, b) => {
            const pa = a.split('.').map(Number);
            const pb = b.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if ((pa[i] || 0) > (pb[i] || 0)) return 1;
                if ((pa[i] || 0) < (pb[i] || 0)) return -1;
            }
            return 0;
        };
        
        const filesToRun = [];
        for (const migration of manifest) {
            // Include migration if its version is > oldVersion AND <= newVersion
            if (cmp(migration.version, oldVersion) > 0 && cmp(migration.version, newVersion) <= 0) {
                if (migration.migrationFiles) {
                    filesToRun.push(...migration.migrationFiles);
                }
            }
        }
        
        console.log(filesToRun.join(' '));
    } catch (e) {
        console.error('Error parsing manifest:', e.message);
        process.exit(1);
    }
")

if [ -z "$MIGRATIONS_TO_RUN" ]; then
    echo "No applicable migration files configured between version $RENOVATE_OLD_VERSION and $RENOVATE_NEW_VERSION."
    exit 0
fi

echo "Executing migrations: $MIGRATIONS_TO_RUN"

# Build LST for the current repository using Moderne CLI
echo "Building ASTs for current repository..."
cd "$WORKSPACE_DIR"
mod build .

for MIGRATION_FILE in $MIGRATIONS_TO_RUN; do
    echo "Processing migration file: $MIGRATION_FILE"
    
    # Absolute path to the migration config file (YML)
    abs_migration_path="$WORKSPACE_DIR/$MIGRATIONS_DIR/$MIGRATION_FILE"
    
    if [ ! -f "$abs_migration_path" ]; then
        echo "Migration file $abs_migration_path not found! Skipping..."
        continue
    fi

    # Extract the recipe name from the YAML file
    # Assumes the format `name: com.example.RecipeName` on its own line
    RECIPE_NAME=$(grep '^name:' "$abs_migration_path" | head -n 1 | awk '{print $2}' | tr -d '"' | tr -d "'")

    if [ -z "$RECIPE_NAME" ]; then
        echo "Could not extract recipe 'name:' from $abs_migration_path. Skipping..."
        continue
    fi

    # Copy the migration YAML to the root directory so Moderne CLI can discover it
    cp "$abs_migration_path" "rewrite.yml"

    echo "Running recipe: $RECIPE_NAME"
    mod run . --recipe="$RECIPE_NAME"

    echo "Applying changes for $RECIPE_NAME"
    mod git apply . --last-recipe-run
    
    # Optional clean up the temporary rewrite.yml
    rm -f rewrite.yml
    
    echo "Migration $MIGRATION_FILE executed successfully."
done

echo "All post-upgrade migrations completed."
