package model

import (
	"time"
)

// AssetType represents type of asset
type AssetType string

const (
	AssetTypeStock  AssetType = "stock"
	AssetTypeCrypto AssetType = "crypto"
	AssetTypeBond   AssetType = "bond"
	AssetTypeETF    AssetType = "etf"
	AssetTypeOption AssetType = "option"
	AssetTypeFuture AssetType = "future"
	AssetTypeForex  AssetType = "forex"
)

// Asset represents an asset in the system (справочник активов)
type Asset struct {
	ID        string    `json:"id" db:"id"`
	Ticker    string    `json:"ticker" db:"ticker"`
	Exchange  *string   `json:"exchange,omitempty" db:"exchange"`
	AssetType AssetType `json:"asset_type" db:"asset_type"`
	Name      string    `json:"name" db:"name"`
	Currency  string    `json:"currency" db:"currency"`
	Sector    *string   `json:"sector,omitempty" db:"sector"`
	Country   *string   `json:"country,omitempty" db:"country"`
	ISIN      *string   `json:"isin,omitempty" db:"isin"`
	CUSIP     *string   `json:"cusip,omitempty" db:"cusip"`
	IsActive  bool      `json:"is_active" db:"is_active"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
	UpdatedAt time.Time `json:"updated_at" db:"updated_at"`
}

// TableName returns the table name for Asset
func (Asset) TableName() string {
	return "assets"
}
