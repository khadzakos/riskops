package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/khadzakos/riskops/apps/portfolio-service/internal/repository"
	"github.com/khadzakos/riskops/pkg/kafka"
	"github.com/khadzakos/riskops/pkg/models"
	"go.uber.org/zap"
)

type PortfolioService struct {
	repo     *repository.PortfolioRepo
	log      *zap.Logger
	producer *kafka.Producer
}

func NewPortfolioService(repo *repository.PortfolioRepo, log *zap.Logger, producer *kafka.Producer) *PortfolioService {
	return &PortfolioService{repo: repo, log: log, producer: producer}
}

func (s *PortfolioService) List(ctx context.Context) ([]models.Portfolio, error) {
	return s.repo.List(ctx)
}

func (s *PortfolioService) GetByID(ctx context.Context, id int64) (*models.Portfolio, error) {
	return s.repo.GetByID(ctx, id)
}

func (s *PortfolioService) Create(ctx context.Context, name, description, currency string) (*models.Portfolio, error) {
	p, err := s.repo.Create(ctx, name, description, currency)
	if err != nil {
		return nil, err
	}
	s.log.Info("portfolio created", zap.Int64("id", p.ID), zap.String("name", p.Name))
	s.publishPortfolioUpdated(ctx, p.ID, "portfolio_created", nil)
	return p, nil
}

func (s *PortfolioService) Delete(ctx context.Context, id int64) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.log.Info("portfolio deleted", zap.Int64("id", id))
	s.publishPortfolioUpdated(ctx, id, "portfolio_deleted", nil)
	return nil
}

func (s *PortfolioService) ListPositions(ctx context.Context, portfolioID int64) ([]models.Position, error) {
	return s.repo.ListPositions(ctx, portfolioID)
}

func (s *PortfolioService) UpsertPosition(ctx context.Context, portfolioID int64, symbol string, quantity, price, weight float64) (*models.Position, error) {
	pos, err := s.repo.UpsertPosition(ctx, portfolioID, symbol, quantity, price, weight)
	if err != nil {
		return nil, err
	}
	s.log.Info("position upserted",
		zap.Int64("portfolio_id", portfolioID),
		zap.String("symbol", symbol),
		zap.Float64("quantity", quantity),
		zap.Float64("price", price),
		zap.Float64("weight", pos.Weight))
	sym := symbol
	s.publishPortfolioUpdated(ctx, portfolioID, "position_upserted", &sym)
	return pos, nil
}

func (s *PortfolioService) DeletePosition(ctx context.Context, portfolioID int64, symbol string) error {
	if err := s.repo.DeletePosition(ctx, portfolioID, symbol); err != nil {
		return err
	}
	s.log.Info("position deleted",
		zap.Int64("portfolio_id", portfolioID),
		zap.String("symbol", symbol))
	sym := symbol
	s.publishPortfolioUpdated(ctx, portfolioID, "position_deleted", &sym)
	return nil
}

func (s *PortfolioService) LatestRisk(ctx context.Context, portfolioID int64) ([]models.RiskResult, error) {
	return s.repo.LatestRisk(ctx, portfolioID)
}

func (s *PortfolioService) RiskHistory(ctx context.Context, portfolioID int64, limit int) ([]models.RiskResult, error) {
	return s.repo.RiskHistory(ctx, portfolioID, limit)
}

type portfolioUpdatedPayload struct {
	Event       string  `json:"event"`
	PortfolioID int64   `json:"portfolio_id"`
	Action      string  `json:"action"`
	Symbol      *string `json:"symbol,omitempty"`
	OccurredAt  string  `json:"occurred_at"`
}

func (s *PortfolioService) publishPortfolioUpdated(ctx context.Context, portfolioID int64, action string, symbol *string) {
	if s.producer == nil {
		return
	}
	p := portfolioUpdatedPayload{
		Event:       "portfolio.updated",
		PortfolioID: portfolioID,
		Action:      action,
		Symbol:      symbol,
		OccurredAt:  time.Now().UTC().Format(time.RFC3339),
	}
	b, err := json.Marshal(p)
	if err != nil {
		s.log.Warn("kafka: marshal portfolio.updated", zap.Error(err))
		return
	}
	key := []byte(fmt.Sprintf("%d", portfolioID))
	if err := s.producer.Publish(ctx, kafka.TopicPortfolioUpdated, key, b); err != nil {
		s.log.Warn("kafka: publish portfolio.updated", zap.Error(err))
	}
}
