package config

import (
	"github.com/khadzakos/riskops/pkg/config"
)

type Config struct {
	Port                string
	LogLevel            string
	PortfolioServiceURL string
	MarketDataURL       string
	InferenceURL        string
	TrainingURL         string
}

func Load() Config {
	return Config{
		Port:                config.Env("PORT", "8081"),
		LogLevel:            config.Env("LOG_LEVEL", "info"),
		PortfolioServiceURL: config.Env("PORTFOLIO_SERVICE_URL", "http://portfolio-service:8082"),
		MarketDataURL:       config.Env("MARKET_DATA_SERVICE_URL", "http://market-data-service:8083"),
		InferenceURL:        config.Env("INFERENCE_SERVICE_URL", "http://inference-service:8085"),
		TrainingURL:         config.Env("TRAINING_SERVICE_URL", "http://training-service:8084"),
	}
}
