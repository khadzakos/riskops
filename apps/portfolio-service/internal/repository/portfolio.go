package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
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
	// Join with raw_prices to get the latest market price for each symbol.
	// DISTINCT ON (pp.symbol) with ORDER BY price_date DESC picks the most recent price.
	rows, err := r.db.Query(ctx,
		`SELECT pp.portfolio_id, pp.symbol, pp.weight, pp.quantity, pp.price, pp.updated_at,
		        COALESCE(rp.close, 0) AS current_price
		 FROM portfolio_positions pp
		 LEFT JOIN LATERAL (
		     SELECT close FROM raw_prices
		     WHERE symbol = pp.symbol
		     ORDER BY price_date DESC
		     LIMIT 1
		 ) rp ON true
		 WHERE pp.portfolio_id = $1
		 ORDER BY pp.symbol`, portfolioID)
	if err != nil {
		return nil, fmt.Errorf("list positions: %w", err)
	}
	defer rows.Close()

	var out []models.Position
	for rows.Next() {
		var p models.Position
		if err := rows.Scan(&p.PortfolioID, &p.Symbol, &p.Weight, &p.Quantity, &p.Price, &p.UpdatedAt, &p.CurrentPrice); err != nil {
			return nil, fmt.Errorf("scan position: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetLatestMarketPrice returns the most recent close price for a symbol from raw_prices.
// Returns 0 and no error if no price data is available.
func (r *PortfolioRepo) GetLatestMarketPrice(ctx context.Context, symbol string) (float64, error) {
	var close float64
	err := r.db.QueryRow(ctx,
		`SELECT close FROM raw_prices WHERE symbol = $1 ORDER BY price_date DESC LIMIT 1`,
		symbol).Scan(&close)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("get latest market price for %s: %w", symbol, err)
	}
	return close, nil
}

// UpsertPosition inserts or updates a position.
//
// If quantity > 0 and price > 0, the weight is computed as quantity*price and
// then all positions in the portfolio are renormalized so that weights sum to 1.
// If quantity == 0 (legacy / explicit weight mode), the provided weight is stored
// directly without renormalization.
func (r *PortfolioRepo) UpsertPosition(ctx context.Context, portfolioID int64, symbol string, quantity, price, weight float64) (*models.Position, error) {
	// Determine raw weight for this position
	rawWeight := weight
	if quantity > 0 && price > 0 {
		rawWeight = quantity * price
	}

	// Upsert the position with the raw weight value
	_, err := r.db.Exec(ctx,
		`INSERT INTO portfolio_positions (portfolio_id, symbol, weight, quantity, price)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT (portfolio_id, symbol) DO UPDATE SET
		   weight = EXCLUDED.weight,
		   quantity = EXCLUDED.quantity,
		   price = EXCLUDED.price,
		   updated_at = NOW()`,
		portfolioID, symbol, rawWeight, quantity, price)
	if err != nil {
		return nil, fmt.Errorf("upsert position: %w", err)
	}

	// Renormalize all positions in the portfolio when using quantity-based mode
	if quantity > 0 && price > 0 {
		if err := r.renormalizeWeights(ctx, portfolioID); err != nil {
			return nil, fmt.Errorf("renormalize weights: %w", err)
		}
	}

	// Return the updated position with current market price
	var p models.Position
	err = r.db.QueryRow(ctx,
		`SELECT pp.portfolio_id, pp.symbol, pp.weight, pp.quantity, pp.price, pp.updated_at,
		        COALESCE(rp.close, 0) AS current_price
		 FROM portfolio_positions pp
		 LEFT JOIN LATERAL (
		     SELECT close FROM raw_prices
		     WHERE symbol = pp.symbol
		     ORDER BY price_date DESC
		     LIMIT 1
		 ) rp ON true
		 WHERE pp.portfolio_id = $1 AND pp.symbol = $2`,
		portfolioID, symbol).
		Scan(&p.PortfolioID, &p.Symbol, &p.Weight, &p.Quantity, &p.Price, &p.UpdatedAt, &p.CurrentPrice)
	if err != nil {
		return nil, fmt.Errorf("fetch upserted position: %w", err)
	}
	return &p, nil
}

// renormalizeWeights rescales all position weights in a portfolio so they sum to 1.0.
// Raw weights (quantity × price) are divided by the total portfolio value.
func (r *PortfolioRepo) renormalizeWeights(ctx context.Context, portfolioID int64) error {
	_, err := r.db.Exec(ctx,
		`UPDATE portfolio_positions pp
		 SET weight = pp.weight / totals.total_weight,
		     updated_at = NOW()
		 FROM (
		     SELECT portfolio_id, SUM(weight) AS total_weight
		     FROM portfolio_positions
		     WHERE portfolio_id = $1
		     GROUP BY portfolio_id
		 ) totals
		 WHERE pp.portfolio_id = totals.portfolio_id
		   AND totals.total_weight > 0`,
		portfolioID)
	return err
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
	// Re-normalize remaining positions so weights still sum to 1.0
	if err := r.renormalizeWeights(ctx, portfolioID); err != nil {
		return fmt.Errorf("renormalize after delete: %w", err)
	}
	return nil
}

// Risk results

func (r *PortfolioRepo) LatestRisk(ctx context.Context, portfolioID int64) ([]models.RiskResult, error) {
	rows, err := r.db.Query(ctx,
		`SELECT DISTINCT ON (metric)
		     id, portfolio_id, asof_date::text, horizon_days, alpha, method, metric, value, model_version, created_at
		 FROM risk_results
		 WHERE portfolio_id = $1
		 ORDER BY metric, created_at DESC`, portfolioID)
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
