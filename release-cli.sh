#!/bin/bash

# CLI Release Script
# Builds and releases a new version of the justtype CLI

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if version is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: Version number required${NC}"
  echo "Usage: ./release-cli.sh <version>"
  echo "Example: ./release-cli.sh 2.3.2"
  exit 1
fi

NEW_VERSION=$1
echo -e "${GREEN}Building CLI v${NEW_VERSION}${NC}"

# Update version in updater.go
echo -e "${YELLOW}Updating version number...${NC}"
sed -i "s/CurrentVersion = \".*\"/CurrentVersion = \"${NEW_VERSION}\"/" cli/internal/updater/updater.go

# Clean and create dist directory
echo -e "${YELLOW}Cleaning dist directory...${NC}"
rm -rf cli/dist
mkdir -p cli/dist

# Build for all platforms
echo -e "${YELLOW}Building binaries...${NC}"

cd cli

# Linux amd64
echo "  - linux/amd64"
GOOS=linux GOARCH=amd64 go build -o dist/justtype .
tar -czf dist/justtype_linux_amd64.tar.gz -C dist justtype
rm dist/justtype

# Linux arm64
echo "  - linux/arm64"
GOOS=linux GOARCH=arm64 go build -o dist/justtype .
tar -czf dist/justtype_linux_arm64.tar.gz -C dist justtype
rm dist/justtype

# Darwin amd64
echo "  - darwin/amd64"
GOOS=darwin GOARCH=amd64 go build -o dist/justtype .
tar -czf dist/justtype_darwin_amd64.tar.gz -C dist justtype
rm dist/justtype

# Darwin arm64
echo "  - darwin/arm64"
GOOS=darwin GOARCH=arm64 go build -o dist/justtype .
tar -czf dist/justtype_darwin_arm64.tar.gz -C dist justtype
rm dist/justtype

cd ..

# Copy to public/cli
echo -e "${YELLOW}Copying binaries to public/cli...${NC}"
cp cli/dist/*.tar.gz public/cli/

# Update version.txt
echo "${NEW_VERSION}" > public/cli/version.txt

# Show file sizes
echo -e "${GREEN}Built binaries:${NC}"
ls -lh public/cli/*.tar.gz

# Commit and push
echo -e "${YELLOW}Committing changes...${NC}"
git add cli/internal/updater/updater.go public/cli/
git commit -m "bump CLI to v${NEW_VERSION}"

echo -e "${YELLOW}Pushing to git...${NC}"
git push

echo -e "${GREEN}✓ CLI v${NEW_VERSION} released successfully!${NC}"
echo ""
echo "Users can update with:"
echo "  curl -fsSL https://justtype.io/cli/install.sh | bash"
