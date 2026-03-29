//go:build integration

package collector_test

import (
	"context"
	"testing"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/collector"
)

// TestMOEXCollector_RealAPI makes a live call to MOEX ISS API.
// Run with: go test -tags=integration -v ./apps/market-data-service/internal/collector/ -run TestMOEX
func TestMOEXCollector_RealAPI(t *testing.T) {
	c := collector.NewMOEXCollector()

	if c.Name() != "moex" {
		t.Fatalf("expected name 'moex', got %q", c.Name())
	}

	types := c.SupportedTypes()
	if len(types) == 0 || types[0] != collector.DataTypeMarketPrice {
		t.Fatalf("expected SupportedTypes to include DataTypeMarketPrice, got %v", types)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	// Fetch ~2 weeks of SBER (Sberbank) data — most liquid Russian stock
	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -14)

	req := collector.CollectRequest{
		Symbols:  []string{"SBER"},
		DateFrom: dateFrom,
		DateTo:   dateTo,
		DataType: collector.DataTypeMarketPrice,
	}

	result, err := c.Collect(ctx, req)
	if err != nil {
		t.Fatalf("Collect failed: %v", err)
	}

	t.Logf("MOEX ISS: source=%s, data_type=%s, rows=%d", result.Source, result.DataType, result.RowCount)

	if result.Source != "moex" {
		t.Errorf("expected source 'moex', got %q", result.Source)
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
		if p.Symbol != "SBER" {
			t.Errorf("row %d: expected symbol SBER, got %q", i, p.Symbol)
		}
		if p.Close <= 0 {
			t.Errorf("row %d: close price must be positive, got %f", i, p.Close)
		}
		if p.PriceDate == "" {
			t.Errorf("row %d: price_date is empty", i)
		}
		if p.Currency != "RUB" {
			t.Errorf("row %d: expected currency RUB, got %q", i, p.Currency)
		}
		if p.Source != "moex" {
			t.Errorf("row %d: expected source 'moex', got %q", i, p.Source)
		}
		t.Logf("  %s  close=%.2f  currency=%s", p.PriceDate, p.Close, p.Currency)
	}
}

// TestMOEXCollector_MultipleSymbols tests fetching multiple Russian blue chips.
func TestMOEXCollector_MultipleSymbols(t *testing.T) {
	c := collector.NewMOEXCollector()

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -14)

	// SBER=Sberbank, GAZP=Gazprom, LKOH=Lukoil
	symbols := []string{"SBER", "GAZP", "LKOH"}
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

	t.Logf("MOEX ISS multi-symbol: rows=%d", result.RowCount)

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

// TestMOEXCollector_LongerHistory tests pagination by fetching 6 months of data
// (MOEX ISS returns max 100 rows per page, so this exercises the pagination loop).
func TestMOEXCollector_LongerHistory(t *testing.T) {
	c := collector.NewMOEXCollector()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, -6, 0) // 6 months ≈ 130 trading days → requires pagination

	req := collector.CollectRequest{
		Symbols:  []string{"SBER"},
		DateFrom: dateFrom,
		DateTo:   dateTo,
		DataType: collector.DataTypeMarketPrice,
	}

	result, err := c.Collect(ctx, req)
	if err != nil {
		t.Fatalf("Collect failed: %v", err)
	}

	t.Logf("MOEX ISS 6-month history: rows=%d", result.RowCount)

	// 6 months should yield ~130 trading days
	if result.RowCount < 100 {
		t.Errorf("expected at least 100 rows for 6-month history, got %d", result.RowCount)
	}

	// Verify dates are in ascending order
	for i := 1; i < len(result.Prices); i++ {
		if result.Prices[i].PriceDate < result.Prices[i-1].PriceDate {
			t.Errorf("prices not in ascending date order at index %d: %s < %s",
				i, result.Prices[i].PriceDate, result.Prices[i-1].PriceDate)
			break
		}
	}
}

// TestMOEXCollector_NoSymbols verifies validation.
func TestMOEXCollector_NoSymbols(t *testing.T) {
	c := collector.NewMOEXCollector()

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
