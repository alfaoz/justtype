package storage

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// CloudStorage stores slates locally and syncs to cloud
type CloudStorage struct {
	local    *LocalStorage
	apiURL   string
	token    string
	username string
	client   *http.Client
}

// NewCloud creates cloud storage with local cache
func NewCloud(storagePath, apiURL, token, username string) (*CloudStorage, error) {
	local, err := NewLocal(storagePath)
	if err != nil {
		return nil, err
	}

	cs := &CloudStorage{
		local:    local,
		apiURL:   apiURL,
		token:    token,
		username: username,
		client:   &http.Client{Timeout: 30 * time.Second},
	}

	// Pull all slates from cloud on init
	if err := cs.pullAll(); err != nil {
		// Non-fatal - continue with local cache
		fmt.Printf("Warning: failed to sync from cloud: %v\n", err)
	}

	return cs, nil
}

func (cs *CloudStorage) Save(slate *Slate) error {
	// Save locally first (instant)
	if err := cs.local.Save(slate); err != nil {
		return err
	}

	// Push to cloud in background
	go cs.push(slate)

	return nil
}

func (cs *CloudStorage) Load(id string) (*Slate, error) {
	return cs.local.Load(id)
}

func (cs *CloudStorage) List() ([]*Slate, error) {
	return cs.local.List()
}

func (cs *CloudStorage) Delete(id string) error {
	slate, err := cs.local.Load(id)
	if err != nil {
		return err
	}

	// Delete locally
	if err := cs.local.Delete(id); err != nil {
		return err
	}

	// Delete from cloud if it has a cloud ID
	if slate.CloudID > 0 {
		go cs.deleteCloud(slate.CloudID)
	}

	return nil
}

func (cs *CloudStorage) Close() error {
	return cs.local.Close()
}

// pullAll fetches all slates from cloud and merges with local
func (cs *CloudStorage) pullAll() error {
	// List slates (metadata only)
	req, _ := http.NewRequest("GET", cs.apiURL+"/api/slates", nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.0")

	resp, err := cs.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to list slates: %d", resp.StatusCode)
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
		return err
	}

	// Fetch full content for each slate
	for _, cloudSlate := range cloudSlates {
		fullSlate, err := cs.fetchOne(cloudSlate.ID)
		if err != nil {
			continue // Skip failed fetches
		}

		// Check if we have this locally
		localSlates, _ := cs.local.List()
		found := false
		for _, local := range localSlates {
			if local.CloudID == fullSlate.CloudID {
				found = true
				// Update local with cloud version (server wins)
				local.Title = fullSlate.Title
				local.Content = fullSlate.Content
				local.WordCount = fullSlate.WordCount
				local.UpdatedAt = fullSlate.UpdatedAt
				local.IsPublished = fullSlate.IsPublished
				local.ShareID = fullSlate.ShareID
				cs.local.Save(local)
				break
			}
		}

		if !found {
			// New slate from cloud
			cs.local.Save(fullSlate)
		}
	}

	return nil
}

func (cs *CloudStorage) fetchOne(cloudID int) (*Slate, error) {
	req, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/slates/%d", cs.apiURL, cloudID), nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.0")

	resp, err := cs.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
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

func (cs *CloudStorage) push(slate *Slate) {
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
	req.Header.Set("User-Agent", "justtype-cli/2.0")

	resp, err := cs.client.Do(req)
	if err != nil {
		return // Fail silently
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
				cs.local.Save(slate) // Update local with cloud ID
			}
		}
	}
}

func (cs *CloudStorage) deleteCloud(cloudID int) {
	req, _ := http.NewRequest("DELETE", fmt.Sprintf("%s/api/slates/%d", cs.apiURL, cloudID), nil)
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("User-Agent", "justtype-cli/2.0")

	cs.client.Do(req)
	// Ignore errors - local delete already succeeded
}

// Publish publishes a slate and returns share URL
func (cs *CloudStorage) Publish(slate *Slate) (string, error) {
	if slate.CloudID == 0 {
		return "", fmt.Errorf("slate must be synced to cloud first")
	}

	body := map[string]interface{}{"isPublished": true}
	jsonData, _ := json.Marshal(body)

	req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/api/slates/%d/publish", cs.apiURL, slate.CloudID), bytes.NewReader(jsonData))
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.0")

	resp, err := cs.client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
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
	cs.local.Save(slate)

	return result.ShareURL, nil
}

// Unpublish unpublishes a slate
func (cs *CloudStorage) Unpublish(slate *Slate) error {
	if slate.CloudID == 0 {
		return fmt.Errorf("slate must be synced to cloud first")
	}

	body := map[string]interface{}{"isPublished": false}
	jsonData, _ := json.Marshal(body)

	req, _ := http.NewRequest("PATCH", fmt.Sprintf("%s/api/slates/%d/publish", cs.apiURL, slate.CloudID), bytes.NewReader(jsonData))
	req.Header.Set("Authorization", "Bearer "+cs.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.0")

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
	cs.local.Save(slate)

	return nil
}
