package handler

import (
	"context"
	"strings"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/api"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"github.com/khadzakos/riskops/apps/market-data-service/internal/service"
	"github.com/khadzakos/riskops/pkg/models"
	"github.com/oapi-codegen/runtime/types"
)

var _ api.StrictServerInterface = (*MarketDataHandler)(nil)

type MarketDataHandler struct {
	ingestSvc  *service.IngestService
	pricesRepo *repository.PricesRepo
	creditRepo *repository.CreditRepo
	logRepo    *repository.IngestionLogRepo
}

func NewMarketDataHandler(
	ingestSvc *service.IngestService,
	pricesRepo *repository.PricesRepo,
	creditRepo *repository.CreditRepo,
	logRepo *repository.IngestionLogRepo,
) *MarketDataHandler {
	return &MarketDataHandler{
		ingestSvc:  ingestSvc,
		pricesRepo: pricesRepo,
		creditRepo: creditRepo,
		logRepo:    logRepo,
	}
}

// TriggerIngest handles POST /api/market-data/ingest
func (h *MarketDataHandler) TriggerIngest(ctx context.Context, req api.TriggerIngestRequestObject) (api.TriggerIngestResponseObject, error) {
	if req.Body == nil {
		return api.TriggerIngest400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "request body required"}}, nil
	}

	var dateFrom, dateTo time.Time
	if req.Body.DateFrom != nil {
		dateFrom = req.Body.DateFrom.Time
	}
	if req.Body.DateTo != nil {
		dateTo = req.Body.DateTo.Time
	}

	count := 0
	if req.Body.Count != nil {
		count = *req.Body.Count
	}

	var symbols []string
	if req.Body.Symbols != nil {
		symbols = *req.Body.Symbols
	}

	ingestReq := service.IngestRequest{
		Source:   string(req.Body.Source),
		Symbols:  symbols,
		DateFrom: dateFrom,
		DateTo:   dateTo,
		Count:    count,
	}

	result, err := h.ingestSvc.Ingest(ctx, ingestReq)
	if err != nil {
		return api.TriggerIngest500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	resp := api.IngestResponse{
		Source:       result.Source,
		DataType:     result.DataType,
		RowsIngested: result.RowsIngested,
		Status:       api.IngestResponseStatus(result.Status),
	}
	if result.Error != "" {
		resp.Error = &result.Error
	}

	return api.TriggerIngest200JSONResponse(resp), nil
}

// TriggerIngestAll handles POST /api/market-data/ingest/all
func (h *MarketDataHandler) TriggerIngestAll(ctx context.Context, req api.TriggerIngestAllRequestObject) (api.TriggerIngestAllResponseObject, error) {
	var dateFrom, dateTo time.Time
	if req.Body != nil {
		if req.Body.DateFrom != nil {
			dateFrom = req.Body.DateFrom.Time
		}
		if req.Body.DateTo != nil {
			dateTo = req.Body.DateTo.Time
		}
	}

	results, err := h.ingestSvc.IngestAll(ctx, dateFrom, dateTo)
	if err != nil {
		return api.TriggerIngestAll500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	out := make(api.TriggerIngestAll200JSONResponse, 0, len(results))
	for _, r := range results {
		resp := api.IngestResponse{
			Source:       r.Source,
			DataType:     r.DataType,
			RowsIngested: r.RowsIngested,
			Status:       api.IngestResponseStatus(r.Status),
		}
		if r.Error != "" {
			resp.Error = &r.Error
		}
		out = append(out, resp)
	}
	return out, nil
}

// GetPrices handles GET /api/market-data/prices
func (h *MarketDataHandler) GetPrices(ctx context.Context, req api.GetPricesRequestObject) (api.GetPricesResponseObject, error) {
	symbols := parseSymbols(req.Params.Symbols)
	dateFrom := dateParamToString(req.Params.DateFrom)
	dateTo := dateParamToString(req.Params.DateTo)
	source := ""
	if req.Params.Source != nil {
		source = *req.Params.Source
	}
	limit := 1000
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}

	prices, err := h.pricesRepo.GetPrices(ctx, symbols, dateFrom, dateTo, source, limit)
	if err != nil {
		return api.GetPrices500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	out := make(api.GetPrices200JSONResponse, 0, len(prices))
	for _, p := range prices {
		out = append(out, toAPIRawPrice(p))
	}
	return out, nil
}

// GetReturns handles GET /api/market-data/returns
func (h *MarketDataHandler) GetReturns(ctx context.Context, req api.GetReturnsRequestObject) (api.GetReturnsResponseObject, error) {
	symbols := parseSymbols(req.Params.Symbols)
	dateFrom := dateParamToString(req.Params.DateFrom)
	dateTo := dateParamToString(req.Params.DateTo)
	limit := 1000
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}

	returns, err := h.pricesRepo.GetReturns(ctx, symbols, dateFrom, dateTo, limit)
	if err != nil {
		return api.GetReturns500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	out := make(api.GetReturns200JSONResponse, 0, len(returns))
	for _, r := range returns {
		out = append(out, toAPIProcessedReturn(r))
	}
	return out, nil
}

// GetCreditData handles GET /api/market-data/credit
func (h *MarketDataHandler) GetCreditData(ctx context.Context, req api.GetCreditDataRequestObject) (api.GetCreditDataResponseObject, error) {
	source := ""
	if req.Params.Source != nil {
		source = *req.Params.Source
	}
	limit := 1000
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}

	records, err := h.creditRepo.GetCredit(ctx, source, req.Params.IsDefault, limit)
	if err != nil {
		return api.GetCreditData500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	out := make(api.GetCreditData200JSONResponse, 0, len(records))
	for _, rec := range records {
		out = append(out, toAPICreditRecord(rec))
	}
	return out, nil
}

// GetSources handles GET /api/market-data/sources
func (h *MarketDataHandler) GetSources(_ context.Context, _ api.GetSourcesRequestObject) (api.GetSourcesResponseObject, error) {
	sources := h.ingestSvc.ListSources()
	out := make(api.GetSources200JSONResponse, 0, len(sources))
	for _, s := range sources {
		out = append(out, api.DataSource{
			Name:        s.Name,
			DataType:    s.DataType,
			Description: s.Description,
			Schedule:    &s.Schedule,
		})
	}
	return out, nil
}

// GetIngestionLog handles GET /api/market-data/ingestion-log
func (h *MarketDataHandler) GetIngestionLog(ctx context.Context, req api.GetIngestionLogRequestObject) (api.GetIngestionLogResponseObject, error) {
	source := ""
	if req.Params.Source != nil {
		source = *req.Params.Source
	}
	status := ""
	if req.Params.Status != nil {
		status = string(*req.Params.Status)
	}
	limit := 100
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}

	entries, err := h.logRepo.List(ctx, source, status, limit)
	if err != nil {
		return api.GetIngestionLog500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}

	out := make(api.GetIngestionLog200JSONResponse, 0, len(entries))
	for _, e := range entries {
		out = append(out, toAPIIngestionLog(e))
	}
	return out, nil
}

