#!/bin/bash
# post-upgrade.sh
# Run this script using Renovate's postUpgradeTasks hooks

set -e

# This script assumes the following environment variables are passed from Renovate:
# RENOVATE_UPDATED_PACKAGE: Name of the package that was updated
# RENOVATE_OLD_VERSION: The previously installed version
# RENOVATE_NEW_VERSION: The newly updated version
# WORKSPACE_DIR: The root of the repository (Note: can be empty in some Renovate configs)

echo "Running post-upgrade tasks for $RENOVATE_UPDATED_PACKAGE from $RENOVATE_OLD_VERSION to $RENOVATE_NEW_VERSION"

# Provide safer git remote parsing for tools like OpenRewrite
git remote set-url origin https://github.com/danne-jm/demo-migrations.git || true

# We assume standard node_modules structure, or local custom-packages structure
# Let's search for migrations directory in the package that was just bumped

FOUND_MIGRATIONS=false

for PKG in $RENOVATE_UPDATED_PACKAGE; do
    echo "Checking package: $PKG"
    
    # Check node_modules path
    # Some packages might have scope like @scope/pkg, so $PKG will naturally have a slash
    if [ -d "node_modules/$PKG/migrations" ]; then
        MIGRATIONS_DIR="node_modules/$PKG/migrations"
        echo "Found migrations folder: $MIGRATIONS_DIR"
        FOUND_MIGRATIONS=true
        break
    # Check local custom-packages mapping
    # Assuming custom packages have the scope removed or are matched directly
    # E.g. @danieljaurellmevorach/fictional-logger -> we check if it's there
    # But locally it's named fictional-logger inside custom-packages, but let's check exact match first:
    elif [ -d "custom-packages/$PKG/migrations" ]; then
        MIGRATIONS_DIR="custom-packages/$PKG/migrations"
        echo "Found migrations folder: $MIGRATIONS_DIR"
        FOUND_MIGRATIONS=true
        break
    # As a fallback for locally scoped custom packages, try parsing out the scope
    elif [[ "$PKG" == @*/* ]]; then
        UNSCOPED_PKG="${PKG#*/}"
        if [ -d "custom-packages/$UNSCOPED_PKG/migrations" ]; then
            MIGRATIONS_DIR="custom-packages/$UNSCOPED_PKG/migrations"
            echo "Found migrations folder: $MIGRATIONS_DIR"
            FOUND_MIGRATIONS=true
            break
        fi
    fi
done

if [ "$FOUND_MIGRATIONS" = false ]; then
    echo "No migrations folder found for $RENOVATE_UPDATED_PACKAGE. Skipping."
    exit 0
fi

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

# Ensure we are operating out of the root directory.
# If WORKSPACE_DIR is empty, fallback to the current directory (`.`).
cd "${WORKSPACE_DIR:-.}"

# Install all yaml recipes first before building AST
for MIGRATION_FILE in $MIGRATIONS_TO_RUN; do
    # Use relative pathing instead of absolute pathing
    migration_path="$MIGRATIONS_DIR/$MIGRATION_FILE"
    
    if [ ! -f "$migration_path" ]; then
        echo "Migration file $migration_path not found! Skipping install..."
        continue
    fi
    
    echo "Installing recipe: $migration_path"
    mod config recipes yaml install "$migration_path"
done

# Build LST for the current repository using Moderne CLI
echo "Building ASTs for current repository..."
mod build .

for MIGRATION_FILE in $MIGRATIONS_TO_RUN; do
    echo "Processing migration file: $MIGRATION_FILE"
    
    # Use relative pathing instead of absolute pathing
    migration_path="$MIGRATIONS_DIR/$MIGRATION_FILE"
    
    if [ ! -f "$migration_path" ]; then
        echo "Migration file $migration_path not found! Skipping..."
        continue
    fi

    # Extract the recipe name from the YAML file
    # Assumes the format `name: com.example.RecipeName` on its own line
    RECIPE_NAME=$(grep '^name:' "$migration_path" | head -n 1 | awk '{print $2}' | tr -d '"' | tr -d "'")

    if [ -z "$RECIPE_NAME" ]; then
        echo "Could not extract recipe 'name:' from $migration_path. Skipping..."
        continue
    fi

    echo "Running recipe: $RECIPE_NAME"
    mod run . --recipe="$RECIPE_NAME"

    echo "Applying changes for $RECIPE_NAME"
    mod git apply . --last-recipe-run
    
    echo "Migration $MIGRATION_FILE executed successfully."
done

echo "All post-upgrade migrations completed."