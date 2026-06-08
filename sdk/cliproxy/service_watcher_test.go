package cliproxy

import (
	"context"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v7/internal/registry"
	coreauth "github.com/router-for-me/CLIProxyAPI/v7/sdk/cliproxy/auth"
	"github.com/router-for-me/CLIProxyAPI/v7/sdk/config"
)

func TestFileWatcherDisabledFromEnv(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "unset", value: "", want: false},
		{name: "true", value: "true", want: true},
		{name: "one", value: "1", want: true},
		{name: "yes", value: "yes", want: true},
		{name: "on", value: "on", want: true},
		{name: "false", value: "false", want: false},
		{name: "unknown", value: "disabled", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Setenv("CLIPROXY_DISABLE_FILE_WATCHER", tt.value)
			if got := fileWatcherDisabledFromEnv(); got != tt.want {
				t.Fatalf("fileWatcherDisabledFromEnv() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestServiceAuthHookRegistersModels(t *testing.T) {
	authID := "test-antigravity-hook"
	GlobalModelRegistry().UnregisterClient(authID)
	t.Cleanup(func() { GlobalModelRegistry().UnregisterClient(authID) })

	manager := coreauth.NewManager(nil, nil, nil)
	service := &Service{
		cfg:         &config.Config{},
		coreManager: manager,
	}
	manager.SetHook(serviceAuthHook{service: service})

	_, err := manager.Register(context.Background(), &coreauth.Auth{
		ID:       authID,
		Provider: "antigravity",
		Status:   coreauth.StatusActive,
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if got := registry.GetGlobalRegistry().GetModelsForClient(authID); len(got) == 0 {
		t.Fatal("expected antigravity models to be registered for auth")
	}
}
