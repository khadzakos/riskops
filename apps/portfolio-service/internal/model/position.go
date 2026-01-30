package model

import (
	"time"
)

// Position represents a position in a portfolio
type Position struct {
	ID                 string    `json:"id" db:"id"`
	PortfolioVersionID string    `json:"portfolio_version_id" db:"portfolio_version_id"`
	AssetID            string    `json:"asset_id" db:"asset_id"`
	Quantity           *float64  `json:"quantity,omitempty" db:"quantity"`
	Weight             *float64  `json:"weight,omitempty" db:"weight"` // 0-100
	MarketValue        *float64  `json:"market_value,omitempty" db:"market_value"`
	AveragePrice       *float64  `json:"average_price,omitempty" db:"average_price"`
	CreatedAt          time.Time `json:"created_at" db:"created_at"`
	UpdatedAt          time.Time `json:"updated_at" db:"updated_at"`

	// Relations (загружаются отдельными запросами)
	Asset            *Asset            `json:"asset,omitempty"`
	PortfolioVersion *PortfolioVersion `json:"portfolio_version,omitempty"`
}

// TableName returns the table name for Position
func (Position) TableName() string {
	return "positions"
}
