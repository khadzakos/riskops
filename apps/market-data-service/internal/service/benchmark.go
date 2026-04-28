package service

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// BenchmarkSymbols is the list of benchmark tickers that are always kept
// up-to-date in the database.  SPY is the primary US equity benchmark used
// for beta computation in the inference service.
// The full US and RU ticker lists (USTickerList / RUTickerList) are used at
// startup via EnsureBenchmarkData so that backtesting has ≥10 years of data
// for every symbol without waiting for a manual bulk-historical ingest.
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

// EnsureBenchmarkData makes sure that at least 10 years of daily price data
// exist for the core benchmark symbols (SPY, ^GSPC) as well as all symbols in
// USTickerList and RUTickerList.  It is called once at service startup so that
// backtesting has sufficient history (≥312 trading days) from the very first
// run without waiting for a manual bulk-historical ingest.
//
// The function is intentionally non-fatal: if Yahoo Finance / MOEX is
// unreachable the service still starts normally.
func (s *IngestService) EnsureBenchmarkData(ctx context.Context) {
	dateTo := time.Now()
	dateFrom := dateTo.AddDate(-10, 0, 0) // 10 years back

	// Deduplicate: core benchmarks + full US list + full RU list
	seen := make(map[string]struct{})
	var allSymbols []string
	for _, sym := range append(append(BenchmarkSymbols, USTickerList...), RUTickerList...) {
		if _, ok := seen[sym]; !ok {
			seen[sym] = struct{}{}
			allSymbols = append(allSymbols, sym)
		}
	}

	s.log.Info("ensuring 10-year market data for all symbols",
		zap.Int("total_symbols", len(allSymbols)),
		zap.Time("date_from", dateFrom),
	)

	// US symbols via Yahoo Finance
	var usSymbols, ruSymbols []string
	for _, sym := range allSymbols {
		if isMOEXSymbol(sym) {
			ruSymbols = append(ruSymbols, sym)
		} else {
			usSymbols = append(usSymbols, sym)
		}
	}

	if len(usSymbols) > 0 {
		res := s.ingestSymbolBatches(ctx, "yahoo", usSymbols, dateFrom, dateTo, 10)
		s.log.Info("startup US data ensured",
			zap.Int("ok", res.SymbolsOK),
			zap.Int("failed", res.SymbolsFailed),
			zap.Int("rows", res.RowsIngested),
		)
	}

	if len(ruSymbols) > 0 {
		res := s.ingestSymbolBatches(ctx, "moex", ruSymbols, dateFrom, dateTo, 10)
		s.log.Info("startup RU data ensured",
			zap.Int("ok", res.SymbolsOK),
			zap.Int("failed", res.SymbolsFailed),
			zap.Int("rows", res.RowsIngested),
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
