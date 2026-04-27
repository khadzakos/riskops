package service

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// BenchmarkSymbols is the list of benchmark tickers that are always kept
// up-to-date in the database.  SPY is the primary US equity benchmark used
// for beta computation in the inference service.
var BenchmarkSymbols = []string{"SPY", "^GSPC"}

// EnsureBenchmarkData makes sure that at least 2 years of daily price data
// exist for every benchmark symbol.  It is called once at service startup so
// that beta can always be computed even before the first bulk-historical ingest.
//
// The function is intentionally non-fatal: if Yahoo Finance is unreachable the
// service still starts normally; beta will simply be nil until data arrives.
func (s *IngestService) EnsureBenchmarkData(ctx context.Context) {
	dateTo := time.Now()
	dateFrom := dateTo.AddDate(-2, 0, 0) // 2 years back

	s.log.Info("ensuring benchmark data",
		zap.Strings("symbols", BenchmarkSymbols),
		zap.Time("date_from", dateFrom),
	)

	for _, sym := range BenchmarkSymbols {
		select {
		case <-ctx.Done():
			return
		default:
		}

		req := IngestRequest{
			Source:   "yahoo",
			Symbols:  []string{sym},
			DateFrom: dateFrom,
			DateTo:   dateTo,
		}
		result, err := s.Ingest(ctx, req)
		if err != nil {
			s.log.Warn("benchmark ingest error (non-fatal)",
				zap.String("symbol", sym),
				zap.Error(err),
			)
			continue
		}
		s.log.Info("benchmark data ensured",
			zap.String("symbol", sym),
			zap.Int("rows", result.RowsIngested),
			zap.String("status", result.Status),
		)
	}
}
