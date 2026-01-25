package storage

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/justtype/cli/internal/updater"
)

// CloudStorage is cloud-first with minimal local caching
type CloudStorage struct {
	apiURL        string
	token         string
	username      string
	client        *http.Client
	tempDir       string
	currentFile   string // temp file for current slate
	latestVersion string // latest CLI version from server
}

// NewCloud creates cloud storage
func NewCloud(tempDir, apiURL, token, username string) (*CloudStorage, error) {
	// Create temp directory if it doesn't exist
	if err := os.MkdirAll(tempDir, 0700); err != nil {
		return nil, err
	}

	cs := &CloudStorage{
		apiURL:   apiURL,
		token:    token,
		username: username,
		client:   &http.Client{Timeout: 30 * time.Second},
		tempDir:  tempDir,
	}

	return cs, nil
}

func (cs *CloudStorage) Save(slate *Slate) error {
	// Save to temp file (for current editing session only)
	cs.saveTempFile(slate)

	// Push to cloud immediately (not in background)
	body := map[string]string{
		"title":   slate.Title,
		"content": slate.Content,
	}

	jsonData, _ := json.Marshal(body)

	var req *http.Request
	if slate.CloudID > 0 {
		// Update existing
		req, _ = http.NewRequest("PUT", fmt.Sprintf("%s/api/slates/%d", cs.apiURL, slate.CloudID), bytes.NewReader(jsonData))
	} else {
		// Create new
		req, _ = http.NewRequest("POST", cs.apiURL+"/api/slates", bytes.NewReader(jsonData))
	}

	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.2")

	resp, err := cs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusCreated {
		// If this was a new slate, get its cloud ID
		if slate.CloudID == 0 {
			var result struct {
				ID int `json:"id"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
				slate.CloudID = result.ID
				slate.ID = fmt.Sprintf("cloud-%d", result.ID)
				// Update temp file with cloud ID
				cs.saveTempFile(slate)
			}
		}

		// Delete temp file after successful save
		cs.deleteTempFile()
		return nil
	}

	return fmt.Errorf("save failed: %d", resp.StatusCode)
}

func (cs *CloudStorage) Load(id string) (*Slate, error) {
	// Check temp file first (for current editing session)
	if slate, err := cs.loadTempFile(); err == nil && slate.ID == id {
		return slate, nil
	}

	// Extract cloud ID from local ID format "cloud-123"
	var cloudID int
	fmt.Sscanf(id, "cloud-%d", &cloudID)

	if cloudID == 0 {
		return nil, fmt.Errorf("invalid slate ID")
	}

	// Fetch from cloud
	return cs.fetchOne(cloudID)
}

func (cs *CloudStorage) List() ([]*Slate, error) {
	// Fetch metadata only from cloud
	req, _ := http.NewRequest("GET", cs.apiURL+"/api/slates", nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.3")
	cs.addVersionHeader(req)

	resp, err := cs.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	cs.checkVersionHeader(resp)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to list slates: %d", resp.StatusCode)
	}

	var cloudSlates []struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		WordCount   int    `json:"word_count"`
		IsPublished int    `json:"is_published"`
		ShareID     string `json:"share_id"`
		CreatedAt   string `json:"created_at"`
		UpdatedAt   string `json:"updated_at"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&cloudSlates); err != nil {
		return nil, err
	}

	// Convert to Slate objects (metadata only, no content)
	slates := make([]*Slate, 0, len(cloudSlates))
	for _, cs := range cloudSlates {
		createdAt, _ := time.Parse(time.RFC3339, cs.CreatedAt)
		updatedAt, _ := time.Parse(time.RFC3339, cs.UpdatedAt)

		slates = append(slates, &Slate{
			ID:          fmt.Sprintf("cloud-%d", cs.ID),
			Title:       cs.Title,
			Content:     "", // No content in list view
			WordCount:   cs.WordCount,
			CreatedAt:   createdAt,
			UpdatedAt:   updatedAt,
			CloudID:     cs.ID,
			IsPublished: cs.IsPublished == 1,
			ShareID:     cs.ShareID,
		})
	}

	return slates, nil
}

func (cs *CloudStorage) Delete(id string) error {
	// Extract cloud ID
	var cloudID int
	fmt.Sscanf(id, "cloud-%d", &cloudID)

	if cloudID == 0 {
		return fmt.Errorf("invalid slate ID")
	}

	// Delete from cloud
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/slates/%d", cs.apiURL, cloudID), nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.2")

	resp, err := cs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("delete failed: %d", resp.StatusCode)
	}

	// Delete temp file if it matches
	if slate, err := cs.loadTempFile(); err == nil && slate.ID == id {
		cs.deleteTempFile()
	}

	return nil
}

func (cs *CloudStorage) Close() error {
	// Clean up temp file on exit
	cs.deleteTempFile()
	return nil
}

