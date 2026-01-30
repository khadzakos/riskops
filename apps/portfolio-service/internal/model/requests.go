package model

// CreatePortfolioRequest represents request to create a portfolio
type CreatePortfolioRequest struct {
	Name        string                  `json:"name" validate:"required,min=1,max=255"`
	Description *string                 `json:"description,omitempty"`
	Positions   []CreatePositionRequest `json:"positions" validate:"required,min=1"`
}

// UpdatePortfolioRequest represents request to update a portfolio
type UpdatePortfolioRequest struct {
	Name        *string                 `json:"name,omitempty" validate:"omitempty,min=1,max=255"`
	Description *string                 `json:"description,omitempty"`
	Positions   []CreatePositionRequest `json:"positions,omitempty"`
}

// CreatePositionRequest represents request to create a position
type CreatePositionRequest struct {
	Ticker       string   `json:"ticker" validate:"required,min=1,max=20"`
	Exchange     *string  `json:"exchange,omitempty" validate:"omitempty,max=10"`
	AssetType    string   `json:"asset_type" validate:"required,oneof=stock crypto bond etf option future forex"`
	Quantity     *float64 `json:"quantity,omitempty" validate:"omitempty,gt=0"`
	Weight       *float64 `json:"weight,omitempty" validate:"omitempty,gt=0,lte=100"`
	AveragePrice *float64 `json:"average_price,omitempty" validate:"omitempty,gt=0"`
}

// CreatePortfolioVersionRequest represents request to create a new portfolio version
type CreatePortfolioVersionRequest struct {
	Description *string                 `json:"description,omitempty"`
	Positions   []CreatePositionRequest `json:"positions" validate:"required,min=1"`
}

// PortfolioResponse represents portfolio response with aggregated data
type PortfolioResponse struct {
	Portfolio
	TotalValue         float64            `json:"total_value"`
	TotalPositions     int                `json:"total_positions"`
	AssetAllocation    map[string]float64 `json:"asset_allocation"`    // по типам активов
	SectorAllocation   map[string]float64 `json:"sector_allocation"`   // по секторам
	CurrencyAllocation map[string]float64 `json:"currency_allocation"` // по валютам
}
