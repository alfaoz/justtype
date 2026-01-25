package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type DeviceCodeResponse struct {
	DeviceCode      string `json:"device_code"`
	UserCode        string `json:"user_code"`
	VerificationURI string `json:"verification_uri"`
	ExpiresIn       int    `json:"expires_in"`
	Interval        int    `json:"interval"`
}

type TokenResponse struct {
	Token    string `json:"token"`
	Username string `json:"username"`
}

type DeviceAuth struct {
	apiURL string
	client *http.Client
}

func NewDeviceAuth(apiURL string) *DeviceAuth {
	return &DeviceAuth{
		apiURL: apiURL,
		client: &http.Client{Timeout: 10 * time.Second},
	}
}

// RequestDeviceCode requests a device code from the server
func (da *DeviceAuth) RequestDeviceCode() (*DeviceCodeResponse, error) {
	req, err := http.NewRequest("POST", da.apiURL+"/api/cli/device-code", nil)
	if err != nil {
		return nil, err
	}

	resp, err := da.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to request device code: %d", resp.StatusCode)
	}

	var dcr DeviceCodeResponse
	if err := json.NewDecoder(resp.Body).Decode(&dcr); err != nil {
		return nil, err
	}

	return &dcr, nil
}

// PollForToken polls for the token until approved or expired
func (da *DeviceAuth) PollForToken(deviceCode string, interval int, expiresIn int) (*TokenResponse, error) {
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	timeout := time.After(time.Duration(expiresIn) * time.Second)

	for {
		select {
		case <-timeout:
			return nil, fmt.Errorf("authorization expired")

		case <-ticker.C:
			token, err := da.checkToken(deviceCode)
			if err != nil {
				// Check if it's a "pending" error
				if err.Error() == "pending" {
					continue
				}
				return nil, err
			}
			return token, nil
		}
	}
}

func (da *DeviceAuth) checkToken(deviceCode string) (*TokenResponse, error) {
	body := map[string]string{"device_code": deviceCode}
	jsonData, _ := json.Marshal(body)

	req, err := http.NewRequest("POST", da.apiURL+"/api/cli/token", bytes.NewReader(jsonData))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := da.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	// Check for pending status
	if status, ok := result["status"].(string); ok && status == "pending" {
		return nil, fmt.Errorf("pending")
	}

	// Check for error
	if errMsg, ok := result["error"].(string); ok {
		return nil, fmt.Errorf(errMsg)
	}

	// Got token!
	if token, ok := result["token"].(string); ok {
		username := ""
		if un, ok := result["username"].(string); ok {
			username = un
		}
		return &TokenResponse{
			Token:    token,
			Username: username,
		}, nil
	}

	return nil, fmt.Errorf("unexpected response")
}
