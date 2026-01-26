package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

const DefaultAPIURL = "https://justtype.io"

type Client struct {
	baseURL    string
	token      string
	httpClient *http.Client
}

type User struct {
	ID       int    `json:"id"`
	Username string `json:"username"`
	Email    string `json:"email"`
}

type Slate struct {
	ID          int     `json:"id"`
	Title       string  `json:"title"`
	Content     string  `json:"content,omitempty"`
	WordCount   int     `json:"word_count"`
	IsPublished int     `json:"is_published"`
	ShareID     string  `json:"share_id,omitempty"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

type LoginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type PublishResponse struct {
	ShareID  string `json:"shareId"`
	ShareURL string `json:"shareUrl"`
}

func New(baseURL, token string) *Client {
	if baseURL == "" {
		baseURL = DefaultAPIURL
	}
	return &Client{
		baseURL: baseURL,
		token:   token,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c *Client) SetToken(token string) {
	c.token = token
}

func (c *Client) doRequest(method, path string, body interface{}) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		jsonData, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(jsonData)
	}

	req, err := http.NewRequest(method, c.baseURL+path, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "justtype-cli/2.0")
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}

	return c.httpClient.Do(req)
}

func (c *Client) Login(username, password string) (*LoginResponse, error) {
	resp, err := c.doRequest("POST", "/api/auth/login", map[string]string{
		"username": username,
		"password": password,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errResp struct{ Error string `json:"error"` }
		json.NewDecoder(resp.Body).Decode(&errResp)
		if errResp.Error != "" {
			return nil, fmt.Errorf("%s", errResp.Error)
		}
		return nil, fmt.Errorf("login failed")
	}

	var result LoginResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func (c *Client) Register(username, email, password string) (*LoginResponse, error) {
	resp, err := c.doRequest("POST", "/api/auth/register", map[string]string{
		"username": username,
		"email":    email,
		"password": password,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		var errResp struct{ Error string `json:"error"` }
		json.NewDecoder(resp.Body).Decode(&errResp)
		if errResp.Error != "" {
			return nil, fmt.Errorf("%s", errResp.Error)
		}
		return nil, fmt.Errorf("registration failed")
	}

	var result LoginResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func (c *Client) Verify() (*User, error) {
	resp, err := c.doRequest("GET", "/api/auth/verify", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("invalid token")
	}

	var result struct {
		Valid bool `json:"valid"`
		User  User `json:"user"`
	}
	json.NewDecoder(resp.Body).Decode(&result)

	if !result.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	return &result.User, nil
}

func (c *Client) ListSlates() ([]Slate, error) {
	resp, err := c.doRequest("GET", "/api/slates", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to list slates")
	}

	var slates []Slate
	json.NewDecoder(resp.Body).Decode(&slates)
	return slates, nil
}

func (c *Client) GetSlate(id int) (*Slate, error) {
	resp, err := c.doRequest("GET", fmt.Sprintf("/api/slates/%d", id), nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("slate not found")
	}

	var slate Slate
	json.NewDecoder(resp.Body).Decode(&slate)
	return &slate, nil
}

func (c *Client) CreateSlate(title, content string) (*Slate, error) {
	resp, err := c.doRequest("POST", "/api/slates", map[string]string{
		"title":   title,
		"content": content,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("unauthorized: session expired")
	}

	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to create slate")
	}

	var slate Slate
	json.NewDecoder(resp.Body).Decode(&slate)
	return &slate, nil
}

func (c *Client) UpdateSlate(id int, title, content string) error {
	resp, err := c.doRequest("PUT", fmt.Sprintf("/api/slates/%d", id), map[string]string{
		"title":   title,
		"content": content,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return fmt.Errorf("unauthorized: session expired")
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to update slate")
	}

	return nil
}

func (c *Client) DeleteSlate(id int) error {
	resp, err := c.doRequest("DELETE", fmt.Sprintf("/api/slates/%d", id), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("failed to delete slate")
	}

	return nil
}

func (c *Client) PublishSlate(id int) (*PublishResponse, error) {
	resp, err := c.doRequest("PATCH", fmt.Sprintf("/api/slates/%d/publish", id), map[string]bool{
		"publish": true,
	})
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to publish")
	}

	var result PublishResponse
	json.NewDecoder(resp.Body).Decode(&result)
	return &result, nil
}

func (c *Client) UnpublishSlate(id int) error {
	resp, err := c.doRequest("PATCH", fmt.Sprintf("/api/slates/%d/publish", id), map[string]bool{
		"publish": false,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to unpublish")
	}

	return nil
}
