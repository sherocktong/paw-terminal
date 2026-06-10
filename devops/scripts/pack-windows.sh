#!/bin/bash
set -euo pipefail

# Pack a Windows installation package for Paw Terminal
# Usage: pack-windows.sh [--arch x64|ia32|arm64] [--target nsis|portable|squirrel] [--skip-build]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_DIR"

# Defaults
ARCH="x64"
TARGET="nsis"
SKIP_BUILD=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch)
      ARCH="$2"
      shift 2
      ;;
    --target)
      TARGET="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --help|-h)
      echo "Usage: pack-windows.sh [--arch x64|ia32|arm64] [--target nsis|portable|squirrel] [--skip-build]"
      echo ""
      echo "Options:"
      echo "  --arch     Target architecture (default: x64)"
      echo "  --target   Installer target (default: nsis)"
      echo "  --skip-build   Skip the build step and package existing dist/"
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Run with --help for usage."
      exit 1
      ;;
  esac
done

echo "=== Paw Windows Packaging ==="
echo "Architecture: $ARCH"
echo "Target:       $TARGET"
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
echo "npm version:  $(npm --version)"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
    echo "Installing dependencies..."
    npm install --ignore-scripts
    echo ""
else
    echo "Dependencies up to date"
    echo ""
fi

# Build unless skipped
if [ "$SKIP_BUILD" = false ]; then
    echo "Building application..."
    npm run build
    echo ""
else
    echo "Skipping build (--skip-build)"
    echo ""
fi

# Clean previous Windows artifacts only
echo "Cleaning previous Windows release artifacts..."
rm -rf release/win-*
# Also remove common Windows installer artifacts at the top level
if [ -d "release" ]; then
    find release -maxdepth 1 -name "*.exe" -delete 2>/dev/null || true
    find release -maxdepth 1 -name "*.msi" -delete 2>/dev/null || true
    find release -maxdepth 1 -name "*.nsis.7z" -delete 2>/dev/null || true
fi
echo ""

# Package
echo "Packaging for Windows ($TARGET, $ARCH)..."
npx electron-builder --win "$TARGET" --"$ARCH" --publish=never

echo ""
echo "=== Packaging Complete ==="
echo ""
echo "Artifacts in release/:"
if [ -d "release" ]; then
    ls -lh release/ 2>/dev/null || echo "  (no artifacts found)"
else
    echo "  (release directory not found)"
fi
