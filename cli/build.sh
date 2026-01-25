#!/bin/bash
# Build and publish justtype CLI binaries
# Usage: ./build.sh [version]

set -e

VERSION=${1:-$(cat ../public/cli/version.txt 2>/dev/null || echo "1.0.0")}
OUTPUT_DIR="../public/cli"
GO="/usr/local/go/bin/go"

echo "Building justtype CLI v$VERSION..."

# Build for all platforms
platforms=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
)

for platform in "${platforms[@]}"; do
    OS="${platform%/*}"
    ARCH="${platform#*/}"

    echo "  Building $OS/$ARCH..."

    TMP=$(mktemp -d)
    CGO_ENABLED=0 GOOS=$OS GOARCH=$ARCH $GO build -ldflags="-s -w" -o "$TMP/justtype" .

    tar -czf "$OUTPUT_DIR/justtype_${OS}_${ARCH}.tar.gz" -C "$TMP" justtype
    rm -rf "$TMP"
done

# Update version file
echo "$VERSION" > "$OUTPUT_DIR/version.txt"

echo ""
echo "✓ Built and published v$VERSION"
echo ""
echo "Files:"
ls -lh "$OUTPUT_DIR"/*.tar.gz
echo ""
echo "Install command:"
echo "  curl -fsSL https://justtype.io/cli/install.sh | bash"
