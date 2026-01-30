package model

import (
	"time"
)

// PortfolioSnapshot represents a snapshot of portfolio at a point in time
type PortfolioSnapshot struct {
	ID                 string         `json:"id" db:"id"`
	PortfolioID        string         `json:"portfolio_id" db:"portfolio_id"`
	PortfolioVersionID string         `json:"portfolio_version_id" db:"portfolio_version_id"`
	TotalValue         float64        `json:"total_value" db:"total_value"`
	Currency           string         `json:"currency" db:"currency"`
	SnapshotDate       time.Time      `json:"snapshot_date" db:"snapshot_date"`
	Metadata           map[string]any `json:"metadata,omitempty" db:"metadata"`
	CreatedAt          time.Time      `json:"created_at" db:"created_at"`

	// Relations (загружаются отдельными запросами)
	Portfolio        *Portfolio        `json:"portfolio,omitempty"`
	PortfolioVersion *PortfolioVersion `json:"portfolio_version,omitempty"`
}

// TableName returns the table name for PortfolioSnapshot
func (PortfolioSnapshot) TableName() string {
	return "portfolio_snapshots"
}
