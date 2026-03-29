//go:build integration

package collector_test

import (
	"context"
	"testing"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/collector"
)

// TestYahooCollector_RealAPI makes a live call to Yahoo Finance v8 API.
// Run with: go test -tags=integration -v ./apps/market-data-service/internal/collector/ -run TestYahoo
func TestYahooCollector_RealAPI(t *testing.T) {
	c := collector.NewYahooCollector()

	if c.Name() != "yahoo" {
		t.Fatalf("expected name 'yahoo', got %q", c.Name())
	}

	types := c.SupportedTypes()
	if len(types) == 0 || types[0] != collector.DataTypeMarketPrice {
		t.Fatalf("expected SupportedTypes to include DataTypeMarketPrice, got %v", types)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Fetch 5 trading days of AAPL data
	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -7) // 7 calendar days → ~5 trading days

	req := collector.CollectRequest{
		Symbols:  []string{"AAPL"},
		DateFrom: dateFrom,
		DateTo:   dateTo,
		DataType: collector.DataTypeMarketPrice,
	}

	result, err := c.Collect(ctx, req)
	if err != nil {
		t.Fatalf("Collect failed: %v", err)
	}

	t.Logf("Yahoo Finance: source=%s, data_type=%s, rows=%d", result.Source, result.DataType, result.RowCount)

	if result.Source != "yahoo" {
		t.Errorf("expected source 'yahoo', got %q", result.Source)
	}
	if result.DataType != collector.DataTypeMarketPrice {
		t.Errorf("expected data_type market_price, got %q", result.DataType)
	}
	if result.RowCount == 0 {
		t.Error("expected at least one price record, got 0")
	}
	if len(result.Prices) != result.RowCount {
		t.Errorf("RowCount=%d but len(Prices)=%d", result.RowCount, len(result.Prices))
	}

	for i, p := range result.Prices {
		if p.Symbol != "AAPL" {
			t.Errorf("row %d: expected symbol AAPL, got %q", i, p.Symbol)
		}
		if p.Close <= 0 {
			t.Errorf("row %d: close price must be positive, got %f", i, p.Close)
		}
		if p.PriceDate == "" {
			t.Errorf("row %d: price_date is empty", i)
		}
		if p.Source != "yahoo" {
			t.Errorf("row %d: expected source 'yahoo', got %q", i, p.Source)
		}
		t.Logf("  %s  close=%.2f  currency=%s", p.PriceDate, p.Close, p.Currency)
	}
}

// TestYahooCollector_MultipleSymbols tests fetching multiple symbols at once.
func TestYahooCollector_MultipleSymbols(t *testing.T) {
	c := collector.NewYahooCollector()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -14)

	symbols := []string{"AAPL", "MSFT", "GOOGL"}
	req := collector.CollectRequest{
		Symbols:  symbols,
		DateFrom: dateFrom,
		DateTo:   dateTo,
		DataType: collector.DataTypeMarketPrice,
	}

	result, err := c.Collect(ctx, req)
	if err != nil {
		t.Fatalf("Collect failed: %v", err)
	}

	t.Logf("Yahoo Finance multi-symbol: rows=%d", result.RowCount)

	// Verify we got data for each symbol
	symbolCounts := make(map[string]int)
	for _, p := range result.Prices {
		symbolCounts[p.Symbol]++
	}

	for _, sym := range symbols {
		count := symbolCounts[sym]
		if count == 0 {
			t.Errorf("no data returned for symbol %s", sym)
		} else {
			t.Logf("  %s: %d rows", sym, count)
		}
	}
}

// TestYahooCollector_InvalidSymbol verifies error handling for unknown symbols.
func TestYahooCollector_InvalidSymbol(t *testing.T) {
	c := collector.NewYahooCollector()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	req := collector.CollectRequest{
		Symbols:  []string{"INVALID_TICKER_XYZ_999"},
		DateFrom: time.Now().AddDate(0, 0, -7),
		DateTo:   time.Now(),
		DataType: collector.DataTypeMarketPrice,
	}

	_, err := c.Collect(ctx, req)
	if err == nil {
		t.Log("Note: Yahoo Finance returned no error for invalid symbol (may return empty data)")
	} else {
		t.Logf("Got expected error for invalid symbol: %v", err)
	}
}

// TestYahooCollector_NoSymbols verifies validation.
func TestYahooCollector_NoSymbols(t *testing.T) {
	c := collector.NewYahooCollector()

	ctx := context.Background()
	req := collector.CollectRequest{
		Symbols:  []string{},
		DateFrom: time.Now().AddDate(0, 0, -7),
		DateTo:   time.Now(),
	}

	_, err := c.Collect(ctx, req)
	if err == nil {
		t.Error("expected error for empty symbols, got nil")
	} else {
		t.Logf("Got expected validation error: %v", err)
	}
}
