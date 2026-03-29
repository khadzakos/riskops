package collector

import (
	"context"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
)

type DataType string

const (
	DataTypeMarketPrice DataType = "market_price"
	DataTypeCreditData  DataType = "credit_data"
)

type CollectRequest struct {
	Symbols  []string
	DateFrom time.Time
	DateTo   time.Time
	DataType DataType
	Count    int // synthetic generators use this to control how many records to produce
}

type CollectResult struct {
	Source   string
	DataType DataType
	Prices   []models.RawPrice
	Credits  []models.CreditRecord
	RowCount int
}

type Collector interface {
	Name() string
	Collect(ctx context.Context, req CollectRequest) (*CollectResult, error)
	SupportedTypes() []DataType
}
