package handler

// PriceChartHandler provides a unified multi-asset price chart endpoint.
// Returns normalized price series (base 100) for all requested symbols,
// suitable for overlaying on a single chart in the frontend.

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"go.uber.org/zap"
)

// PriceChartHandler handles the unified price chart endpoint.
type PriceChartHandler struct {
	pricesRepo *repository.PricesRepo
	log        *zap.Logger
}

// NewPriceChartHandler creates a new PriceChartHandler.
func NewPriceChartHandler(pricesRepo *repository.PricesRepo, log *zap.Logger) *PriceChartHandler {
	return &PriceChartHandler{pricesRepo: pricesRepo, log: log}
}

// PricePoint is a single date+value pair in a price series.
type PricePoint struct {
	Date  string  `json:"date"`
	Value float64 `json:"value"` // normalized to base 100 at first observation
	Raw   float64 `json:"raw"`   // original close price
}

// AssetPriceSeries holds the normalized price history for one asset.
type AssetPriceSeries struct {
	Symbol   string       `json:"symbol"`
	Currency string       `json:"currency"`
	Source   string       `json:"source"`
	Points   []PricePoint `json:"points"`
}

// PriceChartResponse is the response for GET /api/market-data/prices/chart
type PriceChartResponse struct {
	Symbols    []string           `json:"symbols"`
	DateFrom   string             `json:"date_from"`
	DateTo     string             `json:"date_to"`
	Series     []AssetPriceSeries `json:"series"`
	Normalized bool               `json:"normalized"` // true = base-100 normalized
}

// HandlePriceChart handles GET /api/market-data/prices/chart
// Query params:
//   - symbols: comma-separated list of tickers (required)
//   - date_from: YYYY-MM-DD (optional, default: 1 year ago)
//   - date_to: YYYY-MM-DD (optional, default: today)
//   - normalized: bool (optional, default: true) — normalize to base 100
func (h *PriceChartHandler) HandlePriceChart(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()

	symbolsParam := q.Get("symbols")
	if symbolsParam == "" {
		http.Error(w, `{"error":"symbols parameter is required"}`, http.StatusBadRequest)
		return
	}

	symbols := []string{}
	for _, s := range strings.Split(symbolsParam, ",") {
		s = strings.TrimSpace(s)
		if s != "" {
			symbols = append(symbols, s)
		}
	}
	if len(symbols) == 0 {
		http.Error(w, `{"error":"at least one symbol required"}`, http.StatusBadRequest)
		return
	}

	dateFrom := q.Get("date_from")
	dateTo := q.Get("date_to")
	if dateFrom == "" {
		dateFrom = time.Now().AddDate(-1, 0, 0).Format("2006-01-02")
	}
	if dateTo == "" {
		dateTo = time.Now().Format("2006-01-02")
	}

	normalized := true
	if q.Get("normalized") == "false" {
		normalized = false
	}

	// Fetch raw prices per symbol individually to avoid cross-symbol LIMIT truncation.
	// Each symbol gets its own query with no artificial cap, ensuring all date points
	// are returned regardless of how many symbols are in the portfolio.
	type priceEntry struct {
		date     string
		close    float64
		currency string
		source   string
	}
	bySymbol := make(map[string][]priceEntry)
	currencyBySymbol := make(map[string]string)
	sourceBySymbol := make(map[string]string)

	for _, sym := range symbols {
		// Fetch per-symbol with a generous per-symbol limit (10 years × 260 trading days)
		symPrices, err := h.pricesRepo.GetPricesAsc(r.Context(), []string{sym}, dateFrom, dateTo, "", 3000)
		if err != nil {
			h.log.Error("price chart: get prices failed", zap.String("symbol", sym), zap.Error(err))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusInternalServerError)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
			return
		}
		for _, p := range symPrices {
			dateStr := p.PriceDate.Format("2006-01-02")
			bySymbol[p.Symbol] = append(bySymbol[p.Symbol], priceEntry{
				date:     dateStr,
				close:    p.Close,
				currency: p.Currency,
				source:   p.Source,
			})
			currencyBySymbol[p.Symbol] = p.Currency
			sourceBySymbol[p.Symbol] = p.Source
		}
	}

	// Build series — data already comes ASC from GetPricesAsc
	var series []AssetPriceSeries
	for _, sym := range symbols {
		entries, ok := bySymbol[sym]
		if !ok || len(entries) == 0 {
			h.log.Warn("price chart: no data for symbol", zap.String("symbol", sym))
			continue
		}

		// Deduplicate by date — keep the last entry per date to avoid spikes from
		// duplicate ingestion records (e.g. same date ingested from multiple sources).
		seen := make(map[string]int, len(entries))
		deduped := make([]priceEntry, 0, len(entries))
		for _, e := range entries {
			if idx, exists := seen[e.date]; exists {
				deduped[idx] = e // overwrite with latest
			} else {
				seen[e.date] = len(deduped)
				deduped = append(deduped, e)
			}
		}
		entries = deduped

		points := make([]PricePoint, 0, len(entries))
		basePrice := entries[0].close
		if basePrice == 0 {
			basePrice = 1.0
		}

		for _, e := range entries {
			if e.close <= 0 {
				// Skip zero/negative prices — they are data artifacts
				continue
			}
			var normValue float64
			if normalized {
				normValue = (e.close / basePrice) * 100.0
			} else {
				normValue = e.close
			}
			points = append(points, PricePoint{
				Date:  e.date,
				Value: normValue,
				Raw:   e.close,
			})
		}

		series = append(series, AssetPriceSeries{
			Symbol:   sym,
			Currency: currencyBySymbol[sym],
			Source:   sourceBySymbol[sym],
			Points:   points,
		})
	}

	resp := PriceChartResponse{
		Symbols:    symbols,
		DateFrom:   dateFrom,
		DateTo:     dateTo,
		Series:     series,
		Normalized: normalized,
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}
