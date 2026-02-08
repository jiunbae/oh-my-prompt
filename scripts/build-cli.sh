#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$ROOT_DIR/src/omp"
DEST_DIR="$ROOT_DIR/packages/omp-cli/lib"

echo "Building oh-my-prompt CLI package..."

# Clean and recreate lib/
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

# Copy all .js files (exclude __tests__, __mocks__)
find "$SRC_DIR" -maxdepth 1 -name "*.js" -type f -exec cp {} "$DEST_DIR/" \;

echo "Copied $(find "$DEST_DIR" -name "*.js" | wc -l | tr -d ' ') files to $DEST_DIR"

# Ensure bin/omp is executable
chmod +x "$ROOT_DIR/packages/omp-cli/bin/omp"

echo "Build complete!"
