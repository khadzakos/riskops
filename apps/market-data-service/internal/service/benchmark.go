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

// FREDSeriesIDs is the list of financially significant FRED series that are
// ingested on startup and kept current.  These cover interest rates, credit
// spreads, macro indicators, and volatility.
var FREDSeriesIDs = []string{
	"DGS10",        // 10-Year Treasury yield
	"DGS2",         // 2-Year Treasury yield
	"FEDFUNDS",     // Federal Funds rate
	"T10Y2Y",       // Yield curve spread (10Y-2Y)
	"BAMLH0A0HYM2", // High-yield credit spread (OAS)
	"VIXCLS",       // CBOE VIX
	"UNRATE",       // Unemployment rate (monthly)
	"CPIAUCSL",     // CPI (monthly)
	"MORTGAGE30US", // 30-year mortgage rate (weekly)
}

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

// EnsureFREDData fetches 5 years of history for all financially significant
// FRED series on startup.  This is intentionally non-fatal — if the FRED API
// is unreachable the service starts normally and FRED data will be absent until
// the next scheduled ingest.
func (s *IngestService) EnsureFREDData(ctx context.Context) {
	dateTo := time.Now()
	dateFrom := dateTo.AddDate(-5, 0, 0) // 5 years back

	s.log.Info("ensuring FRED macro data",
		zap.Strings("series", FREDSeriesIDs),
		zap.Time("date_from", dateFrom),
	)

	req := IngestRequest{
		Source:   "fred",
		Symbols:  FREDSeriesIDs,
		DateFrom: dateFrom,
		DateTo:   dateTo,
	}

	result, err := s.Ingest(ctx, req)
	if err != nil {
		s.log.Warn("FRED ingest error (non-fatal)", zap.Error(err))
		return
	}
	s.log.Info("FRED data ensured",
		zap.Int("rows", result.RowsIngested),
		zap.String("status", result.Status),
	)
}
