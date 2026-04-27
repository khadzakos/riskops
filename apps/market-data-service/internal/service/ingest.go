package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/collector"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"github.com/khadzakos/riskops/pkg/kafka"
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
	producer   *kafka.Producer
	log        *zap.Logger
}

func NewIngestService(
	collectors map[string]collector.Collector,
	pricesRepo *repository.PricesRepo,
	creditRepo *repository.CreditRepo,
	logRepo *repository.IngestionLogRepo,
	returnsSvc *ReturnsService,
	producer *kafka.Producer,
	log *zap.Logger,
) *IngestService {
	return &IngestService{
		collectors: collectors,
		pricesRepo: pricesRepo,
		creditRepo: creditRepo,
		logRepo:    logRepo,
		returnsSvc: returnsSvc,
		producer:   producer,
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

	res := &IngestResult{
		Source:       req.Source,
		DataType:     dataType,
		RowsIngested: rowsIngested,
		Status:       "completed",
	}
	s.publishMarketDataIngested(ctx, req, res, dateFrom, dateTo)

	s.log.Info("ingestion completed",
		zap.String("source", req.Source),
		zap.String("data_type", dataType),
		zap.Int("rows_ingested", rowsIngested),
	)

	return res, nil
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

// BulkHistoricalIngest fetches 10 years of historical data for the top US and RU tickers.
// It processes symbols in batches to avoid overwhelming the upstream APIs.
// Returns a summary result with total rows ingested across all symbols.
func (s *IngestService) BulkHistoricalIngest(ctx context.Context) (*BulkIngestSummary, error) {
	dateFrom := time.Now().AddDate(-10, 0, 0)
	dateTo := time.Now()

	summary := &BulkIngestSummary{
		StartedAt: time.Now(),
	}

	// Ingest US tickers via Yahoo Finance
	s.log.Info("bulk historical ingest: starting US tickers via Yahoo",
		zap.Int("total_symbols", len(USTickerList)),
		zap.Time("date_from", dateFrom),
	)
	usResult := s.ingestSymbolBatches(ctx, "yahoo", USTickerList, dateFrom, dateTo, 10)
	summary.USRowsIngested = usResult.RowsIngested
	summary.USSymbolsOK = usResult.SymbolsOK
	summary.USSymbolsFailed = usResult.SymbolsFailed

	// Ingest RU tickers via MOEX
	s.log.Info("bulk historical ingest: starting RU tickers via MOEX",
		zap.Int("total_symbols", len(RUTickerList)),
		zap.Time("date_from", dateFrom),
	)
	ruResult := s.ingestSymbolBatches(ctx, "moex", RUTickerList, dateFrom, dateTo, 10)
	summary.RURowsIngested = ruResult.RowsIngested
	summary.RUSymbolsOK = ruResult.SymbolsOK
	summary.RUSymbolsFailed = ruResult.SymbolsFailed

	summary.TotalRowsIngested = summary.USRowsIngested + summary.RURowsIngested
	summary.CompletedAt = time.Now()
	summary.Status = "completed"
	if summary.USSymbolsFailed+summary.RUSymbolsFailed > 0 {
		summary.Status = "partial"
	}

	s.log.Info("bulk historical ingest complete",
		zap.Int("total_rows", summary.TotalRowsIngested),
		zap.Int("us_ok", summary.USSymbolsOK),
		zap.Int("us_failed", summary.USSymbolsFailed),
		zap.Int("ru_ok", summary.RUSymbolsOK),
		zap.Int("ru_failed", summary.RUSymbolsFailed),
		zap.Duration("elapsed", summary.CompletedAt.Sub(summary.StartedAt)),
	)

	return summary, nil
}

// DailyRefresh fetches the previous trading day's data for all symbols already in the DB.
// This is designed to be called by the daily Airflow DAG.
func (s *IngestService) DailyRefresh(ctx context.Context) (*BulkIngestSummary, error) {
	// Previous trading day: go back 1 day, skip weekends
	dateTo := time.Now().UTC()
	dateFrom := dateTo.AddDate(0, 0, -3) // 3 days back to catch Monday (covers weekend)

	// Get all symbols currently in the DB
	symbols, err := s.pricesRepo.GetDistinctSymbols(ctx)
	if err != nil {
		return nil, fmt.Errorf("daily refresh: get symbols: %w", err)
	}

	if len(symbols) == 0 {
		s.log.Warn("daily refresh: no symbols in DB, skipping")
		return &BulkIngestSummary{Status: "skipped", StartedAt: time.Now(), CompletedAt: time.Now()}, nil
	}

	// Split symbols by source (yahoo vs moex based on naming convention)
	var yahooSymbols, moexSymbols []string
	for _, sym := range symbols {
		if isMOEXSymbol(sym) {
			moexSymbols = append(moexSymbols, sym)
		} else {
			yahooSymbols = append(yahooSymbols, sym)
		}
	}

	summary := &BulkIngestSummary{StartedAt: time.Now()}

	if len(yahooSymbols) > 0 {
		res := s.ingestSymbolBatches(ctx, "yahoo", yahooSymbols, dateFrom, dateTo, 20)
		summary.USRowsIngested = res.RowsIngested
		summary.USSymbolsOK = res.SymbolsOK
		summary.USSymbolsFailed = res.SymbolsFailed
	}

	if len(moexSymbols) > 0 {
		res := s.ingestSymbolBatches(ctx, "moex", moexSymbols, dateFrom, dateTo, 20)
		summary.RURowsIngested = res.RowsIngested
		summary.RUSymbolsOK = res.SymbolsOK
		summary.RUSymbolsFailed = res.SymbolsFailed
	}

	summary.TotalRowsIngested = summary.USRowsIngested + summary.RURowsIngested
	summary.CompletedAt = time.Now()
	summary.Status = "completed"

	s.log.Info("daily refresh complete",
		zap.Int("total_rows", summary.TotalRowsIngested),
		zap.Int("yahoo_symbols", len(yahooSymbols)),
		zap.Int("moex_symbols", len(moexSymbols)),
	)

	return summary, nil
}

// batchResult holds per-batch ingestion counts.
type batchResult struct {
	RowsIngested  int
	SymbolsOK     int
	SymbolsFailed int
}

// ingestSymbolBatches ingests symbols in batches of batchSize, one symbol at a time
// to avoid overwhelming upstream APIs. Returns aggregate counts.
func (s *IngestService) ingestSymbolBatches(
	ctx context.Context,
	source string,
	symbols []string,
	dateFrom, dateTo time.Time,
	batchSize int,
) batchResult {
	result := batchResult{}

	for i := 0; i < len(symbols); i += batchSize {
		end := i + batchSize
		if end > len(symbols) {
			end = len(symbols)
		}
		batch := symbols[i:end]

		// Check context cancellation between batches
		select {
		case <-ctx.Done():
			s.log.Warn("bulk ingest: context cancelled, stopping early",
				zap.String("source", source),
				zap.Int("processed", i),
				zap.Int("total", len(symbols)),
			)
			return result
		default:
		}

		for _, sym := range batch {
			req := IngestRequest{
				Source:   source,
				Symbols:  []string{sym},
				DateFrom: dateFrom,
				DateTo:   dateTo,
			}
			res, err := s.Ingest(ctx, req)
			if err != nil || (res != nil && res.Status == "failed") {
				errMsg := ""
				if err != nil {
					errMsg = err.Error()
				} else if res != nil {
					errMsg = res.Error
				}
				s.log.Warn("bulk ingest: symbol failed",
					zap.String("source", source),
					zap.String("symbol", sym),
					zap.String("error", errMsg),
				)
				result.SymbolsFailed++
			} else if res != nil {
				result.RowsIngested += res.RowsIngested
				result.SymbolsOK++
			}
		}

		s.log.Info("bulk ingest batch complete",
			zap.String("source", source),
			zap.Int("batch_end", end),
			zap.Int("total", len(symbols)),
			zap.Int("rows_so_far", result.RowsIngested),
		)
	}

	return result
}

// isMOEXSymbol returns true if the symbol looks like a MOEX ticker
// (Cyrillic or known Russian index names, no dots, typically 4-5 uppercase Latin chars).
func isMOEXSymbol(sym string) bool {
	// Known MOEX index prefixes
	moexPrefixes := []string{"IMOEX", "RTSI", "MOEX", "SBER", "GAZP", "LKOH", "NVTK",
		"ROSN", "TATN", "SNGS", "GMKN", "POLY", "PLZL", "ALRS", "CHMF", "NLMK",
		"MAGN", "MTLR", "YNDX", "MAIL", "OZON", "VKCO", "TCSG", "VTBR", "AFKS",
		"BSPB", "CBOM", "SFIN", "RENI", "QIWI", "FESH", "TRNF", "SIBN", "BANE",
		"IRAO", "FEES", "HYDR", "RUAL", "PHOR", "AKRN", "MGNT", "FIVE", "LENT",
		"FIXP", "MVID", "DSKY", "MTSS", "RTKM", "TTLK", "AFLT", "FLOT", "NMTP",
		"SMLT", "ETLN", "PIKK", "AQUA", "MSNG", "MSRS",
	}
	for _, prefix := range moexPrefixes {
		if sym == prefix || len(sym) >= len(prefix) && sym[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}

// BulkIngestSummary holds the result of a bulk ingestion operation.
type BulkIngestSummary struct {
	Status            string
	TotalRowsIngested int
	USRowsIngested    int
	USSymbolsOK       int
	USSymbolsFailed   int
	RURowsIngested    int
	RUSymbolsOK       int
	RUSymbolsFailed   int
	StartedAt         time.Time
	CompletedAt       time.Time
}

func (s *IngestService) ListSources() []SourceDescriptor {
	schedules := map[string]string{
		"yahoo":            "Daily 21:00 UTC (Airflow)",
		"moex":             "Daily 19:00 UTC (Airflow)",
		"synthetic":        "On-demand",
		"credit_synthetic": "On-demand",
		"fred":             "Weekly (Airflow) + on startup",
	}
	descriptions := map[string]string{
		"yahoo":            "Yahoo Finance v8 API — US/international equities, ETFs, indices",
		"moex":             "MOEX ISS — Russian stocks, bonds, indices (TQBR board)",
		"synthetic":        "GBM synthetic price generator for development and testing",
		"credit_synthetic": "Synthetic credit portfolio generator (PD/LGD calibrated)",
		"fred":             "Federal Reserve Economic Data — rates, spreads, macro indicators (DGS10, FEDFUNDS, VIX, CPI, …)",
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

type marketDataIngestedPayload struct {
	Event        string   `json:"event"`
	Source       string   `json:"source"`
	DataType     string   `json:"data_type"`
	RowsIngested int      `json:"rows_ingested"`
	Status       string   `json:"status"`
	Symbols      []string `json:"symbols,omitempty"`
	DateFrom     string   `json:"date_from"`
	DateTo       string   `json:"date_to"`
	OccurredAt   string   `json:"occurred_at"`
}

func (s *IngestService) publishMarketDataIngested(ctx context.Context, req IngestRequest, res *IngestResult, dateFrom, dateTo time.Time) {
	if s.producer == nil || res == nil || res.Status != "completed" {
		return
	}
	symbols := req.Symbols
	if len(symbols) == 0 {
		symbols = []string{}
	}
	p := marketDataIngestedPayload{
		Event:        "market.data.ingested",
		Source:       res.Source,
		DataType:     res.DataType,
		RowsIngested: res.RowsIngested,
		Status:       res.Status,
		Symbols:      symbols,
		DateFrom:     dateFrom.UTC().Format(time.RFC3339),
		DateTo:       dateTo.UTC().Format(time.RFC3339),
		OccurredAt:   time.Now().UTC().Format(time.RFC3339),
	}
	b, err := json.Marshal(p)
	if err != nil {
		s.log.Warn("kafka: marshal market.data.ingested", zap.Error(err))
		return
	}
	key := []byte(res.Source)
	if err := s.producer.Publish(ctx, kafka.TopicMarketDataIngested, key, b); err != nil {
		s.log.Warn("kafka: publish market.data.ingested", zap.Error(err))
	}
}
