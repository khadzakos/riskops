package config

import (
	"github.com/khadzakos/riskops/pkg/config"
)

type Config struct {
	Port          string
	DatabaseURL   string
	LogLevel      string
	KafkaBrokers  string // comma-separated; empty disables Kafka publishing
}

func Load() Config {
	return Config{
		Port:         config.Env("PORT", "8082"),
		DatabaseURL:  config.MustEnv("DATABASE_URL"),
		LogLevel:     config.Env("LOG_LEVEL", "info"),
		KafkaBrokers: config.Env("KAFKA_BROKERS", ""),
	}
}