// ── Conversion helpers ────────────────────────────────────────────────────────

func toAPIRawPrice(p models.RawPrice) api.RawPrice {
	r := api.RawPrice{
		Symbol:     p.Symbol,
		PriceDate:  timeToAPIDate(p.PriceDate),
		Close:      p.Close,
		IngestedAt: p.IngestedAt,
	}
	if p.Currency != "" {
		r.Currency = &p.Currency
	}
	if p.Source != "" {
		r.Source = &p.Source
	}
	return r
}

func toAPIProcessedReturn(ret models.ProcessedReturn) api.ProcessedReturn {
	return api.ProcessedReturn{
		Symbol:     ret.Symbol,
		PriceDate:  timeToAPIDate(ret.PriceDate),
		Ret:        ret.Ret,
		ComputedAt: ret.ComputedAt,
	}
}

func toAPICreditRecord(rec models.CreditRecord) api.CreditRecord {
	r := api.CreditRecord{
		Id:              rec.ID,
		LoanId:          rec.LoanID,
		BorrowerId:      rec.BorrowerID,
		LoanAmount:      rec.LoanAmount,
		InterestRate:    rec.InterestRate,
		TermMonths:      rec.TermMonths,
		CreditScore:     rec.CreditScore,
		IsDefault:       rec.IsDefault,
		OriginationDate: stringToDate(rec.OriginationDate),
		Source:          rec.Source,
		IngestedAt:      rec.IngestedAt,
	}
	if rec.LTVRatio != 0 {
		r.LtvRatio = &rec.LTVRatio
	}
	if rec.DTIRatio != 0 {
		r.DtiRatio = &rec.DTIRatio
	}
	if rec.DefaultDate != nil {
		d := stringToDate(*rec.DefaultDate)
		r.DefaultDate = &d
	}
	if rec.Sector != "" {
		r.Sector = &rec.Sector
	}
	return r
}

func toAPIIngestionLog(e models.IngestionLog) api.IngestionLog {
	r := api.IngestionLog{
		Id:           e.ID,
		Source:       e.Source,
		DataType:     e.DataType,
		Symbols:      e.Symbols,
		DateFrom:     timeToAPIDate(e.DateFrom),
		DateTo:       timeToAPIDate(e.DateTo),
		RowsIngested: e.RowsIngested,
		Status:       e.Status,
		CreatedAt:    e.CreatedAt,
	}
	if e.ErrorMessage != "" {
		r.ErrorMessage = &e.ErrorMessage
	}
	return r
}

// timeToAPIDate converts a wall-clock date (e.g. from Postgres DATE via pgx) to types.Date.
func timeToAPIDate(t time.Time) types.Date {
	u := t.UTC()
	return types.Date{Time: time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)}
}

// stringToDate converts a "YYYY-MM-DD" string to types.Date.
func stringToDate(s string) types.Date {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return types.Date{}
	}
	return types.Date{Time: t}
}

// dateParamToString converts an optional *types.Date query param to a "YYYY-MM-DD" string.
func dateParamToString(d *types.Date) string {
	if d == nil {
		return ""
	}
	return d.Time.Format("2006-01-02")
}

// parseSymbols splits a comma-separated symbols query param into a slice.
func parseSymbols(param *string) []string {
	if param == nil || *param == "" {
		return nil
	}
	parts := strings.Split(*param, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
