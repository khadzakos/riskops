package handler

import (
	"net/http"
	"net/http/httputil"
	"net/url"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"
)

type ProxyHandler struct {
	log          *zap.Logger
	portfolioURL *url.URL
	marketURL    *url.URL
	inferenceURL *url.URL
	trainingURL  *url.URL
}

func NewProxyHandler(log *zap.Logger, portfolioURL, marketURL, inferenceURL, trainingURL string) *ProxyHandler {
	mustParse := func(raw string) *url.URL {
		u, err := url.Parse(raw)
		if err != nil {
			log.Fatal("invalid service url", zap.String("url", raw), zap.Error(err))
		}
		return u
	}
	return &ProxyHandler{
		log:          log,
		portfolioURL: mustParse(portfolioURL),
		marketURL:    mustParse(marketURL),
		inferenceURL: mustParse(inferenceURL),
		trainingURL:  mustParse(trainingURL),
	}
}

func (h *ProxyHandler) Register(r chi.Router) {
	r.Handle("/api/portfolios/*", h.reverseProxy(h.portfolioURL))
	r.Handle("/api/portfolios", h.reverseProxy(h.portfolioURL))
	// Top-level portfolio-service routes used by the UI (not under /api/portfolios/...)
	r.Handle("/api/risk-limits/*", h.reverseProxy(h.portfolioURL)) // TODO
	r.Handle("/api/alerts/*", h.reverseProxy(h.portfolioURL))      // TODO
	r.Handle("/api/portfolio-service/openapi.yaml", h.reverseProxy(h.portfolioURL))
	r.Handle("/api/portfolio-service/docs", h.reverseProxy(h.portfolioURL))
	r.Handle("/api/market-data/*", h.reverseProxy(h.marketURL))
	r.Handle("/api/market-data", h.reverseProxy(h.marketURL))
	// Inference Service — predict + stress scenarios
	r.Handle("/api/risk/predict/*", h.reverseProxy(h.inferenceURL))
	r.Handle("/api/risk/predict", h.reverseProxy(h.inferenceURL))
	r.Handle("/api/risk/scenarios/run", h.reverseProxy(h.inferenceURL))
	r.Handle("/api/risk/scenarios/*", h.reverseProxy(h.inferenceURL))
	r.Handle("/api/risk/scenarios", h.reverseProxy(h.inferenceURL))
	// Training Service — train + backtest + models
	r.Handle("/api/risk/train/*", h.reverseProxy(h.trainingURL))
	r.Handle("/api/risk/train", h.reverseProxy(h.trainingURL))
	r.Handle("/api/risk/backtest", h.reverseProxy(h.trainingURL))
	r.Handle("/api/risk/models/*", h.reverseProxy(h.trainingURL))
	r.Handle("/api/risk/models", h.reverseProxy(h.trainingURL))
}

func (h *ProxyHandler) reverseProxy(target *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(target)
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Host = target.Host
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		h.log.Error("proxy error",
			zap.String("target", target.String()),
			zap.String("path", r.URL.Path),
			zap.Error(err))
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"service unavailable"}`))
	}
	return proxy
}
