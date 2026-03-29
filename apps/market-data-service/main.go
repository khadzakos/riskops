package main

import (
	"context"
	_ "embed"
	"os/signal"
	"syscall"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/api"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/collector"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/config"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/handler"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/service"
	"github.com/khadzakos/riskops/pkg/httpserver"
	"github.com/khadzakos/riskops/pkg/logger"
	"github.com/khadzakos/riskops/pkg/postgres"
	"github.com/khadzakos/riskops/pkg/swaggerui"
	"go.uber.org/zap"
)

//go:embed openapi.yaml
var specBytes []byte

func main() {
	cfg := config.Load()
	log := logger.New(cfg.LogLevel)
	defer func() { _ = log.Sync() }()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	pool, err := postgres.New(ctx, postgres.Config{URL: cfg.DatabaseURL})
	if err != nil {
		log.Fatal("failed to connect to postgres", zap.Error(err))
	}
	defer pool.Close()

	// Repositories
	pricesRepo := repository.NewPricesRepo(pool)
	creditRepo := repository.NewCreditRepo(pool)
	logRepo := repository.NewIngestionLogRepo(pool)

	// Collectors registry
	collectors := map[string]collector.Collector{
		"yahoo":            collector.NewYahooCollector(),
		"moex":             collector.NewMOEXCollector(),
		"synthetic":        collector.NewSyntheticCollector(),
		"credit_synthetic": collector.NewCreditSyntheticCollector(),
	}

	// Services
	returnsSvc := service.NewReturnsService(pricesRepo, log)
	ingestSvc := service.NewIngestService(collectors, pricesRepo, creditRepo, logRepo, returnsSvc, log)

	// Handler
	h := handler.NewMarketDataHandler(ingestSvc, pricesRepo, creditRepo, logRepo)

	// Router
	strictHandler := api.NewStrictHandler(h, nil)
	router := httpserver.NewRouter(log)
	api.HandlerFromMux(strictHandler, router)
	if err := swaggerui.Register(router, "market-data-service", specBytes); err != nil {
		log.Fatal("swagger ui", zap.Error(err))
	}

	timeouts := httpserver.DefaultTimeouts()
	// Bulk ingest runs multiple collectors; responses are written only when ingestion finishes.
	timeouts.WriteTimeout = 20 * time.Minute
	if err := httpserver.RunWithTimeouts(ctx, ":"+cfg.Port, router, log, timeouts); err != nil {
		log.Fatal("http server error", zap.Error(err))
	}
}
