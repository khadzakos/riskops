package main

import (
	"context"
	"os/signal"
	"syscall"

	"github.com/khadzakos/riskops/apps/gateway/internal/config"
	"github.com/khadzakos/riskops/apps/gateway/internal/handler"
	"github.com/khadzakos/riskops/pkg/httpserver"
	"github.com/khadzakos/riskops/pkg/logger"
	"go.uber.org/zap"
)

func main() {
	cfg := config.Load()
	log := logger.New(cfg.LogLevel)
	defer func() { _ = log.Sync() }()

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	router := httpserver.NewRouter(log, handler.CORS)

	proxy := handler.NewProxyHandler(log,
		cfg.PortfolioServiceURL,
		cfg.MarketDataURL,
		cfg.InferenceURL,
		cfg.TrainingURL,
	)
	proxy.Register(router)

	if err := httpserver.Run(ctx, ":"+cfg.Port, router, log); err != nil {
		log.Fatal("http server error", zap.Error(err))
	}
}
