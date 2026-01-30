package model

import (
	"time"
)

// Portfolio represents a portfolio entity
type Portfolio struct {
	ID            string     `json:"id" db:"id"`
	Name          string     `json:"name" db:"name"`
	Description   *string    `json:"description,omitempty" db:"description"`
	UserID        *string    `json:"user_id,omitempty" db:"user_id"`
	BaseVersionID *string    `json:"base_version_id,omitempty" db:"base_version_id"`
	IsActive      bool       `json:"is_active" db:"is_active"`
	CreatedAt     time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at" db:"updated_at"`
	DeletedAt     *time.Time `json:"-" db:"deleted_at"`

	// Relations (загружаются отдельными запросами)
	BaseVersion *PortfolioVersion  `json:"base_version,omitempty"`
	Versions    []PortfolioVersion `json:"versions,omitempty"`
}

// TableName returns the table name for Portfolio
func (Portfolio) TableName() string {
	return "portfolios"
}

// PortfolioVersion represents a version of a portfolio
type PortfolioVersion struct {
	ID            string    `json:"id" db:"id"`
	PortfolioID   string    `json:"portfolio_id" db:"portfolio_id"`
	VersionNumber int       `json:"version_number" db:"version_number"`
	Description   *string   `json:"description,omitempty" db:"description"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
	CreatedBy     *string   `json:"created_by,omitempty" db:"created_by"`

	// Relations (загружаются отдельными запросами)
	Positions []Position `json:"positions,omitempty"`
	Portfolio *Portfolio `json:"portfolio,omitempty"`
}

// TableName returns the table name for PortfolioVersion
func (PortfolioVersion) TableName() string {
	return "portfolio_versions"
}
