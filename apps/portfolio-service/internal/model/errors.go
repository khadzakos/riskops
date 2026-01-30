package model

import "errors"

var (
	// ErrInvalidPositionData возникает когда позиция не имеет ни quantity, ни weight
	ErrInvalidPositionData = errors.New("position must have either quantity or weight")

	// ErrInvalidWeight возникает когда weight выходит за пределы 0-100
	ErrInvalidWeight = errors.New("weight must be between 0 and 100")

	// ErrInvalidQuantity возникает когда quantity <= 0
	ErrInvalidQuantity = errors.New("quantity must be greater than 0")

	// ErrEmptyPortfolioName возникает когда имя портфеля пустое
	ErrEmptyPortfolioName = errors.New("portfolio name cannot be empty")

	// ErrEmptyPositions возникает когда портфель создается без позиций
	ErrEmptyPositions = errors.New("portfolio must have at least one position")
)
