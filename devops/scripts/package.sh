#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "=== Paw Packaging Script ==="
echo ""

# Check prerequisites
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

echo "Node version: $(node --version)"
echo "npm version: $(npm --version)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
    echo "Installing dependencies..."
    npm ci
    echo ""
else
    echo "Dependencies up to date"
    echo ""
fi

# Build the application
echo "Building application..."
npm run build
echo ""

# Clean previous release artifacts
echo "Cleaning previous release artifacts..."
rm -rf release/
echo ""

# Determine current platform
PLATFORM=$(uname -s)
BUILD_SUCCESS=true

# Package per-platform so failures don't wipe out other builds
if [[ "$PLATFORM" == "Darwin" ]]; then
    echo "Packaging for macOS (x64 + arm64)..."
    if npx electron-builder --mac --publish=never; then
        echo "macOS packaging succeeded"
    else
        echo "ERROR: macOS packaging failed"
        BUILD_SUCCESS=false
    fi

    # Optionally attempt Windows/Linux, but don't let them fail the script
    echo ""
    echo "Attempting Windows packaging (requires Wine/Mono on macOS)..."
    if npx electron-builder --win --publish=never || true; then
        echo "Windows packaging completed"
    fi

    echo ""
    echo "Attempting Linux packaging..."
    if npx electron-builder --linux --publish=never || true; then
        echo "Linux packaging completed"
    fi
elif [[ "$PLATFORM" == "MINGW"* ]] || [[ "$PLATFORM" == "CYGWIN"* ]] || [[ "$PLATFORM" == "MSYS"* ]]; then
    echo "Packaging for Windows..."
    npx electron-builder --win --publish=never
elif [[ "$PLATFORM" == "Linux" ]]; then
    echo "Packaging for Linux..."
    npx electron-builder --linux --publish=never
else
    echo "Unknown platform: $PLATFORM"
    exit 1
fi

echo ""
if [ "$BUILD_SUCCESS" = true ]; then
    echo "=== Packaging Complete ==="
else
    echo "=== Packaging Finished with Errors ==="
fi

echo ""
echo "Artifacts in release/:"
if [ -d "release" ]; then
    ls -lh release/ 2>/dev/null || echo "  (no artifacts found)"
else
    echo "  (release directory not found)"
fi
