package cliproxy

import "testing"

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
