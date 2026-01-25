#!/bin/bash
# justtype CLI installer
# Usage: curl -fsSL https://justtype.io/cli/install.sh | bash
# For system-wide install: JUSTTYPE_INSTALL_DIR=/usr/local/bin bash install.sh

set -e

BASE_URL="https://justtype.io/cli"

# Default to user's local bin (no sudo required)
# Override with: JUSTTYPE_INSTALL_DIR=/usr/local/bin
INSTALL_DIR="${JUSTTYPE_INSTALL_DIR:-$HOME/.local/bin}"

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

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

# Install
if [ -w "$INSTALL_DIR" ]; then
    mv "$TMP/justtype" "$INSTALL_DIR/"
    chmod +x "$INSTALL_DIR/justtype"
else
    echo "Installing to $INSTALL_DIR (requires sudo)..."
    sudo mv "$TMP/justtype" "$INSTALL_DIR/"
    sudo chmod +x "$INSTALL_DIR/justtype"
fi

# Check if install dir is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""

    # Detect shell config file
    SHELL_CONFIG=""
    if [ -n "$ZSH_VERSION" ]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [ -n "$BASH_VERSION" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    fi

    if [ -n "$SHELL_CONFIG" ]; then
        # Check if PATH export already exists in config (check for both literal path and $HOME)
        if ! grep -q 'export PATH.*\.local/bin' "$SHELL_CONFIG" 2>/dev/null && \
           ! grep -q "export PATH.*$INSTALL_DIR" "$SHELL_CONFIG" 2>/dev/null; then
            echo "Adding $INSTALL_DIR to PATH in $SHELL_CONFIG..."
            echo "" >> "$SHELL_CONFIG"
            echo "# Added by justtype installer" >> "$SHELL_CONFIG"
            echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> "$SHELL_CONFIG"
            echo "✓ Updated $SHELL_CONFIG"
            echo ""
            echo "Restart your shell or run:"
            echo "  source $SHELL_CONFIG"
        fi
    else
        echo "⚠ $INSTALL_DIR is not in your PATH"
        echo ""
        echo "Add this to your shell config:"
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
fi

echo ""
echo "✓ justtype installed to $INSTALL_DIR"
echo ""
echo "  Run 'justtype' to start writing"
echo ""
