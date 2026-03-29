package service

import (
	"context"

	"github.com/khadzakos/riskops/apps/portfolio-service/internal/repository"
	"github.com/khadzakos/riskops/pkg/models"
	"go.uber.org/zap"
)

type PortfolioService struct {
	repo *repository.PortfolioRepo
	log  *zap.Logger
}

func NewPortfolioService(repo *repository.PortfolioRepo, log *zap.Logger) *PortfolioService {
	return &PortfolioService{repo: repo, log: log}
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
	return p, nil
}

func (s *PortfolioService) Delete(ctx context.Context, id int64) error {
	if err := s.repo.Delete(ctx, id); err != nil {
		return err
	}
	s.log.Info("portfolio deleted", zap.Int64("id", id))
	return nil
}

func (s *PortfolioService) ListPositions(ctx context.Context, portfolioID int64) ([]models.Position, error) {
	return s.repo.ListPositions(ctx, portfolioID)
}

func (s *PortfolioService) UpsertPosition(ctx context.Context, portfolioID int64, symbol string, weight float64) (*models.Position, error) {
	pos, err := s.repo.UpsertPosition(ctx, portfolioID, symbol, weight)
	if err != nil {
		return nil, err
	}
	s.log.Info("position upserted",
		zap.Int64("portfolio_id", portfolioID),
		zap.String("symbol", symbol),
		zap.Float64("weight", weight))
	return pos, nil
}

func (s *PortfolioService) DeletePosition(ctx context.Context, portfolioID int64, symbol string) error {
	if err := s.repo.DeletePosition(ctx, portfolioID, symbol); err != nil {
		return err
	}
	s.log.Info("position deleted",
		zap.Int64("portfolio_id", portfolioID),
		zap.String("symbol", symbol))
	return nil
}

func (s *PortfolioService) LatestRisk(ctx context.Context, portfolioID int64) ([]models.RiskResult, error) {
	return s.repo.LatestRisk(ctx, portfolioID)
}

func (s *PortfolioService) RiskHistory(ctx context.Context, portfolioID int64, limit int) ([]models.RiskResult, error) {
	return s.repo.RiskHistory(ctx, portfolioID, limit)
}
