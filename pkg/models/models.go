package models

import "time"

type Portfolio struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Currency    string    `json:"currency"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type Position struct {
	PortfolioID int64     `json:"portfolio_id"`
	Symbol      string    `json:"symbol"`
	Weight      float64   `json:"weight"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type RiskResult struct {
	ID           int64     `json:"id"`
	PortfolioID  int64     `json:"portfolio_id"`
	AsofDate     string    `json:"asof_date"`
	HorizonDays  int       `json:"horizon_days"`
	Alpha        float64   `json:"alpha"`
	Method       string    `json:"method"`
	Metric       string    `json:"metric"`
	Value        float64   `json:"value"`
	ModelVersion string    `json:"model_version"`
	CreatedAt    time.Time `json:"created_at"`
}

type RawPrice struct {
	Symbol     string    `json:"symbol"`
	PriceDate  time.Time `json:"price_date"`
	Close      float64   `json:"close"`
	Currency   string    `json:"currency,omitempty"`
	Source     string    `json:"source,omitempty"`
	IngestedAt time.Time `json:"ingested_at"`
}

type ProcessedReturn struct {
	Symbol     string    `json:"symbol"`
	PriceDate  time.Time `json:"price_date"`
	Ret        float64   `json:"ret"`
	ComputedAt time.Time `json:"computed_at"`
}

type CreditRecord struct {
	ID              int64     `json:"id"`
	LoanID          string    `json:"loan_id"`
	BorrowerID      string    `json:"borrower_id"`
	LoanAmount      float64   `json:"loan_amount"`
	InterestRate    float64   `json:"interest_rate"`
	TermMonths      int       `json:"term_months"`
	CreditScore     int       `json:"credit_score"`
	LTVRatio        float64   `json:"ltv_ratio"`
	DTIRatio        float64   `json:"dti_ratio"`
	IsDefault       bool      `json:"is_default"`
	DefaultDate     *string   `json:"default_date,omitempty"`
	OriginationDate string    `json:"origination_date"`
	Sector          string    `json:"sector"`
	Source          string    `json:"source"`
	IngestedAt      time.Time `json:"ingested_at"`
}

type IngestionLog struct {
	ID           int64     `json:"id"`
	Source       string    `json:"source"`
	DataType     string    `json:"data_type"`
	Symbols      []string  `json:"symbols"`
	DateFrom     time.Time `json:"date_from"`
	DateTo       time.Time `json:"date_to"`
	RowsIngested int       `json:"rows_ingested"`
	Status       string    `json:"status"`
	ErrorMessage string    `json:"error_message,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
}
