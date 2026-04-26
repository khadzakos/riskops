package handler

// BulkIngestHandler provides HTTP endpoints for bulk historical data ingestion
// and daily refresh operations. These endpoints are registered directly on the
// chi router (not via oapi-codegen) because they are async fire-and-forget
// operations that don't fit the synchronous OpenAPI contract.

import (
	"context"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/service"
	"go.uber.org/zap"
)

// bulkJobState tracks the state of a running bulk ingestion job.
type bulkJobState struct {
	mu        sync.RWMutex
	running   bool
	lastRun   *service.BulkIngestSummary
	startedAt time.Time
}

var globalBulkState = &bulkJobState{}

// BulkIngestHandler handles bulk ingestion HTTP endpoints.
type BulkIngestHandler struct {
	ingestSvc *service.IngestService
	log       *zap.Logger
}

// NewBulkIngestHandler creates a new BulkIngestHandler.
func NewBulkIngestHandler(ingestSvc *service.IngestService, log *zap.Logger) *BulkIngestHandler {
	return &BulkIngestHandler{ingestSvc: ingestSvc, log: log}
}

type bulkIngestStatusResponse struct {
	Running   bool                       `json:"running"`
	StartedAt *string                    `json:"started_at,omitempty"`
	LastRun   *service.BulkIngestSummary `json:"last_run,omitempty"`
}

type bulkIngestTriggerResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// HandleBulkHistoricalIngest handles POST /api/market-data/ingest/bulk-historical
// Triggers a background job to fetch 10 years of data for all top US+RU tickers.
func (h *BulkIngestHandler) HandleBulkHistoricalIngest(w http.ResponseWriter, r *http.Request) {
	globalBulkState.mu.Lock()
	if globalBulkState.running {
		globalBulkState.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(bulkIngestTriggerResponse{
			Status:  "already_running",
			Message: "A bulk historical ingestion job is already in progress",
		})
		return
	}
	globalBulkState.running = true
	globalBulkState.startedAt = time.Now()
	globalBulkState.mu.Unlock()

	h.log.Info("bulk historical ingest triggered via API")

	// Run in background goroutine — returns immediately to caller
	go func() {
		ctx := context.Background()
		summary, err := h.ingestSvc.BulkHistoricalIngest(ctx)
		globalBulkState.mu.Lock()
		globalBulkState.running = false
		if err != nil {
			h.log.Error("bulk historical ingest failed", zap.Error(err))
			globalBulkState.lastRun = &service.BulkIngestSummary{
				Status:      "failed",
				StartedAt:   globalBulkState.startedAt,
				CompletedAt: time.Now(),
			}
		} else {
			globalBulkState.lastRun = summary
		}
		globalBulkState.mu.Unlock()
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(bulkIngestTriggerResponse{
		Status:  "accepted",
		Message: "Bulk historical ingestion started in background. Poll GET /api/market-data/ingest/bulk-historical/status for progress.",
	})
}

// HandleBulkHistoricalStatus handles GET /api/market-data/ingest/bulk-historical/status
func (h *BulkIngestHandler) HandleBulkHistoricalStatus(w http.ResponseWriter, r *http.Request) {
	globalBulkState.mu.RLock()
	running := globalBulkState.running
	startedAt := globalBulkState.startedAt
	lastRun := globalBulkState.lastRun
	globalBulkState.mu.RUnlock()

	resp := bulkIngestStatusResponse{
		Running: running,
		LastRun: lastRun,
	}
	if running {
		s := startedAt.UTC().Format(time.RFC3339)
		resp.StartedAt = &s
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// HandleDailyRefresh handles POST /api/market-data/ingest/daily-refresh
// Fetches the previous trading day's data for all symbols already in the DB.
func (h *BulkIngestHandler) HandleDailyRefresh(w http.ResponseWriter, r *http.Request) {
	h.log.Info("daily refresh triggered via API")

	go func() {
		ctx := context.Background()
		summary, err := h.ingestSvc.DailyRefresh(ctx)
		if err != nil {
			h.log.Error("daily refresh failed", zap.Error(err))
		} else {
			h.log.Info("daily refresh complete",
				zap.Int("total_rows", summary.TotalRowsIngested),
				zap.String("status", summary.Status),
			)
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(bulkIngestTriggerResponse{
		Status:  "accepted",
		Message: "Daily refresh started in background.",
	})
}
