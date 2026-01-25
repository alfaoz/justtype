package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// LocalStorage stores slates in a JSON file
type LocalStorage struct {
	path   string
	slates map[string]*Slate
}

// NewLocal creates a new local storage at the given path
func NewLocal(storagePath string) (*LocalStorage, error) {
	// Ensure directory exists
	if err := os.MkdirAll(storagePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	ls := &LocalStorage{
		path:   filepath.Join(storagePath, "slates.json"),
		slates: make(map[string]*Slate),
	}

	// Load existing slates
	if err := ls.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	return ls, nil
}

func (ls *LocalStorage) Save(slate *Slate) error {
	if slate.ID == "" {
		slate.ID = generateID()
		slate.CreatedAt = time.Now()
	}

	slate.UpdatedAt = time.Now()
	slate.Title = ExtractTitle(slate.Content)
	slate.WordCount = CountWords(slate.Content)

	ls.slates[slate.ID] = slate
	return ls.persist()
}

func (ls *LocalStorage) Load(id string) (*Slate, error) {
	slate, ok := ls.slates[id]
	if !ok {
		return nil, fmt.Errorf("slate not found")
	}
	return slate, nil
}

func (ls *LocalStorage) List() ([]*Slate, error) {
	slates := make([]*Slate, 0, len(ls.slates))
	for _, slate := range ls.slates {
		slates = append(slates, slate)
	}

	// Sort by updated_at desc
	sort.Slice(slates, func(i, j int) bool {
		return slates[i].UpdatedAt.After(slates[j].UpdatedAt)
	})

	return slates, nil
}

func (ls *LocalStorage) Delete(id string) error {
	delete(ls.slates, id)
	return ls.persist()
}

func (ls *LocalStorage) Close() error {
	return ls.persist()
}

func (ls *LocalStorage) load() error {
	data, err := os.ReadFile(ls.path)
	if err != nil {
		return err
	}

	var slates []*Slate
	if err := json.Unmarshal(data, &slates); err != nil {
		return err
	}

	for _, slate := range slates {
		ls.slates[slate.ID] = slate
	}

	return nil
}

func (ls *LocalStorage) persist() error {
	slates := make([]*Slate, 0, len(ls.slates))
	for _, slate := range ls.slates {
		slates = append(slates, slate)
	}

	data, err := json.MarshalIndent(slates, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(ls.path, data, 0644)
}

func generateID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 12)
	for i := range b {
		b[i] = chars[time.Now().UnixNano()%int64(len(chars))]
		time.Sleep(time.Nanosecond)
	}
	return string(b)
}
