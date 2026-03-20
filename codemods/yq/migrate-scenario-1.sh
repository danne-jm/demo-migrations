#!/bin/bash

# Target directory (defaults to current directory if not passed as argument)
TARGET_DIR="${1:-.}"

echo "Starting YAML Migration in: $TARGET_DIR"
echo "Looking for .yml and .yaml files (ignoring node_modules and .git)..."

# Find all YAML files, skipping .git and node_modules, and pipe them to a while loop
find "$TARGET_DIR" -type d \( -name "node_modules" -o -name ".git" \) -prune -o \
     -type f \( -name "*.yml" -o -name "*.yaml" \) -print0 | while IFS= read -r -d '' file; do
    
    echo "Processing: $file"

    # Use yq to parse, modify, and save the file in-place (-i)
    yq -i '
      # 1. ADD AZURE_SUBSCRIPTION
      # Handle if variables is a sequence (Array format)
      with(select(.variables | type == "!!seq"); .variables += {"name": "AZURE_SUBSCRIPTION", "value": "sp-main-production"}) |
      # Handle if variables is a mapping (Dictionary format) or doesnt exist yet
      with(select(.variables | type == "!!map" or has("variables") == false); .variables.AZURE_SUBSCRIPTION = "sp-main-production") |

      # 2. RENAME "ENVIRONMENT" TO "AZ_ENV"
      # Rename in Mapping definitions globally
      with(.. | select(tag == "!!map" and has("ENVIRONMENT")); .AZ_ENV = .ENVIRONMENT | del(.ENVIRONMENT)) |
      # Rename in Sequence definitions globally (find arrays where item has name == ENVIRONMENT)
      (.. | select(tag == "!!seq") | .[] | select(.name == "ENVIRONMENT") | .name) = "AZ_ENV" |

      # 3. REMOVE "NODE_ENV"
      # Remove from Mapping definitions globally
      del(.. | select(tag == "!!map" and has("NODE_ENV")) | .NODE_ENV) |
      # Remove from Sequence definitions globally
      (.. | select(tag == "!!seq")) |= filter(.name == null or .name != "NODE_ENV") |

      # 4. UPDATE INLINE STRING USAGES GLOBALLY (e.g., scripts, inputs, tasks)
      # Replace ${{ variables.ENVIRONMENT }} -> ${{ variables.AZ_ENV }}
      (.. | select(tag == "!!str")) |= sub("\$\{\{\s*variables\.ENVIRONMENT\s*\}\}", "${{ variables.AZ_ENV }}") |
      # Replace $(ENVIRONMENT) -> $(AZ_ENV)
      (.. | select(tag == "!!str")) |= sub("\$\(ENVIRONMENT\)", "$(AZ_ENV)")
    ' "$file"

done

echo "Migration complete!"