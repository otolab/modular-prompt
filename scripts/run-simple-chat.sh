#!/bin/bash

# Simple Chat Runner Script
# This script runs the simple-chat CLI with proper path resolution

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Build if needed
if [ ! -d "$PROJECT_ROOT/packages/simple-chat/dist" ]; then
  echo "Building simple-chat package..."
  cd "$PROJECT_ROOT"
  npm run build
fi

# Run the simple-chat CLI
node --no-deprecation "$PROJECT_ROOT/packages/simple-chat/dist/cli.js" "$@"
