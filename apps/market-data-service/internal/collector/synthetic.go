package collector

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
)

// SyntheticCollector generates random walk price data using Geometric Brownian Motion.
// Used for development, testing, and demos without external API dependencies.
type SyntheticCollector struct {
	rng *rand.Rand
}

func NewSyntheticCollector() *SyntheticCollector {
	return &SyntheticCollector{
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (c *SyntheticCollector) Name() string { return "synthetic" }

func (c *SyntheticCollector) SupportedTypes() []DataType {
	return []DataType{DataTypeMarketPrice}
}

func (c *SyntheticCollector) Collect(_ context.Context, req CollectRequest) (*CollectResult, error) {
	if len(req.Symbols) == 0 {
		return nil, fmt.Errorf("synthetic collector: at least one symbol required")
	}

	dateFrom := req.DateFrom
	dateTo := req.DateTo
	if dateFrom.IsZero() {
		dateFrom = time.Now().AddDate(-1, 0, 0)
	}
	if dateTo.IsZero() {
		dateTo = time.Now()
	}
	if dateTo.Before(dateFrom) {
		return nil, fmt.Errorf("synthetic collector: date_to must be after date_from")
	}

	var prices []models.RawPrice
	now := time.Now().UTC()

	for _, symbol := range req.Symbols {
		// GBM parameters: annualised drift ~8%, volatility ~20%
		mu := 0.08 / 252.0                     // daily drift
		sigma := 0.20 / math.Sqrt(252.0)       // daily vol
		price := 100.0 + c.rng.Float64()*400.0 // random starting price 100-500

		current := dateFrom
		for !current.After(dateTo) {
			// Skip weekends
			if current.Weekday() == time.Saturday || current.Weekday() == time.Sunday {
				current = current.AddDate(0, 0, 1)
				continue
			}

			// GBM step: S(t+1) = S(t) * exp((mu - sigma²/2)*dt + sigma*sqrt(dt)*Z)
			z := c.rng.NormFloat64()
			price *= math.Exp((mu - 0.5*sigma*sigma) + sigma*z)

			prices = append(prices, models.RawPrice{
				Symbol:     symbol,
				PriceDate:  current,
				Close:      math.Round(price*100) / 100,
				Currency:   "USD",
				Source:     "synthetic",
				IngestedAt: now,
			})

			current = current.AddDate(0, 0, 1)
		}
	}

	return &CollectResult{
		Source:   c.Name(),
		DataType: DataTypeMarketPrice,
		Prices:   prices,
		RowCount: len(prices),
	}, nil
}
