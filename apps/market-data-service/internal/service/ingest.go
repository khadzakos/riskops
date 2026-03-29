package service

import (
	"context"
	"fmt"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/collector"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"github.com/khadzakos/riskops/pkg/models"
	"go.uber.org/zap"
)

type IngestRequest struct {
	Source   string
	Symbols  []string
	DateFrom time.Time
	DateTo   time.Time
	Count    int // for synthetic generators
}

type IngestResult struct {
	Source       string
	DataType     string
	RowsIngested int
	Status       string
	Error        string
}

// IngestService orchestrates the full ingestion pipeline:
// collect → normalize → store raw → compute returns → log.
type IngestService struct {
	collectors map[string]collector.Collector
	pricesRepo *repository.PricesRepo
	creditRepo *repository.CreditRepo
	logRepo    *repository.IngestionLogRepo
	returnsSvc *ReturnsService
	log        *zap.Logger
}

func NewIngestService(
	collectors map[string]collector.Collector,
	pricesRepo *repository.PricesRepo,
	creditRepo *repository.CreditRepo,
	logRepo *repository.IngestionLogRepo,
	returnsSvc *ReturnsService,
	log *zap.Logger,
) *IngestService {
	return &IngestService{
		collectors: collectors,
		pricesRepo: pricesRepo,
		creditRepo: creditRepo,
		logRepo:    logRepo,
		returnsSvc: returnsSvc,
		log:        log,
	}
}

func (s *IngestService) Ingest(ctx context.Context, req IngestRequest) (*IngestResult, error) {
	col, ok := s.collectors[req.Source]
	if !ok {
		return nil, fmt.Errorf("unknown source: %s", req.Source)
	}

	s.log.Info("ingestion started",
		zap.String("source", req.Source),
		zap.Strings("symbols", req.Symbols),
		zap.Time("date_from", req.DateFrom),
		zap.Time("date_to", req.DateTo),
	)

	dateFrom := req.DateFrom
	dateTo := req.DateTo
	if dateFrom.IsZero() {
		dateFrom = time.Now().AddDate(-1, 0, 0)
	}
	if dateTo.IsZero() {
		dateTo = time.Now()
	}

	collectReq := collector.CollectRequest{
		Symbols:  req.Symbols,
		DateFrom: dateFrom,
		DateTo:   dateTo,
		Count:    req.Count,
	}

	result, err := col.Collect(ctx, collectReq)
	if err != nil {
		s.recordLog(ctx, req, string(collector.DataTypeMarketPrice), 0, "failed", err.Error(), dateFrom, dateTo)
		return &IngestResult{
			Source: req.Source,
			Status: "failed",
			Error:  err.Error(),
		}, nil
	}

	rowsIngested := result.RowCount
	dataType := string(result.DataType)

	switch result.DataType {
	case collector.DataTypeMarketPrice:
		if _, err := s.pricesRepo.UpsertPrices(ctx, result.Prices); err != nil {
			s.recordLog(ctx, req, dataType, 0, "failed", err.Error(), dateFrom, dateTo)
			return &IngestResult{
				Source:   req.Source,
				DataType: dataType,
				Status:   "failed",
				Error:    err.Error(),
			}, nil
		}

		// Compute returns for the ingested symbols
		symbols := req.Symbols
		if len(symbols) == 0 {
			symbols = extractSymbols(result.Prices)
		}
		if _, err := s.returnsSvc.ComputeAndStore(ctx, symbols); err != nil {
			s.log.Warn("returns computation failed (non-fatal)", zap.Error(err))
		}

	case collector.DataTypeCreditData:
		if _, err := s.creditRepo.UpsertCredit(ctx, result.Credits); err != nil {
			s.recordLog(ctx, req, dataType, 0, "failed", err.Error(), dateFrom, dateTo)
			return &IngestResult{
				Source:   req.Source,
				DataType: dataType,
				Status:   "failed",
				Error:    err.Error(),
			}, nil
		}
	}

	s.recordLog(ctx, req, dataType, rowsIngested, "completed", "", dateFrom, dateTo)

	s.log.Info("ingestion completed",
		zap.String("source", req.Source),
		zap.String("data_type", dataType),
		zap.Int("rows_ingested", rowsIngested),
	)

	return &IngestResult{
		Source:       req.Source,
		DataType:     dataType,
		RowsIngested: rowsIngested,
		Status:       "completed",
	}, nil
}

func (s *IngestService) IngestAll(ctx context.Context, dateFrom, dateTo time.Time) ([]*IngestResult, error) {
	// Default symbols for market data sources
	defaultSymbols := map[string][]string{
		"yahoo":     {"AAPL", "MSFT", "GOOGL", "SPY"},
		"moex":      {"SBER", "GAZP", "LKOH", "YNDX"},
		"synthetic": {"AAPL", "MSFT", "GOOGL"},
	}

	var results []*IngestResult
	for name := range s.collectors {
		symbols := defaultSymbols[name]
		req := IngestRequest{
			Source:   name,
			Symbols:  symbols,
			DateFrom: dateFrom,
			DateTo:   dateTo,
			Count:    1000, // for synthetic credit
		}
		res, err := s.Ingest(ctx, req)
		if err != nil {
			s.log.Error("ingest all: source failed", zap.String("source", name), zap.Error(err))
			results = append(results, &IngestResult{
				Source: name,
				Status: "failed",
				Error:  err.Error(),
			})
			continue
		}
		results = append(results, res)
	}
	return results, nil
}

func (s *IngestService) ListSources() []SourceDescriptor {
	schedules := map[string]string{
		"yahoo":            "Daily 21:00 UTC (Airflow)",
		"moex":             "Daily 19:00 UTC (Airflow)",
		"synthetic":        "On-demand",
		"credit_synthetic": "On-demand",
	}
	descriptions := map[string]string{
		"yahoo":            "Yahoo Finance v8 API — US/international equities, ETFs, indices",
		"moex":             "MOEX ISS — Russian stocks, bonds, indices (TQBR board)",
		"synthetic":        "GBM synthetic price generator for development and testing",
		"credit_synthetic": "Synthetic credit portfolio generator (PD/LGD calibrated)",
	}

	var out []SourceDescriptor
	for name, col := range s.collectors {
		types := col.SupportedTypes()
		dataType := "market_price"
		if len(types) > 0 {
			dataType = string(types[0])
		}
		out = append(out, SourceDescriptor{
			Name:        name,
			DataType:    dataType,
			Description: descriptions[name],
			Schedule:    schedules[name],
		})
	}
	return out
}

type SourceDescriptor struct {
	Name        string
	DataType    string
	Description string
	Schedule    string
}

func (s *IngestService) recordLog(
	ctx context.Context,
	req IngestRequest,
	dataType string,
	rowsIngested int,
	status, errMsg string,
	dateFrom, dateTo time.Time,
) {
	symbols := req.Symbols
	if len(symbols) == 0 {
		symbols = []string{"*"}
	}
	entry := models.IngestionLog{
		Source:       req.Source,
		DataType:     dataType,
		Symbols:      symbols,
		DateFrom:     dateFrom,
		DateTo:       dateTo,
		RowsIngested: rowsIngested,
		Status:       status,
		ErrorMessage: errMsg,
	}
	if _, err := s.logRepo.Create(ctx, entry); err != nil {
		s.log.Warn("failed to write ingestion log", zap.Error(err))
	}
}

func extractSymbols(prices []models.RawPrice) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, p := range prices {
		if _, ok := seen[p.Symbol]; !ok {
			seen[p.Symbol] = struct{}{}
			out = append(out, p.Symbol)
		}
	}
	return out
}
