package service

import (
	"context"
	"fmt"
	"time"

	"github.com/khadzakos/riskops/apps/market-data-service/internal/repository"
	"github.com/khadzakos/riskops/pkg/models"
	"go.uber.org/zap"
)

type ReturnsService struct {
	pricesRepo *repository.PricesRepo
	log        *zap.Logger
}

func NewReturnsService(pricesRepo *repository.PricesRepo, log *zap.Logger) *ReturnsService {
	return &ReturnsService{pricesRepo: pricesRepo, log: log}
}

func (s *ReturnsService) ComputeAndStore(ctx context.Context, symbols []string) (int, error) {
	if len(symbols) == 0 {
		var err error
		symbols, err = s.pricesRepo.GetDistinctSymbols(ctx)
		if err != nil {
			return 0, fmt.Errorf("get distinct symbols: %w", err)
		}
	}

	total := 0
	for _, symbol := range symbols {
		n, err := s.computeForSymbol(ctx, symbol)
		if err != nil {
			s.log.Warn("failed to compute returns for symbol",
				zap.String("symbol", symbol),
				zap.Error(err))
			continue
		}
		total += n
	}

	s.log.Info("returns computed", zap.Int("total_rows", total), zap.Int("symbols", len(symbols)))
	return total, nil
}

func (s *ReturnsService) computeForSymbol(ctx context.Context, symbol string) (int, error) {
	prices, err := s.pricesRepo.GetPricesForReturns(ctx, symbol)
	if err != nil {
		return 0, err
	}
	if len(prices) < 2 {
		return 0, nil // need at least 2 data points
	}

	now := time.Now().UTC()
	returns := make([]models.ProcessedReturn, 0, len(prices)-1)

	for i := 1; i < len(prices); i++ {
		prev := prices[i-1].Close
		curr := prices[i].Close
		if prev == 0 {
			continue
		}
		ret := (curr - prev) / prev
		returns = append(returns, models.ProcessedReturn{
			Symbol:     symbol,
			PriceDate:  prices[i].PriceDate,
			Ret:        ret,
			ComputedAt: now,
		})
	}

	n, err := s.pricesRepo.UpsertReturns(ctx, returns)
	if err != nil {
		return 0, fmt.Errorf("upsert returns for %s: %w", symbol, err)
	}
	return n, nil
}
