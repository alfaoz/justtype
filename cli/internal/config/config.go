package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

type Config struct {
	Token      string `json:"token,omitempty"`
	Username   string `json:"username,omitempty"`
	APIURL     string `json:"api_url,omitempty"`
	Editor     string `json:"editor,omitempty"`
	FirstRun   bool   `json:"first_run"`
	path       string
}

func Load() (*Config, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	configDir := filepath.Join(homeDir, ".justtype")
	if err := os.MkdirAll(configDir, 0700); err != nil {
		return nil, err
	}

	configPath := filepath.Join(configDir, "config.json")

	cfg := &Config{
		APIURL:   "https://justtype.io",
		FirstRun: true,
		path:     configPath,
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}

	json.Unmarshal(data, cfg)
	cfg.path = configPath

	if cfg.APIURL == "" {
		cfg.APIURL = "https://justtype.io"
	}

	return cfg, nil
}

func (c *Config) Save() error {
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(c.path, data, 0600)
}

func (c *Config) SetCredentials(token, username string) error {
	c.Token = token
	c.Username = username
	return c.Save()
}

func (c *Config) ClearCredentials() error {
	c.Token = ""
	c.Username = ""
	return c.Save()
}

func (c *Config) IsLoggedIn() bool {
	return c.Token != ""
}

func (c *Config) SetEditor(editor string) error {
	c.Editor = editor
	return c.Save()
}

func (c *Config) GetEditor() string {
	if c.Editor != "" {
		return c.Editor
	}
	// Check environment
	if e := os.Getenv("EDITOR"); e != "" {
		return e
	}
	if e := os.Getenv("VISUAL"); e != "" {
		return e
	}
	return ""
}

func (c *Config) CompleteFirstRun() error {
	c.FirstRun = false
	return c.Save()
}

func (c *Config) IsFirstRun() bool {
	return c.FirstRun
}
