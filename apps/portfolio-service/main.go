package main

import (
	"context"
	"os/signal"
	"syscall"

	"github.com/khadzakos/riskops/apps/portfolio-service/internal/config"
	"github.com/khadzakos/riskops/apps/portfolio-service/internal/handler"
	"github.com/khadzakos/riskops/apps/portfolio-service/internal/repository"
	"github.com/khadzakos/riskops/apps/portfolio-service/internal/service"
	"github.com/khadzakos/riskops/pkg/httpserver"
	"github.com/khadzakos/riskops/pkg/logger"
	"github.com/khadzakos/riskops/pkg/postgres"
	"go.uber.org/zap"
)

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

	repo := repository.NewPortfolioRepo(pool)
	svc := service.NewPortfolioService(repo, log)

	router := httpserver.NewRouter(log)
	h := handler.NewPortfolioHandler(svc)
	h.Register(router)

	if err := httpserver.Run(ctx, ":"+cfg.Port, router, log); err != nil {
		log.Fatal("http server error", zap.Error(err))
	}
}
