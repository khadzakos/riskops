package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
)

const yahooBaseURL = "https://query1.finance.yahoo.com/v8/finance/chart"

type YahooCollector struct {
	client *http.Client
}

func NewYahooCollector() *YahooCollector {
	return &YahooCollector{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *YahooCollector) Name() string { return "yahoo" }

func (c *YahooCollector) SupportedTypes() []DataType {
	return []DataType{DataTypeMarketPrice}
}

func (c *YahooCollector) Collect(ctx context.Context, req CollectRequest) (*CollectResult, error) {
	if len(req.Symbols) == 0 {
		return nil, fmt.Errorf("yahoo collector: at least one symbol required")
	}

	dateFrom := req.DateFrom
	dateTo := req.DateTo
	if dateFrom.IsZero() {
		dateFrom = time.Now().AddDate(-1, 0, 0)
	}
	if dateTo.IsZero() {
		dateTo = time.Now()
	}

	var allPrices []models.RawPrice
	now := time.Now().UTC()

	for _, symbol := range req.Symbols {
		prices, err := c.fetchSymbol(ctx, symbol, dateFrom, dateTo, now)
		if err != nil {
			return nil, fmt.Errorf("yahoo collector: fetch %s: %w", symbol, err)
		}
		allPrices = append(allPrices, prices...)
	}

	return &CollectResult{
		Source:   c.Name(),
		DataType: DataTypeMarketPrice,
		Prices:   allPrices,
		RowCount: len(allPrices),
	}, nil
}

func (c *YahooCollector) fetchSymbol(ctx context.Context, symbol string, from, to time.Time, now time.Time) ([]models.RawPrice, error) {
	url := fmt.Sprintf("%s/%s?interval=1d&period1=%d&period2=%d",
		yahooBaseURL, symbol, from.Unix(), to.Unix())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; RiskOps/1.0)")

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("yahoo API returned status %d for %s", resp.StatusCode, symbol)
	}

	var result yahooResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if result.Chart.Error != nil {
		return nil, fmt.Errorf("yahoo API error: %s", result.Chart.Error.Description)
	}
	if len(result.Chart.Result) == 0 {
		return nil, fmt.Errorf("no data returned for symbol %s", symbol)
	}

	chartResult := result.Chart.Result[0]
	timestamps := chartResult.Timestamp
	closes := chartResult.Indicators.Quote[0].Close

	if len(timestamps) != len(closes) {
		return nil, fmt.Errorf("timestamp/close length mismatch for %s", symbol)
	}

	currency := chartResult.Meta.Currency
	if currency == "" {
		currency = "USD"
	}

	var prices []models.RawPrice
	for i, ts := range timestamps {
		if i >= len(closes) || closes[i] == nil {
			continue
		}
		t := time.Unix(int64(ts), 0).UTC()
		priceDate := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
		prices = append(prices, models.RawPrice{
			Symbol:     symbol,
			PriceDate:  priceDate,
			Close:      *closes[i],
			Currency:   currency,
			Source:     "yahoo",
			IngestedAt: now,
		})
	}

	return prices, nil
}

// yahooResponse mirrors the Yahoo Finance v8 chart API response structure.
type yahooResponse struct {
	Chart struct {
		Result []struct {
			Meta struct {
				Currency string `json:"currency"`
				Symbol   string `json:"symbol"`
			} `json:"meta"`
			Timestamp  []int64 `json:"timestamp"`
			Indicators struct {
				Quote []struct {
					Close []*float64 `json:"close"`
				} `json:"quote"`
			} `json:"indicators"`
		} `json:"result"`
		Error *struct {
			Code        string `json:"code"`
			Description string `json:"description"`
		} `json:"error"`
	} `json:"chart"`
}
