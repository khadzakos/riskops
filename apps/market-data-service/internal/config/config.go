package config

import (
	"github.com/khadzakos/riskops/pkg/config"
)

type Config struct {
	Port        string
	DatabaseURL string
	LogLevel    string
}

func Load() Config {
	return Config{
		Port:        config.Env("PORT", "8083"),
		DatabaseURL: config.MustEnv("DATABASE_URL"),
		LogLevel:    config.Env("LOG_LEVEL", "info"),
	}
}
