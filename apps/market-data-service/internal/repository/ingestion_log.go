package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/khadzakos/riskops/pkg/models"
)

type IngestionLogRepo struct {
	db *pgxpool.Pool
}

func NewIngestionLogRepo(db *pgxpool.Pool) *IngestionLogRepo {
	return &IngestionLogRepo{db: db}
}

func (r *IngestionLogRepo) Create(ctx context.Context, entry models.IngestionLog) (*models.IngestionLog, error) {
	var out models.IngestionLog
	err := r.db.QueryRow(ctx, `
		INSERT INTO ingestion_log (source, data_type, symbols, date_from, date_to, rows_ingested, status, error_message)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, source, data_type, symbols, date_from, date_to, rows_ingested, status, error_message, created_at`,
		entry.Source, entry.DataType, entry.Symbols,
		entry.DateFrom, entry.DateTo,
		entry.RowsIngested, entry.Status, entry.ErrorMessage,
	).Scan(
		&out.ID, &out.Source, &out.DataType, &out.Symbols,
		&out.DateFrom, &out.DateTo,
		&out.RowsIngested, &out.Status, &out.ErrorMessage, &out.CreatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("create ingestion log: %w", err)
	}
	return &out, nil
}

func (r *IngestionLogRepo) List(ctx context.Context, source, status string, limit int) ([]models.IngestionLog, error) {
	if limit <= 0 {
		limit = 100
	}

	conditions := []string{}
	args := []interface{}{}
	idx := 1

	if source != "" {
		conditions = append(conditions, fmt.Sprintf("source = $%d", idx))
		args = append(args, source)
		idx++
	}
	if status != "" {
		conditions = append(conditions, fmt.Sprintf("status = $%d", idx))
		args = append(args, status)
		idx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT id, source, data_type, symbols, date_from, date_to, rows_ingested, status, error_message, created_at
		FROM ingestion_log
		%s
		ORDER BY created_at DESC
		LIMIT $%d`, where, idx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list ingestion log: %w", err)
	}
	defer rows.Close()

	var out []models.IngestionLog
	for rows.Next() {
		var entry models.IngestionLog
		if err := rows.Scan(
			&entry.ID, &entry.Source, &entry.DataType, &entry.Symbols,
			&entry.DateFrom, &entry.DateTo,
			&entry.RowsIngested, &entry.Status, &entry.ErrorMessage, &entry.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan ingestion log: %w", err)
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}
