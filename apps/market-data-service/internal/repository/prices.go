package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/khadzakos/riskops/pkg/models"
)

type PricesRepo struct {
	db *pgxpool.Pool
}

func NewPricesRepo(db *pgxpool.Pool) *PricesRepo {
	return &PricesRepo{db: db}
}

func (r *PricesRepo) UpsertPrices(ctx context.Context, prices []models.RawPrice) (int, error) {
	if len(prices) == 0 {
		return 0, nil
	}

	const batchSize = 500
	total := 0

	for i := 0; i < len(prices); i += batchSize {
		end := i + batchSize
		if end > len(prices) {
			end = len(prices)
		}
		batch := prices[i:end]

		n, err := r.upsertBatch(ctx, batch)
		if err != nil {
			return total, err
		}
		total += n
	}

	return total, nil
}

func (r *PricesRepo) upsertBatch(ctx context.Context, prices []models.RawPrice) (int, error) {
	// Build multi-row INSERT ... ON CONFLICT DO UPDATE
	placeholders := make([]string, 0, len(prices))
	args := make([]interface{}, 0, len(prices)*5)
	idx := 1

	for _, p := range prices {
		placeholders = append(placeholders,
			fmt.Sprintf("($%d, $%d, $%d, $%d, $%d)", idx, idx+1, idx+2, idx+3, idx+4))
		args = append(args, p.Symbol, p.PriceDate, p.Close, p.Currency, p.Source)
		idx += 5
	}

	query := fmt.Sprintf(`
		INSERT INTO raw_prices (symbol, price_date, close, currency, source)
		VALUES %s
		ON CONFLICT (symbol, price_date) DO UPDATE SET
			close = EXCLUDED.close,
			currency = EXCLUDED.currency,
			source = EXCLUDED.source,
			ingested_at = NOW()`,
		strings.Join(placeholders, ", "))

	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("upsert prices batch: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *PricesRepo) GetPrices(ctx context.Context, symbols []string, dateFrom, dateTo, source string, limit int) ([]models.RawPrice, error) {
	if limit <= 0 {
		limit = 1000
	}

	conditions := []string{}
	args := []interface{}{}
	idx := 1

	if len(symbols) > 0 {
		conditions = append(conditions, fmt.Sprintf("symbol = ANY($%d)", idx))
		args = append(args, symbols)
		idx++
	}
	if dateFrom != "" {
		conditions = append(conditions, fmt.Sprintf("price_date >= $%d", idx))
		args = append(args, dateFrom)
		idx++
	}
	if dateTo != "" {
		conditions = append(conditions, fmt.Sprintf("price_date <= $%d", idx))
		args = append(args, dateTo)
		idx++
	}
	if source != "" {
		conditions = append(conditions, fmt.Sprintf("source = $%d", idx))
		args = append(args, source)
		idx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT symbol, price_date, close, currency, source, ingested_at
		FROM raw_prices
		%s
		ORDER BY symbol, price_date DESC
		LIMIT $%d`, where, idx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get prices: %w", err)
	}
	defer rows.Close()

	var out []models.RawPrice
	for rows.Next() {
		var p models.RawPrice
		if err := rows.Scan(&p.Symbol, &p.PriceDate, &p.Close, &p.Currency, &p.Source, &p.IngestedAt); err != nil {
			return nil, fmt.Errorf("scan price: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetPricesAsc returns prices in ascending date order (oldest first).
// Unlike GetPrices (which orders DESC), this is suitable for chart rendering
// where data must be chronologically ordered. Each symbol is fetched with its
// own per-symbol limit to avoid cross-symbol truncation.
func (r *PricesRepo) GetPricesAsc(ctx context.Context, symbols []string, dateFrom, dateTo, source string, limit int) ([]models.RawPrice, error) {
	if limit <= 0 {
		limit = 3000
	}

	conditions := []string{}
	args := []interface{}{}
	idx := 1

	if len(symbols) > 0 {
		conditions = append(conditions, fmt.Sprintf("symbol = ANY($%d)", idx))
		args = append(args, symbols)
		idx++
	}
	if dateFrom != "" {
		conditions = append(conditions, fmt.Sprintf("price_date >= $%d", idx))
		args = append(args, dateFrom)
		idx++
	}
	if dateTo != "" {
		conditions = append(conditions, fmt.Sprintf("price_date <= $%d", idx))
		args = append(args, dateTo)
		idx++
	}
	if source != "" {
		conditions = append(conditions, fmt.Sprintf("source = $%d", idx))
		args = append(args, source)
		idx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT symbol, price_date, close, currency, source, ingested_at
		FROM raw_prices
		%s
		ORDER BY symbol, price_date ASC
		LIMIT $%d`, where, idx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get prices asc: %w", err)
	}
	defer rows.Close()

	var out []models.RawPrice
	for rows.Next() {
		var p models.RawPrice
		if err := rows.Scan(&p.Symbol, &p.PriceDate, &p.Close, &p.Currency, &p.Source, &p.IngestedAt); err != nil {
			return nil, fmt.Errorf("scan price: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// GetLatestPrice returns the most recent close price for a symbol.
func (r *PricesRepo) GetLatestPrice(ctx context.Context, symbol string) (float64, error) {
	var close float64
	err := r.db.QueryRow(ctx,
		`SELECT close FROM raw_prices WHERE symbol = $1 ORDER BY price_date DESC LIMIT 1`,
		symbol).Scan(&close)
	if err != nil {
		return 0, fmt.Errorf("get latest price for %s: %w", symbol, err)
	}
	return close, nil
}

func (r *PricesRepo) UpsertReturns(ctx context.Context, returns []models.ProcessedReturn) (int, error) {
	if len(returns) == 0 {
		return 0, nil
	}

	const batchSize = 500
	total := 0

	for i := 0; i < len(returns); i += batchSize {
		end := i + batchSize
		if end > len(returns) {
			end = len(returns)
		}
		batch := returns[i:end]

		n, err := r.upsertReturnsBatch(ctx, batch)
		if err != nil {
			return total, err
		}
		total += n
	}

	return total, nil
}

func (r *PricesRepo) upsertReturnsBatch(ctx context.Context, returns []models.ProcessedReturn) (int, error) {
	placeholders := make([]string, 0, len(returns))
	args := make([]interface{}, 0, len(returns)*3)
	idx := 1

	for _, ret := range returns {
		placeholders = append(placeholders,
			fmt.Sprintf("($%d, $%d, $%d)", idx, idx+1, idx+2))
		args = append(args, ret.Symbol, ret.PriceDate, ret.Ret)
		idx += 3
	}

	query := fmt.Sprintf(`
		INSERT INTO processed_returns (symbol, price_date, ret)
		VALUES %s
		ON CONFLICT (symbol, price_date) DO UPDATE SET
			ret = EXCLUDED.ret,
			computed_at = NOW()`,
		strings.Join(placeholders, ", "))

	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("upsert returns batch: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *PricesRepo) GetReturns(ctx context.Context, symbols []string, dateFrom, dateTo string, limit int) ([]models.ProcessedReturn, error) {
	if limit <= 0 {
		limit = 1000
	}

	conditions := []string{}
	args := []interface{}{}
	idx := 1

	if len(symbols) > 0 {
		conditions = append(conditions, fmt.Sprintf("symbol = ANY($%d)", idx))
		args = append(args, symbols)
		idx++
	}
	if dateFrom != "" {
		conditions = append(conditions, fmt.Sprintf("price_date >= $%d", idx))
		args = append(args, dateFrom)
		idx++
	}
	if dateTo != "" {
		conditions = append(conditions, fmt.Sprintf("price_date <= $%d", idx))
		args = append(args, dateTo)
		idx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT symbol, price_date, ret, computed_at
		FROM processed_returns
		%s
		ORDER BY symbol, price_date DESC
		LIMIT $%d`, where, idx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get returns: %w", err)
	}
	defer rows.Close()

	var out []models.ProcessedReturn
	for rows.Next() {
		var ret models.ProcessedReturn
		if err := rows.Scan(&ret.Symbol, &ret.PriceDate, &ret.Ret, &ret.ComputedAt); err != nil {
			return nil, fmt.Errorf("scan return: %w", err)
		}
		out = append(out, ret)
	}
	return out, rows.Err()
}

func (r *PricesRepo) GetPricesForReturns(ctx context.Context, symbol string) ([]models.RawPrice, error) {
	rows, err := r.db.Query(ctx,
		`SELECT symbol, price_date, close, currency, source, ingested_at
		 FROM raw_prices
		 WHERE symbol = $1
		 ORDER BY price_date ASC`, symbol)
	if err != nil {
		return nil, fmt.Errorf("get prices for returns %s: %w", symbol, err)
	}
	defer rows.Close()

	var out []models.RawPrice
	for rows.Next() {
		var p models.RawPrice
		if err := rows.Scan(&p.Symbol, &p.PriceDate, &p.Close, &p.Currency, &p.Source, &p.IngestedAt); err != nil {
			return nil, fmt.Errorf("scan price: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (r *PricesRepo) GetDistinctSymbols(ctx context.Context) ([]string, error) {
	rows, err := r.db.Query(ctx, `SELECT DISTINCT symbol FROM raw_prices ORDER BY symbol`)
	if err != nil {
		return nil, fmt.Errorf("get distinct symbols: %w", err)
	}
	defer rows.Close()

	var symbols []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		symbols = append(symbols, s)
	}
	return symbols, rows.Err()
}
