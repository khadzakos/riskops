package logger

import (
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

var globalLogger *zap.Logger

// Init initializes the global logger
func Init(level, format string) {
	var config zap.Config

	if format == "console" {
		config = zap.NewDevelopmentConfig()
		config.EncoderConfig.EncodeLevel = zapcore.CapitalColorLevelEncoder
	} else {
		config = zap.NewProductionConfig()
	}

	// Parse log level
	var zapLevel zapcore.Level
	if err := zapLevel.UnmarshalText([]byte(level)); err != nil {
		zapLevel = zapcore.InfoLevel
	}
	config.Level = zap.NewAtomicLevelAt(zapLevel)

	// Build logger
	var err error
	globalLogger, err = config.Build()
	if err != nil {
		// Fallback to production logger
		globalLogger, _ = zap.NewProduction()
	}
}

// Get returns the global logger instance
func Get() *zap.Logger {
	if globalLogger == nil {
		// Default to production logger if not initialized
		globalLogger, _ = zap.NewProduction()
	}
	return globalLogger
}

// Sync flushes any buffered log entries
func Sync() error {
	if globalLogger != nil {
		return globalLogger.Sync()
	}
	return nil
}
