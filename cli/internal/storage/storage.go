package storage

import (
	"time"
)

// Slate represents a writing slate
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
}

// Storage interface for both local and cloud storage
type Storage interface {
	// Save saves a slate (create or update)
	Save(slate *Slate) error

	// Load loads a specific slate by ID
	Load(id string) (*Slate, error)

	// List returns all slates, sorted by updated_at desc
	List() ([]*Slate, error)

	// Delete removes a slate
	Delete(id string) error

	// Close cleans up resources
	Close() error
}

// ExtractTitle gets first non-empty line as title
func ExtractTitle(content string) string {
	if content == "" {
		return "untitled"
	}

	lines := splitLines(content)
	for _, line := range lines {
		trimmed := trimSpaces(line)
		if trimmed != "" {
			if len(trimmed) > 100 {
				return trimmed[:100]
			}
			return trimmed
		}
	}

	return "untitled"
}

// CountWords counts words in content
func CountWords(content string) int {
	if content == "" {
		return 0
	}

	count := 0
	inWord := false

	for _, r := range content {
		if isSpace(r) {
			inWord = false
		} else if !inWord {
			inWord = true
			count++
		}
	}

	return count
}

func splitLines(s string) []string {
	var lines []string
	var line string

	for _, r := range s {
		if r == '\n' {
			lines = append(lines, line)
			line = ""
		} else {
			line += string(r)
		}
	}

	if line != "" {
		lines = append(lines, line)
	}

	return lines
}

func trimSpaces(s string) string {
	start := 0
	end := len(s)

	for start < end && isSpace(rune(s[start])) {
		start++
	}

	for end > start && isSpace(rune(s[end-1])) {
		end--
	}

	return s[start:end]
}

func isSpace(r rune) bool {
	return r == ' ' || r == '\t' || r == '\n' || r == '\r'
}
