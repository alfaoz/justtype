package updater

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	BaseURL        = "https://justtype.io/cli"
	CurrentVersion = "2.0.0"
)

type UpdateInfo struct {
	Available      bool
	CurrentVersion string
	LatestVersion  string
	DownloadURL    string
}

// CheckForUpdate checks if a newer version is available
func CheckForUpdate() (*UpdateInfo, error) {
	info := &UpdateInfo{
		CurrentVersion: CurrentVersion,
	}

	// Fetch latest version
	resp, err := http.Get(BaseURL + "/version.txt")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("failed to check version")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	info.LatestVersion = strings.TrimSpace(string(body))
	info.Available = info.LatestVersion != CurrentVersion
	info.DownloadURL = fmt.Sprintf("%s/justtype_%s_%s.tar.gz", BaseURL, runtime.GOOS, runtime.GOARCH)

	return info, nil
}

// Update downloads and installs the latest version
func Update() error {
	info, err := CheckForUpdate()
	if err != nil {
		return err
	}

	if !info.Available {
		return nil // Already up to date
	}

	// Get current executable path
	execPath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("couldn't find executable: %w", err)
	}
	execPath, err = filepath.EvalSymlinks(execPath)
	if err != nil {
		return fmt.Errorf("couldn't resolve executable path: %w", err)
	}

	// Download new version
	resp, err := http.Get(info.DownloadURL)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return fmt.Errorf("download failed: %s", resp.Status)
	}

	// Extract from tar.gz
	gzr, err := gzip.NewReader(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to decompress: %w", err)
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)

	var newBinary []byte
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("failed to read archive: %w", err)
		}

		if header.Name == "justtype" {
			newBinary, err = io.ReadAll(tr)
			if err != nil {
				return fmt.Errorf("failed to read binary: %w", err)
			}
			break
		}
	}

	if newBinary == nil {
		return fmt.Errorf("binary not found in archive")
	}

	// Write to system temp directory (always writable)
	tmpFile, err := os.CreateTemp("", "justtype-update-*")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(newBinary); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return fmt.Errorf("failed to write binary: %w", err)
	}
	tmpFile.Close()

	// Make executable
	if err := os.Chmod(tmpPath, 0755); err != nil {
		os.Remove(tmpPath)
		return fmt.Errorf("failed to set permissions: %w", err)
	}

	// Try to replace the binary directly first
	err = os.Rename(tmpPath, execPath)
	if err != nil {
		// Rename failed (likely cross-device or permission issue)
		// Try copying instead
		err = copyFile(tmpPath, execPath)
		os.Remove(tmpPath)
		if err != nil {
			// Check if it's a permission error
			if os.IsPermission(err) {
				return fmt.Errorf("permission denied. run: sudo curl -fsSL https://justtype.io/cli/install.sh | sudo bash")
			}
			return fmt.Errorf("failed to replace binary: %w", err)
		}
	}

	return nil
}

// copyFile copies src to dst, overwriting dst if it exists
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0755)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// GetVersion returns the current version
func GetVersion() string {
	return CurrentVersion
}

// LastUpdateCheck returns when we last checked for updates
func LastUpdateCheck() time.Time {
	// Could store this in config, for now just return zero
	return time.Time{}
}