func (cs *CloudStorage) fetchOne(cloudID int) (*Slate, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/slates/%d", cs.apiURL, cloudID), nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.3")
	cs.addVersionHeader(req)

	resp, err := cs.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	cs.checkVersionHeader(resp)

	if resp.StatusCode != http.StatusOK {
		// Check if it's an encryption key error
		body, _ := io.ReadAll(resp.Body)
		var errResp struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if err := json.Unmarshal(body, &errResp); err == nil && errResp.Code == "ENCRYPTION_KEY_MISSING" {
			return nil, fmt.Errorf("SESSION_EXPIRED")
		}
		return nil, fmt.Errorf("failed to fetch slate: %d", resp.StatusCode)
	}

	var apiSlate struct {
		ID          int    `json:"id"`
		Title       string `json:"title"`
		Content     string `json:"content"`
		WordCount   int    `json:"word_count"`
		IsPublished int    `json:"is_published"`
		ShareID     string `json:"share_id"`
		CreatedAt   string `json:"created_at"`
		UpdatedAt   string `json:"updated_at"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&apiSlate); err != nil {
		return nil, err
	}

	createdAt, _ := time.Parse(time.RFC3339, apiSlate.CreatedAt)
	updatedAt, _ := time.Parse(time.RFC3339, apiSlate.UpdatedAt)

	return &Slate{
		ID:          fmt.Sprintf("cloud-%d", apiSlate.ID),
		Title:       apiSlate.Title,
		Content:     apiSlate.Content,
		WordCount:   apiSlate.WordCount,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
		CloudID:     apiSlate.ID,
		IsPublished: apiSlate.IsPublished == 1,
		ShareID:     apiSlate.ShareID,
	}, nil
}

// Publish publishes a slate and returns share URL
func (cs *CloudStorage) Publish(slate *Slate) (string, error) {
	if slate.CloudID == 0 {
		return "", fmt.Errorf("slate must be saved to cloud first")
	}

	body := map[string]interface{}{"isPublished": true}
	jsonData, _ := json.Marshal(body)

	req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/api/slates/%d/publish", cs.apiURL, slate.CloudID), bytes.NewReader(jsonData))
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.2")

	resp, err := cs.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)

		// Try to parse as JSON to check for ENCRYPTION_KEY_MISSING
		var errResp struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if err := json.Unmarshal(body, &errResp); err == nil && errResp.Code == "ENCRYPTION_KEY_MISSING" {
			return "", fmt.Errorf("SESSION_EXPIRED")
		}

		return "", fmt.Errorf("publish failed: %s", string(body))
	}

	var result struct {
		ShareID  string `json:"shareId"`
		ShareURL string `json:"shareUrl"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}

	slate.IsPublished = true
	slate.ShareID = result.ShareID

	return result.ShareURL, nil
}

// Unpublish unpublishes a slate
func (cs *CloudStorage) Unpublish(slate *Slate) error {
	if slate.CloudID == 0 {
		return fmt.Errorf("slate must be saved to cloud first")
	}

	body := map[string]interface{}{"isPublished": false}
	jsonData, _ := json.Marshal(body)

	req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/api/slates/%d/publish", cs.apiURL, slate.CloudID), bytes.NewReader(jsonData))
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.2")

	resp, err := cs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("unpublish failed")
	}

	slate.IsPublished = false
	slate.ShareID = ""

	return nil
}

// Temp file management for current editing session
func (cs *CloudStorage) saveTempFile(slate *Slate) error {
	tempFile := filepath.Join(cs.tempDir, "current.json")
	data, err := json.MarshalIndent(slate, "", "  ")
	if err != nil {
		return err
	}
	cs.currentFile = tempFile
	return os.WriteFile(tempFile, data, 0600)
}

func (cs *CloudStorage) loadTempFile() (*Slate, error) {
	tempFile := filepath.Join(cs.tempDir, "current.json")
	data, err := os.ReadFile(tempFile)
	if err != nil {
		return nil, err
	}

	var slate Slate
	if err := json.Unmarshal(data, &slate); err != nil {
		return nil, err
	}

	return &slate, nil
}

func (cs *CloudStorage) deleteTempFile() error {
	tempFile := filepath.Join(cs.tempDir, "current.json")
	cs.currentFile = ""
	return os.Remove(tempFile)
}

// GetLatestVersion returns the latest version from server (if checked)
func (cs *CloudStorage) GetLatestVersion() string {
	return cs.latestVersion
}

// addVersionHeader adds CLI version to request and checks response for latest version
func (cs *CloudStorage) addVersionHeader(req *http.Request) {
	req.Header.Set("X-CLI-Version", updater.GetVersion())
}

func (cs *CloudStorage) checkVersionHeader(resp *http.Response) {
	if latestVersion := resp.Header.Get("X-Latest-Version"); latestVersion != "" {
		cs.latestVersion = latestVersion
	}
}
