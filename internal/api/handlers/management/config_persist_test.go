package management

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v7/internal/config"
)

type persistConfigStore struct {
	memoryAuthStore
	persistCount int
}

func (s *persistConfigStore) PersistConfig(context.Context) error {
	s.persistCount++
	return nil
}

func TestPersistCreatesMissingConfigPathAndPersistsStore(t *testing.T) {
	gin.SetMode(gin.TestMode)

	store := &persistConfigStore{}
	h := &Handler{
		cfg:            &config.Config{Port: 8317},
		configFilePath: filepath.Join(t.TempDir(), "gitstore", "config", "config.yaml"),
		tokenStore:     store,
	}

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPut, "/v0/management/request-retry", nil)

	if !h.persist(c) {
		t.Fatalf("persist() returned false: status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if store.persistCount != 1 {
		t.Fatalf("PersistConfig calls = %d, want 1", store.persistCount)
	}
}
