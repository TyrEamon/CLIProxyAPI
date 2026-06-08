package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSaveConfigPreserveCommentsCreatesMissingConfigPath(t *testing.T) {
	path := filepath.Join(t.TempDir(), "gitstore", "config", "config.yaml")

	err := SaveConfigPreserveComments(path, &Config{
		SDKConfig: SDKConfig{APIKeys: []string{"test-key"}},
		Port:      8317,
	})
	if err != nil {
		t.Fatalf("SaveConfigPreserveComments() error = %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read created config: %v", err)
	}
	text := string(data)
	if !strings.Contains(text, "port: 8317") {
		t.Fatalf("created config missing port: %s", text)
	}
	if !strings.Contains(text, "test-key") {
		t.Fatalf("created config missing api key: %s", text)
	}
}
