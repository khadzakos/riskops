package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/khadzakos/riskops/apps/portfolio-service/internal/service"
	"github.com/khadzakos/riskops/pkg/models"
)

type PortfolioHandler struct {
	svc *service.PortfolioService
}

func NewPortfolioHandler(svc *service.PortfolioService) *PortfolioHandler {
	return &PortfolioHandler{svc: svc}
}

func (h *PortfolioHandler) Register(r chi.Router) {
	r.Route("/api/portfolios", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Route("/{id}", func(r chi.Router) {
			r.Get("/", h.GetByID)
			r.Delete("/", h.Delete)
			r.Get("/positions", h.ListPositions)
			r.Post("/positions", h.UpsertPosition)
			r.Delete("/positions/{symbol}", h.DeletePosition)
			r.Get("/risk/latest", h.LatestRisk)
			r.Get("/risk", h.RiskHistory)
		})
	})
}

func (h *PortfolioHandler) List(w http.ResponseWriter, r *http.Request) {
	portfolios, err := h.svc.List(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if portfolios == nil {
		portfolios = []models.Portfolio{}
	}
	writeJSON(w, http.StatusOK, portfolios)
}

func (h *PortfolioHandler) GetByID(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	p, err := h.svc.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type createPortfolioReq struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Currency    string `json:"currency"`
}

func (h *PortfolioHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req createPortfolioReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name is required")
		return
	}
	if req.Currency == "" {
		req.Currency = "USD"
	}
	p, err := h.svc.Create(r.Context(), req.Name, req.Description, req.Currency)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

func (h *PortfolioHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	if err := h.svc.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *PortfolioHandler) ListPositions(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	positions, err := h.svc.ListPositions(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if positions == nil {
		positions = []models.Position{}
	}
	writeJSON(w, http.StatusOK, positions)
}

type upsertPositionReq struct {
	Symbol string  `json:"symbol"`
	Weight float64 `json:"weight"`
}

func (h *PortfolioHandler) UpsertPosition(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	var req upsertPositionReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.Symbol == "" {
		writeError(w, http.StatusBadRequest, "symbol is required")
		return
	}
	pos, err := h.svc.UpsertPosition(r.Context(), id, req.Symbol, req.Weight)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pos)
}

func (h *PortfolioHandler) DeletePosition(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	symbol := chi.URLParam(r, "symbol")
	if symbol == "" {
		writeError(w, http.StatusBadRequest, "symbol is required")
		return
	}
	if err := h.svc.DeletePosition(r.Context(), id, symbol); err != nil {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *PortfolioHandler) LatestRisk(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	results, err := h.svc.LatestRisk(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []models.RiskResult{}
	}
	writeJSON(w, http.StatusOK, results)
}

func (h *PortfolioHandler) RiskHistory(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid id")
		return
	}
	limit := 100
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			limit = n
		}
	}
	results, err := h.svc.RiskHistory(r.Context(), id, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if results == nil {
		results = []models.RiskResult{}
	}
	writeJSON(w, http.StatusOK, results)
}

func parseID(r *http.Request) (int64, error) {
	return strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
}
