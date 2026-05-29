#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/../.."

echo "=== Paw GitHub Release Publisher ==="
echo ""

# Check prerequisites
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) is not installed"
    echo "Install from: https://cli.github.com/"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo "Error: git is not installed"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed"
    exit 1
fi

# Verify gh is authenticated
if ! gh auth status &> /dev/null; then
    echo "Error: gh CLI is not authenticated"
    echo "Run: gh auth login"
    exit 1
fi

# Check working directory is clean
if ! git diff --quiet HEAD || ! git diff --cached --quiet; then
    echo "Error: Working directory is not clean."
    echo "Please commit or stash your changes before publishing."
    exit 1
fi

# Bump patch version automatically
echo "Bumping patch version..."
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "chore(release): bump version to $(node -p "require('./package.json').version")"
echo ""

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

# Get repo info from git remote
REMOTE_URL=$(git remote get-url origin 2>/dev/null || true)
if [ -z "$REMOTE_URL" ]; then
    echo "Error: No git remote 'origin' found"
    exit 1
fi

echo "Version:  ${VERSION}"
echo "Tag:      ${TAG}"
echo "Remote:   ${REMOTE_URL}"
echo ""

# Build release packages
echo "Building release packages..."
echo ""
rm -rf release
npm run dist
echo ""

# Check for release artifacts
if [ ! -d "release" ]; then
    echo "Error: release/ directory not found after build"
    exit 1
fi

# Collect artifacts to upload
ARTIFACTS=()
for f in release/*.dmg; do
    [ -e "$f" ] || continue
    ARTIFACTS+=("$f")
done

if [ ${#ARTIFACTS[@]} -eq 0 ]; then
    echo "Error: No release artifacts found in release/"
    exit 1
fi

echo "Artifacts to publish:"
for f in "${ARTIFACTS[@]}"; do
    echo "  - $(basename "$f")"
done
echo ""

# Create tag if it doesn't exist locally
if ! git rev-parse "$TAG" &> /dev/null; then
    echo "Creating tag ${TAG}..."
    git tag -a "$TAG" -m "Release ${TAG}"
    echo ""
else
    echo "Tag ${TAG} already exists locally."
fi

# Push commit and tag to remote
CURRENT_BRANCH=$(git branch --show-current)
if [ -n "$CURRENT_BRANCH" ]; then
    echo "Pushing branch ${CURRENT_BRANCH}..."
    git push origin "$CURRENT_BRANCH"
fi

if ! git ls-remote --tags origin "refs/tags/${TAG}" | grep -q "${TAG}"; then
    echo "Pushing tag ${TAG}..."
    git push origin "$TAG"
    echo ""
else
    echo "Tag ${TAG} already exists on remote."
    echo ""
fi

# Create or verify release
if gh release view "$TAG" &> /dev/null; then
    echo "Release ${TAG} already exists on GitHub."
    read -r -p "Upload artifacts to existing release? [y/N] " reply
    if [[ ! "$reply" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
    echo "Uploading to existing release ${TAG}..."
    for i in "${!ARTIFACTS[@]}"; do
        f="${ARTIFACTS[$i]}"
        num=$((i + 1))
        total=${#ARTIFACTS[@]}
        echo "  [${num}/${total}] Uploading $(basename "$f")..."
        gh release upload "$TAG" "$f" --clobber
    done
else
    echo "Creating release ${TAG}..."
    gh release create "$TAG" \
        --title "${TAG}" \
        --generate-notes

    echo ""
    echo "Uploading artifacts..."
    for i in "${!ARTIFACTS[@]}"; do
        f="${ARTIFACTS[$i]}"
        num=$((i + 1))
        total=${#ARTIFACTS[@]}
        echo "  [${num}/${total}] Uploading $(basename "$f")..."
        gh release upload "$TAG" "$f"
    done
fi

echo ""
echo "=== Release Published ==="
echo ""
echo "View release:"
gh release view "$TAG" --web 2>/dev/null || echo "  gh release view ${TAG}"
