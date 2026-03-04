#!/bin/bash

# Simple test script for the simple-chat CLI

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Testing simple-chat with MLX driver..."
echo "This will use the default gemma-3-270m-it-qat-4bit model"
echo ""

# Test with a simple message
echo "Testing with: 'こんにちは'"
echo "こんにちは" | exec node --no-deprecation "$PROJECT_ROOT/packages/simple-chat/dist/cli.js" --stdin --driver mlx

echo ""
echo "Test completed!"