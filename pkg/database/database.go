package database

import (
	"context"
	"fmt"
	"time"

	"riskops/pkg/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DB is the database connection instance
var DB *pgxpool.Pool

// Connect establishes database connection
func Connect(cfg *config.DatabaseConfig) (*pgxpool.Pool, error) {
	ctx := context.Background()

	// Parse connection string
	poolConfig, err := pgxpool.ParseConfig(cfg.DSN())
	if err != nil {
		return nil, fmt.Errorf("failed to parse database config: %w", err)
	}

	// Set connection pool settings
	poolConfig.MaxConns = int32(cfg.MaxOpenConns)
	poolConfig.MinConns = int32(cfg.MaxIdleConns)
	poolConfig.MaxConnLifetime = cfg.ConnMaxLifetime
	poolConfig.MaxConnIdleTime = 30 * time.Minute

	// Create connection pool
	DB, err = pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	// Test connection
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := DB.Ping(pingCtx); err != nil {
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	return DB, nil
}

// Close closes database connection
func Close() error {
	if DB == nil {
		return nil
	}

	return DB.Close()
}

// Health checks database health
func Health(ctx context.Context) error {
	if DB == nil {
		return fmt.Errorf("database connection is nil")
	}

	return DB.Ping(ctx)
}
