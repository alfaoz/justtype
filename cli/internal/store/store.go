package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type Slate struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	WordCount   int       `json:"word_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	CloudID     int       `json:"cloud_id,omitempty"`
	IsPublished bool      `json:"is_published"`
	ShareID     string    `json:"share_id,omitempty"`
	Synced      bool      `json:"synced"`
}

type Store struct {
	baseDir string
	slates  map[string]*Slate
}

func New() (*Store, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}

	baseDir := filepath.Join(homeDir, ".justtype")
	if err := os.MkdirAll(baseDir, 0700); err != nil {
		return nil, err
	}

	s := &Store{
		baseDir: baseDir,
		slates:  make(map[string]*Slate),
	}

	if err := s.load(); err != nil && !os.IsNotExist(err) {
		return nil, err
	}

	return s, nil
}

func (s *Store) load() error {
	data, err := os.ReadFile(filepath.Join(s.baseDir, "slates.json"))
	if err != nil {
		return err
	}

	var slates []*Slate
	if err := json.Unmarshal(data, &slates); err != nil {
		return err
	}

	for _, slate := range slates {
		s.slates[slate.ID] = slate
	}

	return nil
}

func (s *Store) save() error {
	slates := s.List()
	data, err := json.MarshalIndent(slates, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(s.baseDir, "slates.json"), data, 0600)
}

func (s *Store) List() []*Slate {
	var slates []*Slate
	for _, slate := range s.slates {
		slates = append(slates, slate)
	}

	sort.Slice(slates, func(i, j int) bool {
		return slates[i].UpdatedAt.After(slates[j].UpdatedAt)
	})

	return slates
}

func (s *Store) Get(id string) *Slate {
	return s.slates[id]
}

func (s *Store) Create(title, content string) *Slate {
	id := generateID()
	now := time.Now()

	slate := &Slate{
		ID:        id,
		Title:     title,
		Content:   content,
		WordCount: countWords(content),
		CreatedAt: now,
		UpdatedAt: now,
		Synced:    false,
	}

	s.slates[id] = slate
	s.save()

	return slate
}

func (s *Store) Update(id, title, content string) *Slate {
	slate := s.slates[id]
	if slate == nil {
		return nil
	}

	slate.Title = title
	slate.Content = content
	slate.WordCount = countWords(content)
	slate.UpdatedAt = time.Now()
	slate.Synced = false

	s.save()
	return slate
}

func (s *Store) Delete(id string) {
	delete(s.slates, id)
	s.save()
}

func (s *Store) Search(query string) []*Slate {
	query = strings.ToLower(query)
	var results []*Slate

	for _, slate := range s.slates {
		if strings.Contains(strings.ToLower(slate.Title), query) ||
			strings.Contains(strings.ToLower(slate.Content), query) {
			results = append(results, slate)
		}
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].UpdatedAt.After(results[j].UpdatedAt)
	})

	return results
}

func (s *Store) Export(id, path string) error {
	slate := s.slates[id]
	if slate == nil {
		return os.ErrNotExist
	}

	content := slate.Title + "\n\n" + slate.Content
	return os.WriteFile(path, []byte(content), 0644)
}

func (s *Store) ExportAll(dir string) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	for _, slate := range s.slates {
		filename := sanitizeFilename(slate.Title) + ".txt"
		path := filepath.Join(dir, filename)

		content := slate.Title + "\n\n" + slate.Content
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return err
		}
	}

	return nil
}

func (s *Store) SetCloudID(id string, cloudID int) {
	if slate := s.slates[id]; slate != nil {
		slate.CloudID = cloudID
		slate.Synced = true
		s.save()
	}
}

func (s *Store) SetPublished(id string, isPublished bool, shareID string) {
	if slate := s.slates[id]; slate != nil {
		slate.IsPublished = isPublished
		slate.ShareID = shareID
		s.save()
	}
}

func (s *Store) ImportFromCloud(cloudSlate *Slate) {
	if cloudSlate.CloudID == 0 {
		return // Can't import without a cloud ID
	}

	// Check if we already have this cloud slate
	for _, local := range s.slates {
		if local.CloudID > 0 && local.CloudID == cloudSlate.CloudID {
			// Update existing
			local.Title = cloudSlate.Title
			local.Content = cloudSlate.Content
			local.WordCount = cloudSlate.WordCount
			local.UpdatedAt = cloudSlate.UpdatedAt
			local.IsPublished = cloudSlate.IsPublished
			local.ShareID = cloudSlate.ShareID
			local.Synced = true
			s.save()
			return
		}
	}

	// Create new
	cloudSlate.Synced = true
	s.slates[cloudSlate.ID] = cloudSlate
	s.save()
}

func generateID() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 8)
	for i := range b {
		b[i] = chars[time.Now().UnixNano()%int64(len(chars))]
		time.Sleep(time.Nanosecond)
	}
	return string(b)
}

func countWords(s string) int {
	return len(strings.Fields(s))
}

func sanitizeFilename(s string) string {
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	result := s
	for _, char := range invalid {
		result = strings.ReplaceAll(result, char, "-")
	}
	result = strings.Trim(result, " .")
	if result == "" {
		result = "untitled"
	}
	if len(result) > 50 {
		result = result[:50]
	}
	return result
}
