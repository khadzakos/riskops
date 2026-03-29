package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/khadzakos/riskops/pkg/models"
)

type CreditRepo struct {
	db *pgxpool.Pool
}

func NewCreditRepo(db *pgxpool.Pool) *CreditRepo {
	return &CreditRepo{db: db}
}

func (r *CreditRepo) UpsertCredit(ctx context.Context, records []models.CreditRecord) (int, error) {
	if len(records) == 0 {
		return 0, nil
	}

	const batchSize = 200
	total := 0

	for i := 0; i < len(records); i += batchSize {
		end := i + batchSize
		if end > len(records) {
			end = len(records)
		}
		n, err := r.upsertBatch(ctx, records[i:end])
		if err != nil {
			return total, err
		}
		total += n
	}

	return total, nil
}

func (r *CreditRepo) upsertBatch(ctx context.Context, records []models.CreditRecord) (int, error) {
	placeholders := make([]string, 0, len(records))
	args := make([]interface{}, 0, len(records)*13)
	idx := 1

	for _, rec := range records {
		placeholders = append(placeholders, fmt.Sprintf(
			"($%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d,$%d)",
			idx, idx+1, idx+2, idx+3, idx+4, idx+5, idx+6,
			idx+7, idx+8, idx+9, idx+10, idx+11, idx+12,
		))
		args = append(args,
			rec.LoanID, rec.BorrowerID, rec.LoanAmount, rec.InterestRate,
			rec.TermMonths, rec.CreditScore, rec.LTVRatio, rec.DTIRatio,
			rec.IsDefault, rec.DefaultDate, rec.OriginationDate, rec.Sector, rec.Source,
		)
		idx += 13
	}

	query := fmt.Sprintf(`
		INSERT INTO credit_data (
			loan_id, borrower_id, loan_amount, interest_rate,
			term_months, credit_score, ltv_ratio, dti_ratio,
			is_default, default_date, origination_date, sector, source
		) VALUES %s
		ON CONFLICT (loan_id) DO UPDATE SET
			borrower_id      = EXCLUDED.borrower_id,
			loan_amount      = EXCLUDED.loan_amount,
			interest_rate    = EXCLUDED.interest_rate,
			term_months      = EXCLUDED.term_months,
			credit_score     = EXCLUDED.credit_score,
			ltv_ratio        = EXCLUDED.ltv_ratio,
			dti_ratio        = EXCLUDED.dti_ratio,
			is_default       = EXCLUDED.is_default,
			default_date     = EXCLUDED.default_date,
			origination_date = EXCLUDED.origination_date,
			sector           = EXCLUDED.sector,
			source           = EXCLUDED.source,
			ingested_at      = NOW()`,
		strings.Join(placeholders, ", "))

	tag, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return 0, fmt.Errorf("upsert credit batch: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (r *CreditRepo) GetCredit(ctx context.Context, source string, isDefault *bool, limit int) ([]models.CreditRecord, error) {
	if limit <= 0 {
		limit = 1000
	}

	conditions := []string{}
	args := []interface{}{}
	idx := 1

	if source != "" {
		conditions = append(conditions, fmt.Sprintf("source = $%d", idx))
		args = append(args, source)
		idx++
	}
	if isDefault != nil {
		conditions = append(conditions, fmt.Sprintf("is_default = $%d", idx))
		args = append(args, *isDefault)
		idx++
	}

	where := ""
	if len(conditions) > 0 {
		where = "WHERE " + strings.Join(conditions, " AND ")
	}

	args = append(args, limit)
	query := fmt.Sprintf(`
		SELECT id, loan_id, borrower_id, loan_amount, interest_rate,
		       term_months, credit_score, ltv_ratio, dti_ratio,
		       is_default, default_date, origination_date, sector, source, ingested_at
		FROM credit_data
		%s
		ORDER BY id DESC
		LIMIT $%d`, where, idx)

	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get credit: %w", err)
	}
	defer rows.Close()

	var out []models.CreditRecord
	for rows.Next() {
		var rec models.CreditRecord
		if err := rows.Scan(
			&rec.ID, &rec.LoanID, &rec.BorrowerID, &rec.LoanAmount, &rec.InterestRate,
			&rec.TermMonths, &rec.CreditScore, &rec.LTVRatio, &rec.DTIRatio,
			&rec.IsDefault, &rec.DefaultDate, &rec.OriginationDate, &rec.Sector, &rec.Source, &rec.IngestedAt,
		); err != nil {
			return nil, fmt.Errorf("scan credit record: %w", err)
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}
