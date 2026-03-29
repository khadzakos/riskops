package collector

import (
	"context"
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/khadzakos/riskops/pkg/models"
)

var sectors = []string{
	"technology", "finance", "healthcare", "retail", "manufacturing",
	"energy", "real_estate", "transportation", "agriculture", "construction",
}

// CreditSyntheticCollector generates synthetic credit portfolio data.
// Statistical distributions are calibrated to realistic credit portfolio characteristics:
//   - Default rates: ~2-5% base rate, correlated with credit score
//   - Credit scores: bimodal distribution (prime + subprime)
//   - LTV/DTI: truncated normal distributions
type CreditSyntheticCollector struct {
	rng *rand.Rand
}

func NewCreditSyntheticCollector() *CreditSyntheticCollector {
	return &CreditSyntheticCollector{
		rng: rand.New(rand.NewSource(time.Now().UnixNano())),
	}
}

func (c *CreditSyntheticCollector) Name() string { return "credit_synthetic" }

func (c *CreditSyntheticCollector) SupportedTypes() []DataType {
	return []DataType{DataTypeCreditData}
}

func (c *CreditSyntheticCollector) Collect(_ context.Context, req CollectRequest) (*CollectResult, error) {
	count := req.Count
	if count <= 0 {
		count = 1000 // default batch size
	}
	if count > 100000 {
		return nil, fmt.Errorf("credit_synthetic: count exceeds maximum of 100000")
	}

	now := time.Now().UTC()
	credits := make([]models.CreditRecord, 0, count)

	for i := 0; i < count; i++ {
		record := c.generateLoan(i, now)
		credits = append(credits, record)
	}

	return &CollectResult{
		Source:   c.Name(),
		DataType: DataTypeCreditData,
		Credits:  credits,
		RowCount: len(credits),
	}, nil
}

func (c *CreditSyntheticCollector) generateLoan(idx int, now time.Time) models.CreditRecord {
	// Bimodal credit score: ~60% prime (680-850), ~40% subprime (300-679)
	var creditScore int
	if c.rng.Float64() < 0.60 {
		// Prime segment: normal around 740, std 60, clamped [680, 850]
		creditScore = clampInt(int(740+c.rng.NormFloat64()*60), 680, 850)
	} else {
		// Subprime segment: normal around 580, std 80, clamped [300, 679]
		creditScore = clampInt(int(580+c.rng.NormFloat64()*80), 300, 679)
	}

	// Loan amount: log-normal, median ~500K, range 100K-10M
	loanAmount := math.Round(math.Exp(13.1+c.rng.NormFloat64()*0.8)*100) / 100
	loanAmount = math.Max(100_000, math.Min(10_000_000, loanAmount))

	// Interest rate: correlated with credit score (higher score → lower rate)
	// Range 3-25%, inversely correlated with credit score
	scoreNorm := float64(creditScore-300) / float64(850-300) // 0..1
	baseRate := 0.25 - scoreNorm*0.22                        // 3%..25%
	interestRate := math.Round((baseRate+c.rng.NormFloat64()*0.01)*100000) / 100000
	interestRate = math.Max(0.03, math.Min(0.25, interestRate))

	// Term: 12, 24, 36, 60, 120, 180, 240, 360 months
	termOptions := []int{12, 24, 36, 60, 120, 180, 240, 360}
	termMonths := termOptions[c.rng.Intn(len(termOptions))]

	// LTV ratio: truncated normal, mean 0.75, std 0.15, range [0.3, 1.2]
	ltv := math.Round((0.75+c.rng.NormFloat64()*0.15)*100000) / 100000
	ltv = math.Max(0.3, math.Min(1.2, ltv))

	// DTI ratio: truncated normal, mean 0.35, std 0.10, range [0.1, 0.6]
	dti := math.Round((0.35+c.rng.NormFloat64()*0.10)*100000) / 100000
	dti = math.Max(0.1, math.Min(0.6, dti))

	// Default probability: logistic function of credit score and DTI
	// P(default) = sigmoid(-8 + 0.01*(850-score) + 5*dti)
	logit := -8.0 + 0.01*float64(850-creditScore) + 5.0*dti
	pDefault := 1.0 / (1.0 + math.Exp(-logit))
	isDefault := c.rng.Float64() < pDefault

	// Origination date: random within last 5 years
	daysAgo := c.rng.Intn(5 * 365)
	originationDate := now.AddDate(0, 0, -daysAgo)

	var defaultDate *string
	if isDefault {
		// Default occurs 6-24 months after origination
		defaultMonths := 6 + c.rng.Intn(18)
		dd := originationDate.AddDate(0, defaultMonths, 0)
		if dd.After(now) {
			dd = now.AddDate(0, -1, 0)
		}
		s := dd.Format("2006-01-02")
		defaultDate = &s
	}

	sector := sectors[c.rng.Intn(len(sectors))]

	return models.CreditRecord{
		LoanID:          fmt.Sprintf("LOAN-%08d", idx+1),
		BorrowerID:      fmt.Sprintf("BORR-%08d", c.rng.Intn(count(idx))+1),
		LoanAmount:      loanAmount,
		InterestRate:    interestRate,
		TermMonths:      termMonths,
		CreditScore:     creditScore,
		LTVRatio:        ltv,
		DTIRatio:        dti,
		IsDefault:       isDefault,
		DefaultDate:     defaultDate,
		OriginationDate: originationDate.Format("2006-01-02"),
		Sector:          sector,
		Source:          "synthetic",
		IngestedAt:      now,
	}
}

func clampInt(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// count returns a reasonable borrower pool size based on loan index.
func count(idx int) int {
	pool := idx / 3
	if pool < 1 {
		return 1
	}
	return pool
}
