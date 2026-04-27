package collector

// FREDCollector fetches economic time-series data from the Federal Reserve
// Economic Data (FRED) API at api.stlouisfed.org.
//
// Financially significant series supported:
//   DGS10        — 10-Year Treasury Constant Maturity Rate
//   DGS2         — 2-Year Treasury Constant Maturity Rate
//   FEDFUNDS     — Federal Funds Effective Rate
//   T10Y2Y       — 10-Year minus 2-Year Treasury Yield Spread
//   BAMLH0A0HYM2 — ICE BofA US High Yield Index OAS
//   VIXCLS       — CBOE Volatility Index (VIX)
//   UNRATE       — Unemployment Rate
//   CPIAUCSL     — Consumer Price Index (All Urban Consumers)
//   MORTGAGE30US — 30-Year Fixed Rate Mortgage Average
//
// Data is stored in raw_prices with source='fred'.  The "close" column holds
// the numeric value of the series observation (rate / index level / spread).

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
	"go.uber.org/zap"
)

const (
	fredBaseURL    = "https://api.stlouisfed.org/fred/series/observations"
	fredDateLayout = "2006-01-02"
)

// FREDCollector implements Collector for FRED economic data.
type FREDCollector struct {
	apiKey     string
	httpClient *http.Client
	log        *zap.Logger
}

// NewFREDCollector creates a new FREDCollector.
// apiKey is the FRED API key (free registration at fred.stlouisfed.org).
// If apiKey is empty the collector will still work for public series using
// the anonymous rate limit (120 requests/minute).
func NewFREDCollector(apiKey string, log *zap.Logger) *FREDCollector {
	return &FREDCollector{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
		log: log,
	}
}

// fredObservationsResponse is the JSON envelope returned by FRED.
type fredObservationsResponse struct {
	Observations []fredObservation `json:"observations"`
}

type fredObservation struct {
	Date  string `json:"date"`  // "YYYY-MM-DD"
	Value string `json:"value"` // numeric string or "." for missing
}

// Name returns the source identifier used in the collectors registry.
func (c *FREDCollector) Name() string { return "fred" }

// SupportedTypes returns the data types this collector can produce.
func (c *FREDCollector) SupportedTypes() []DataType { return []DataType{DataTypeMarketPrice} }

// Collect fetches observations for the requested FRED series IDs.
// Each series ID is treated as a "symbol" in the CollectRequest.
func (c *FREDCollector) Collect(ctx context.Context, req CollectRequest) (*CollectResult, error) {
	if len(req.Symbols) == 0 {
		return &CollectResult{DataType: DataTypeMarketPrice}, nil
	}

	var allPrices []models.RawPrice

	for _, seriesID := range req.Symbols {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		default:
		}

		prices, err := c.fetchSeries(ctx, seriesID, req.DateFrom, req.DateTo)
		if err != nil {
			c.log.Warn("FRED fetch failed (non-fatal)",
				zap.String("series_id", seriesID),
				zap.Error(err),
			)
			continue
		}
		allPrices = append(allPrices, prices...)
		c.log.Info("FRED series fetched",
			zap.String("series_id", seriesID),
			zap.Int("observations", len(prices)),
		)
	}

	return &CollectResult{
		DataType: DataTypeMarketPrice,
		Prices:   allPrices,
		RowCount: len(allPrices),
	}, nil
}

// fetchSeries fetches observations for a single FRED series.
func (c *FREDCollector) fetchSeries(
	ctx context.Context,
	seriesID string,
	dateFrom, dateTo time.Time,
) ([]models.RawPrice, error) {
	params := url.Values{}
	params.Set("series_id", seriesID)
	params.Set("file_type", "json")
	params.Set("sort_order", "asc")
	if !dateFrom.IsZero() {
		params.Set("observation_start", dateFrom.Format(fredDateLayout))
	}
	if !dateTo.IsZero() {
		params.Set("observation_end", dateTo.Format(fredDateLayout))
	}
	if c.apiKey != "" {
		params.Set("api_key", c.apiKey)
	}

	reqURL := fredBaseURL + "?" + params.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build FRED request for %s: %w", seriesID, err)
	}
	httpReq.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("FRED HTTP request for %s: %w", seriesID, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read FRED response for %s: %w", seriesID, err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("FRED API returned HTTP %d for %s: %s",
			resp.StatusCode, seriesID, string(body))
	}

	var parsed fredObservationsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("parse FRED JSON for %s: %w", seriesID, err)
	}

	prices := make([]models.RawPrice, 0, len(parsed.Observations))
	for _, obs := range parsed.Observations {
		// FRED uses "." to indicate missing / not-yet-released values
		if obs.Value == "." || obs.Value == "" {
			continue
		}

		val, err := strconv.ParseFloat(obs.Value, 64)
		if err != nil {
			c.log.Debug("FRED: skip non-numeric observation",
				zap.String("series_id", seriesID),
				zap.String("date", obs.Date),
				zap.String("value", obs.Value),
			)
			continue
		}

		priceDate, err := time.Parse(fredDateLayout, obs.Date)
		if err != nil {
			c.log.Debug("FRED: skip unparseable date",
				zap.String("series_id", seriesID),
				zap.String("date", obs.Date),
			)
			continue
		}

		prices = append(prices, models.RawPrice{
			Symbol:    seriesID,
			PriceDate: priceDate,
			Close:     val,
			Currency:  "USD",
			Source:    "fred",
		})
	}

	return prices, nil
}
