package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/khadzakos/riskops/pkg/models"
)

type PortfolioRepo struct {
	db *pgxpool.Pool
}

func NewPortfolioRepo(db *pgxpool.Pool) *PortfolioRepo {
	return &PortfolioRepo{db: db}
}

func (r *PortfolioRepo) List(ctx context.Context) ([]models.Portfolio, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, name, description, currency, created_at, updated_at FROM portfolios ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list portfolios: %w", err)
	}
	defer rows.Close()

	var out []models.Portfolio
	for rows.Next() {
		var p models.Portfolio
		if err := rows.Scan(&p.ID, &p.Name, &p.Description, &p.Currency, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan portfolio: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PortfolioRepo) GetByID(ctx context.Context, id int64) (*models.Portfolio, error) {
	var p models.Portfolio
	err := r.db.QueryRow(ctx,
		`SELECT id, name, description, currency, created_at, updated_at FROM portfolios WHERE id = $1`, id).
		Scan(&p.ID, &p.Name, &p.Description, &p.Currency, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("get portfolio %d: %w", id, err)
	}
	return &p, nil
}

func (r *PortfolioRepo) Create(ctx context.Context, name, description, currency string) (*models.Portfolio, error) {
	var p models.Portfolio
	err := r.db.QueryRow(ctx,
		`INSERT INTO portfolios (name, description, currency)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, description, currency, created_at, updated_at`,
		name, description, currency).
		Scan(&p.ID, &p.Name, &p.Description, &p.Currency, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("create portfolio: %w", err)
	}
	return &p, nil
}

func (r *PortfolioRepo) Delete(ctx context.Context, id int64) error {
	tag, err := r.db.Exec(ctx, `DELETE FROM portfolios WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("delete portfolio %d: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("portfolio %d not found", id)
	}
	return nil
}

// Positions

func (r *PortfolioRepo) ListPositions(ctx context.Context, portfolioID int64) ([]models.Position, error) {
	rows, err := r.db.Query(ctx,
		`SELECT portfolio_id, symbol, weight, updated_at
		 FROM portfolio_positions WHERE portfolio_id = $1 ORDER BY symbol`, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var out []models.Position
	for rows.Next() {
		var p models.Position
		if err := rows.Scan(&p.PortfolioID, &p.Symbol, &p.Weight, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan position: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PortfolioRepo) UpsertPosition(ctx context.Context, portfolioID int64, symbol string, weight float64) (*models.Position, error) {
	var p models.Position
	err := r.db.QueryRow(ctx,
		`INSERT INTO portfolio_positions (portfolio_id, symbol, weight)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
		   weight = EXCLUDED.weight, updated_at = NOW()
		 RETURNING portfolio_id, symbol, weight, updated_at`,
		portfolioID, symbol, weight).
		Scan(&p.PortfolioID, &p.Symbol, &p.Weight, &p.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("upsert position: %w", err)
	}
	return &p, nil
}

func (r *PortfolioRepo) DeletePosition(ctx context.Context, portfolioID int64, symbol string) error {
	tag, err := r.db.Exec(ctx,
		`DELETE FROM portfolio_positions WHERE portfolio_id = $1 AND symbol = $2`,
		portfolioID, symbol)
	if err != nil {
		return fmt.Errorf("delete position: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("position %s not found in portfolio %d", symbol, portfolioID)
	}
	return nil
}

// Risk results

func (r *PortfolioRepo) LatestRisk(ctx context.Context, portfolioID int64) ([]models.RiskResult, error) {
	rows, err := r.db.Query(ctx,
		`SELECT id, portfolio_id, asof_date::text, horizon_days, alpha, method, metric, value, model_version, created_at
		 FROM risk_results
		 WHERE portfolio_id = $1
		 ORDER BY created_at DESC
		 LIMIT 10`, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("latest risk: %w", err)
	}
	defer rows.Close()

	var out []models.RiskResult
	for rows.Next() {
		var rr models.RiskResult
		if err := rows.Scan(&rr.ID, &rr.PortfolioID, &rr.AsofDate, &rr.HorizonDays,
			&rr.Alpha, &rr.Method, &rr.Metric, &rr.Value, &rr.ModelVersion, &rr.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan risk result: %w", err)
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}

func (r *PortfolioRepo) RiskHistory(ctx context.Context, portfolioID int64, limit int) ([]models.RiskResult, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.Query(ctx,
		`SELECT id, portfolio_id, asof_date::text, horizon_days, alpha, method, metric, value, model_version, created_at
		 FROM risk_results
		 WHERE portfolio_id = $1
		 ORDER BY created_at DESC
		 LIMIT $2`, portfolioID, limit)
	if err != nil {
		return nil, fmt.Errorf("risk history: %w", err)
	}
	defer rows.Close()

	var out []models.RiskResult
	for rows.Next() {
		var rr models.RiskResult
		if err := rows.Scan(&rr.ID, &rr.PortfolioID, &rr.AsofDate, &rr.HorizonDays,
			&rr.Alpha, &rr.Method, &rr.Metric, &rr.Value, &rr.ModelVersion, &rr.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan risk result: %w", err)
		}
		out = append(out, rr)
	}
	return out, rows.Err()
}
