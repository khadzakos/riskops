package handler

import (
	"context"

	"github.com/khadzakos/riskops/apps/portfolio-service/internal/api"
	"github.com/khadzakos/riskops/apps/portfolio-service/internal/service"
	"github.com/khadzakos/riskops/pkg/models"
)

var _ api.StrictServerInterface = (*PortfolioHandler)(nil)

type PortfolioHandler struct {
	svc *service.PortfolioService
}

func NewPortfolioHandler(svc *service.PortfolioService) *PortfolioHandler {
	return &PortfolioHandler{svc: svc}
}

func (h *PortfolioHandler) ListPortfolios(ctx context.Context, _ api.ListPortfoliosRequestObject) (api.ListPortfoliosResponseObject, error) {
	portfolios, err := h.svc.List(ctx)
	if err != nil {
		return api.ListPortfolios500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	out := make(api.ListPortfolios200JSONResponse, 0, len(portfolios))
	for _, p := range portfolios {
		out = append(out, toAPIPortfolio(p))
	}
	return out, nil
}

func (h *PortfolioHandler) CreatePortfolio(ctx context.Context, req api.CreatePortfolioRequestObject) (api.CreatePortfolioResponseObject, error) {
	if req.Body == nil || req.Body.Name == "" {
		return api.CreatePortfolio400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "name is required"}}, nil
	}
	currency := "USD"
	if req.Body.Currency != nil {
		currency = *req.Body.Currency
	}
	description := ""
	if req.Body.Description != nil {
		description = *req.Body.Description
	}
	p, err := h.svc.Create(ctx, req.Body.Name, description, currency)
	if err != nil {
		return api.CreatePortfolio500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	return api.CreatePortfolio201JSONResponse(toAPIPortfolio(*p)), nil
}

func (h *PortfolioHandler) GetPortfolio(ctx context.Context, req api.GetPortfolioRequestObject) (api.GetPortfolioResponseObject, error) {
	p, err := h.svc.GetByID(ctx, req.Id)
	if err != nil {
		return api.GetPortfolio404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse{Error: err.Error()}}, nil
	}
	return api.GetPortfolio200JSONResponse(toAPIPortfolio(*p)), nil
}

func (h *PortfolioHandler) DeletePortfolio(ctx context.Context, req api.DeletePortfolioRequestObject) (api.DeletePortfolioResponseObject, error) {
	if err := h.svc.Delete(ctx, req.Id); err != nil {
		return api.DeletePortfolio404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse{Error: err.Error()}}, nil
	}
	return api.DeletePortfolio204Response{}, nil
}

func (h *PortfolioHandler) ListPositions(ctx context.Context, req api.ListPositionsRequestObject) (api.ListPositionsResponseObject, error) {
	positions, err := h.svc.ListPositions(ctx, req.Id)
	if err != nil {
		return api.ListPositions500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	out := make(api.ListPositions200JSONResponse, 0, len(positions))
	for _, p := range positions {
		out = append(out, toAPIPosition(p))
	}
	return out, nil
}

func (h *PortfolioHandler) UpsertPosition(ctx context.Context, req api.UpsertPositionRequestObject) (api.UpsertPositionResponseObject, error) {
	if req.Body == nil || req.Body.Symbol == "" {
		return api.UpsertPosition400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse{Error: "symbol is required"}}, nil
	}
	var weight float64
	if req.Body.Weight != nil {
		weight = *req.Body.Weight
	}
	pos, err := h.svc.UpsertPosition(ctx, req.Id, req.Body.Symbol, weight)
	if err != nil {
		return api.UpsertPosition500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	return api.UpsertPosition200JSONResponse(toAPIPosition(*pos)), nil
}

func (h *PortfolioHandler) DeletePosition(ctx context.Context, req api.DeletePositionRequestObject) (api.DeletePositionResponseObject, error) {
	if err := h.svc.DeletePosition(ctx, req.Id, req.Symbol); err != nil {
		return api.DeletePosition404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse{Error: err.Error()}}, nil
	}
	return api.DeletePosition204Response{}, nil
}

func (h *PortfolioHandler) GetLatestRisk(ctx context.Context, req api.GetLatestRiskRequestObject) (api.GetLatestRiskResponseObject, error) {
	results, err := h.svc.LatestRisk(ctx, req.Id)
	if err != nil {
		return api.GetLatestRisk500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	out := make(api.GetLatestRisk200JSONResponse, 0, len(results))
	for _, r := range results {
		out = append(out, toAPIRiskResult(r))
	}
	return out, nil
}

func (h *PortfolioHandler) GetRiskHistory(ctx context.Context, req api.GetRiskHistoryRequestObject) (api.GetRiskHistoryResponseObject, error) {
	limit := 100
	if req.Params.Limit != nil && *req.Params.Limit > 0 {
		limit = *req.Params.Limit
	}
	results, err := h.svc.RiskHistory(ctx, req.Id, limit)
	if err != nil {
		return api.GetRiskHistory500JSONResponse{InternalErrorJSONResponse: api.InternalErrorJSONResponse{Error: err.Error()}}, nil
	}
	out := make(api.GetRiskHistory200JSONResponse, 0, len(results))
	for _, r := range results {
		out = append(out, toAPIRiskResult(r))
	}
	return out, nil
}

func toAPIPortfolio(p models.Portfolio) api.Portfolio {
	return api.Portfolio{
		Id:          p.ID,
		Name:        p.Name,
		Description: p.Description,
		Currency:    p.Currency,
		CreatedAt:   p.CreatedAt,
		UpdatedAt:   p.UpdatedAt,
	}
}

func toAPIPosition(p models.Position) api.Position {
	return api.Position{
		PortfolioId: p.PortfolioID,
		Symbol:      p.Symbol,
		Weight:      p.Weight,
		UpdatedAt:   p.UpdatedAt,
	}
}

func toAPIRiskResult(r models.RiskResult) api.RiskResult {
	return api.RiskResult{
		Id:           r.ID,
		PortfolioId:  r.PortfolioID,
		AsofDate:     r.AsofDate,
		HorizonDays:  r.HorizonDays,
		Alpha:        r.Alpha,
		Method:       r.Method,
		Metric:       r.Metric,
		Value:        r.Value,
		ModelVersion: r.ModelVersion,
		CreatedAt:    r.CreatedAt,
	}
}
