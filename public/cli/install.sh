#!/bin/bash
# justtype CLI installer
# Usage: curl -fsSL https://justtype.io/cli/install.sh | bash

set -e

BASE_URL="https://justtype.io/cli"
INSTALL_DIR="/usr/local/bin"

# Get version
VERSION=$(curl -fsSL "$BASE_URL/version.txt" 2>/dev/null || echo "1.0.0")

echo "Installing justtype CLI v$VERSION..."

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Error: Unsupported architecture: $ARCH"; exit 1 ;;
esac

case $OS in
    linux|darwin) ;;
    mingw*|msys*|cygwin*)
        echo "Error: Windows not supported via this script."
        echo "Download manually from $BASE_URL"
        exit 1
        ;;
    *) echo "Error: Unsupported OS: $OS"; exit 1 ;;
esac

FILENAME="justtype_${OS}_${ARCH}.tar.gz"
URL="${BASE_URL}/${FILENAME}"

echo "Downloading $FILENAME..."

# Create temp directory
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

# Download and extract
if ! curl -fsSL "$URL" -o "$TMP/justtype.tar.gz"; then
    echo "Error: Failed to download from $URL"
    exit 1
fi

tar -xzf "$TMP/justtype.tar.gz" -C "$TMP"

# Install
if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP/justtype" "$INSTALL_DIR/"
else
    echo "Installing to $INSTALL_DIR (requires sudo)..."
    sudo mv "$TMP/justtype" "$INSTALL_DIR/"
fi

chmod +x "$INSTALL_DIR/justtype"

echo ""
echo "✓ justtype installed successfully!"
echo ""
echo "  Run 'justtype' to start writing"
echo ""
