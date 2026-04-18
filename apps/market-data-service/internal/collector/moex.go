package collector

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
)

const moexBaseURL = "https://iss.moex.com/iss"

type MOEXCollector struct {
	client *http.Client
}

func NewMOEXCollector() *MOEXCollector {
	return &MOEXCollector{
		client: &http.Client{Timeout: 30 * time.Second},
	}
}

func (c *MOEXCollector) Name() string { return "moex" }

func (c *MOEXCollector) SupportedTypes() []DataType {
	return []DataType{DataTypeMarketPrice}
}

func (c *MOEXCollector) Collect(ctx context.Context, req CollectRequest) (*CollectResult, error) {
	if len(req.Symbols) == 0 {
		return nil, fmt.Errorf("moex collector: at least one symbol required")
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
			return nil, fmt.Errorf("moex collector: fetch %s: %w", symbol, err)
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

func (c *MOEXCollector) fetchSymbol(ctx context.Context, symbol string, from, to time.Time, now time.Time) ([]models.RawPrice, error) {
	var allPrices []models.RawPrice
	start := 0
	const pageSize = 100

	for {
		url := fmt.Sprintf(
			"%s/history/engines/stock/markets/shares/boards/TQBR/securities/%s.json?from=%s&till=%s&start=%d&limit=%d",
			moexBaseURL,
			symbol,
			from.Format("2006-01-02"),
			to.Format("2006-01-02"),
			start,
			pageSize,
		)

		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return nil, err
		}

		resp, err := c.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("http request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("MOEX ISS returned status %d for %s", resp.StatusCode, symbol)
		}

		var result moexHistoryResponse
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
			return nil, fmt.Errorf("decode response: %w", err)
		}

		rows := result.History.Data
		if len(rows) == 0 {
			break
		}

		// Map column names to indices
		colIdx := make(map[string]int)
		for i, col := range result.History.Columns {
			colIdx[col] = i
		}

		dateIdx, hasDate := colIdx["TRADEDATE"]
		closeIdx, hasClose := colIdx["CLOSE"]
		if !hasDate || !hasClose {
			return nil, fmt.Errorf("MOEX response missing expected columns for %s", symbol)
		}

		for _, row := range rows {
			if len(row) <= closeIdx || len(row) <= dateIdx {
				continue
			}
			dateStr, ok := row[dateIdx].(string)
			if !ok || dateStr == "" {
				continue
			}
			priceDate, err := time.Parse("2006-01-02", dateStr)
			if err != nil {
				continue
			}
			closeVal, ok := row[closeIdx].(float64)
			if !ok {
				continue
			}

			allPrices = append(allPrices, models.RawPrice{
				Symbol:     symbol,
				PriceDate:  priceDate,
				Close:      closeVal,
				Currency:   "RUB",
				Source:     "moex",
				IngestedAt: now,
			})
		}

		if len(rows) < pageSize {
			break
		}
		start += pageSize
	}

	return allPrices, nil
}

type moexHistoryResponse struct {
	History struct {
		Columns []string        `json:"columns"`
		Data    [][]interface{} `json:"data"`
	} `json:"history"`
}
