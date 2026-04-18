#!/usr/bin/env bash
# =============================================================================
# RiskOps — End-to-End Integration Test
# =============================================================================
# Tests the full pipeline:
#   market data ingest → model training → risk inference → result verification
#
# Usage:
#   ./scripts/e2e_test.sh [--skip-ingest] [--skip-train] [--skip-infer]
#
# Prerequisites:
#   docker compose --profile all up -d --build
#
# Exit codes:
#   0 — all tests passed
#   1 — one or more tests failed
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
GW="${GATEWAY_URL:-http://localhost:8081}"
MDS="${MDS_URL:-http://localhost:8083}"
TRAINING="${TRAINING_URL:-http://localhost:8084}"
INFERENCE="${INFERENCE_URL:-http://localhost:8085}"
PORTFOLIO="${PORTFOLIO_URL:-http://localhost:8082}"

SKIP_INGEST=false
SKIP_TRAIN=false
SKIP_INFER=false

for arg in "$@"; do
  case $arg in
    --skip-ingest) SKIP_INGEST=true ;;
    --skip-train)  SKIP_TRAIN=true  ;;
    --skip-infer)  SKIP_INFER=true  ;;
  esac
done

# ---------------------------------------------------------------------------
# Colours & helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

_pass() { echo -e "  ${GREEN}✓${NC} $1"; ((PASS++)); }
_fail() { echo -e "  ${RED}✗${NC} $1"; ((FAIL++)); }
_skip() { echo -e "  ${YELLOW}–${NC} $1 (skipped)"; ((SKIP++)); }
_info() { echo -e "  ${CYAN}→${NC} $1"; }
_section() { echo -e "\n${BOLD}${CYAN}══ $1 ══${NC}"; }

# Retry a curl command up to N times with a delay
_retry_curl() {
  local max_attempts=$1; shift
  local delay=$1; shift
  local attempt=1
  while (( attempt <= max_attempts )); do
    if "$@" 2>/dev/null; then return 0; fi
    _info "Attempt $attempt/$max_attempts failed, retrying in ${delay}s..."
    sleep "$delay"
    ((attempt++))
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. Health checks
# ---------------------------------------------------------------------------
_section "Health Checks"

check_health() {
  local name=$1 url=$2
  local status
  status=$(curl -sf -o /dev/null -w "%{http_code}" "${url}/health" 2>/dev/null || echo "000")
  if [[ "$status" == "200" ]]; then
    _pass "$name is healthy (HTTP 200)"
  else
    _fail "$name health check failed (HTTP $status at ${url}/health)"
  fi
}

check_health "API Gateway"          "$GW"
check_health "Portfolio Service"    "$PORTFOLIO"
check_health "Market Data Service"  "$MDS"
check_health "Training Service"     "$TRAINING"
check_health "Inference Service"    "$INFERENCE"

# ---------------------------------------------------------------------------
# 2. Portfolio CRUD
# ---------------------------------------------------------------------------
_section "Portfolio Service — CRUD"

# Create a test portfolio
CREATE_RESP=$(curl -sf -X POST "${PORTFOLIO}/api/portfolios" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e-test-portfolio","description":"Created by e2e_test.sh"}' 2>/dev/null || echo "{}")

PORTFOLIO_ID=$(echo "$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")

if [[ -n "$PORTFOLIO_ID" && "$PORTFOLIO_ID" != "null" ]]; then
  _pass "Created portfolio id=$PORTFOLIO_ID"
else
  _fail "Failed to create portfolio — response: $CREATE_RESP"
  PORTFOLIO_ID=1   # fallback to id=1 for subsequent tests
fi

# Add a position
POS_RESP=$(curl -sf -X POST "${PORTFOLIO}/api/portfolios/${PORTFOLIO_ID}/positions" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"AAPL","quantity":100,"avg_price":150.0}' 2>/dev/null || echo "{}")

if echo "$POS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('symbol') else 1)" 2>/dev/null; then
  _pass "Added position AAPL to portfolio $PORTFOLIO_ID"
else
  _fail "Failed to add position — response: $POS_RESP"
fi

# Add a second position
curl -sf -X POST "${PORTFOLIO}/api/portfolios/${PORTFOLIO_ID}/positions" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"MSFT","quantity":50,"avg_price":300.0}' > /dev/null 2>&1 && \
  _pass "Added position MSFT to portfolio $PORTFOLIO_ID" || \
  _fail "Failed to add MSFT position"

# List portfolios
LIST_RESP=$(curl -sf "${PORTFOLIO}/api/portfolios" 2>/dev/null || echo "[]")
COUNT=$(echo "$LIST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('total',0))" 2>/dev/null || echo "0")
if (( COUNT > 0 )); then
  _pass "Listed portfolios: $COUNT found"
else
  _fail "Portfolio list returned 0 results"
fi

# ---------------------------------------------------------------------------
# 3. Market Data Ingestion
# ---------------------------------------------------------------------------
_section "Market Data Service — Ingestion"

if [[ "$SKIP_INGEST" == "true" ]]; then
  _skip "Market data ingestion"
else
  # Synthetic data (fast, no external API needed)
  _info "Ingesting synthetic market data (AAPL, MSFT, GOOGL)..."
  INGEST_RESP=$(curl -sf -X POST "${MDS}/api/market-data/ingest" \
    -H "Content-Type: application/json" \
    -d '{"source":"synthetic","symbols":["AAPL","MSFT","GOOGL"],"days":300}' \
    --max-time 120 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$INGEST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(1 if d.get('error') else 0)" 2>/dev/null; then
    ROWS=$(echo "$INGEST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('rows_ingested', d.get('count', '?')))" 2>/dev/null || echo "?")
    _pass "Synthetic ingestion completed: $ROWS rows"
  else
    _fail "Synthetic ingestion failed: $INGEST_RESP"
  fi

  # Synthetic credit data
  _info "Ingesting synthetic credit data..."
  CREDIT_RESP=$(curl -sf -X POST "${MDS}/api/market-data/ingest" \
    -H "Content-Type: application/json" \
    -d '{"source":"credit_synthetic","count":500}' \
    --max-time 60 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$CREDIT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(1 if d.get('error') else 0)" 2>/dev/null; then
    _pass "Credit data ingestion completed"
  else
    _fail "Credit data ingestion failed: $CREDIT_RESP"
  fi

  # Verify prices endpoint
  PRICES_RESP=$(curl -sf "${MDS}/api/market-data/prices?symbols=AAPL&limit=5" 2>/dev/null || echo "[]")
  PRICE_COUNT=$(echo "$PRICES_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('count',0))" 2>/dev/null || echo "0")
  if (( PRICE_COUNT > 0 )); then
    _pass "Prices endpoint returned $PRICE_COUNT rows for AAPL"
  else
    _fail "Prices endpoint returned no data for AAPL"
  fi

  # Verify returns endpoint
  RETURNS_RESP=$(curl -sf "${MDS}/api/market-data/returns?symbols=AAPL&limit=5" 2>/dev/null || echo "[]")
  RET_COUNT=$(echo "$RETURNS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d.get('count',0))" 2>/dev/null || echo "0")
  if (( RET_COUNT > 0 )); then
    _pass "Returns endpoint returned $RET_COUNT rows for AAPL"
  else
    _fail "Returns endpoint returned no data for AAPL"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Model Training
# ---------------------------------------------------------------------------
_section "Training Service — Model Training"

JOB_ID=""

if [[ "$SKIP_TRAIN" == "true" ]]; then
  _skip "Model training"
else
  _info "Triggering GARCH + Monte Carlo training on AAPL, MSFT, GOOGL..."
  TRAIN_RESP=$(curl -sf -X POST "${TRAINING}/api/risk/train" \
    -H "Content-Type: application/json" \
    -d '{"symbols":["AAPL","MSFT","GOOGL"],"model_type":"all","alpha":0.99,"lookback_days":252,"n_simulations":5000}' \
    --max-time 30 2>/dev/null || echo '{"error":"timeout"}')

  JOB_ID=$(echo "$TRAIN_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('job_id',''))" 2>/dev/null || echo "")

  if [[ -n "$JOB_ID" && "$JOB_ID" != "null" ]]; then
    _pass "Training job queued: job_id=$JOB_ID"
  else
    _fail "Training job submission failed: $TRAIN_RESP"
  fi

  # Poll for completion (max 10 min)
  if [[ -n "$JOB_ID" ]]; then
    _info "Polling training job $JOB_ID (max 600s)..."
    MAX_WAIT=600
    ELAPSED=0
    INTERVAL=15
    TRAIN_STATUS="queued"

    while (( ELAPSED < MAX_WAIT )); do
      STATUS_RESP=$(curl -sf "${TRAINING}/api/risk/train/status/${JOB_ID}" --max-time 15 2>/dev/null || echo '{"status":"unknown"}')
      TRAIN_STATUS=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")

      if [[ "$TRAIN_STATUS" == "completed" ]]; then
        RESULT_COUNT=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('results',[])))" 2>/dev/null || echo "0")
        _pass "Training completed: $RESULT_COUNT model(s) trained"

        # Log model metrics
        echo "$STATUS_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for r in d.get('results', []):
    print(f\"    model={r.get('model_name','?')}  version={r.get('model_version','?')}  VaR={r.get('var',0):.4f}  CVaR={r.get('cvar',0):.4f}  status={r.get('status','?')}\")
" 2>/dev/null || true
        break
      elif [[ "$TRAIN_STATUS" == "failed" ]]; then
        ERR=$(echo "$STATUS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','unknown'))" 2>/dev/null || echo "unknown")
        _fail "Training job failed: $ERR"
        break
      fi

      _info "  status=$TRAIN_STATUS  elapsed=${ELAPSED}s..."
      sleep "$INTERVAL"
      ELAPSED=$((ELAPSED + INTERVAL))
    done

    if [[ "$TRAIN_STATUS" != "completed" && "$TRAIN_STATUS" != "failed" ]]; then
      _fail "Training job timed out after ${MAX_WAIT}s (last status: $TRAIN_STATUS)"
    fi
  fi

  # List registered models
  MODELS_RESP=$(curl -sf "${TRAINING}/api/risk/models" --max-time 15 2>/dev/null || echo '{"models":[],"total":0}')
  MODEL_COUNT=$(echo "$MODELS_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('total',0))" 2>/dev/null || echo "0")
  if (( MODEL_COUNT > 0 )); then
    _pass "Model registry: $MODEL_COUNT model(s) registered"
  else
    _fail "Model registry is empty after training"
  fi
fi

# ---------------------------------------------------------------------------
# 5. Risk Inference
# ---------------------------------------------------------------------------
_section "Inference Service — Risk Prediction"

if [[ "$SKIP_INFER" == "true" ]]; then
  _skip "Risk inference"
else
  # Check model health
  HEALTH_RESP=$(curl -sf "${INFERENCE}/api/risk/predict/health" --max-time 15 2>/dev/null || echo '{"status":"unknown","loaded_models":[]}')
  INF_STATUS=$(echo "$HEALTH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','unknown'))" 2>/dev/null || echo "unknown")
  LOADED=$(echo "$HEALTH_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(d.get('loaded_models',[])))" 2>/dev/null || echo "")
  _info "Inference model health: status=$INF_STATUS  loaded_models=[$LOADED]"

  # Determine best available method
  if echo "$LOADED" | grep -q "garch"; then
    METHOD="garch"
  elif echo "$LOADED" | grep -q "montecarlo"; then
    METHOD="montecarlo"
  else
    METHOD="historical"
  fi
  _info "Using inference method: $METHOD"

  # Run prediction for the test portfolio
  _info "Running risk prediction for portfolio_id=$PORTFOLIO_ID..."
  PREDICT_RESP=$(curl -sf -X POST "${INFERENCE}/api/risk/predict" \
    -H "Content-Type: application/json" \
    -d "{\"portfolio_id\":${PORTFOLIO_ID},\"method\":\"${METHOD}\",\"alpha\":0.99,\"horizon_days\":1}" \
    --max-time 120 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$PREDICT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(1 if d.get('error') else 0)" 2>/dev/null; then
    VAR=$(echo "$PREDICT_RESP"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('var',0):.4f}\")"  2>/dev/null || echo "?")
    CVAR=$(echo "$PREDICT_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('cvar',0):.4f}\")" 2>/dev/null || echo "?")
    VOL=$(echo "$PREDICT_RESP"  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('volatility',0):.4f}\")" 2>/dev/null || echo "?")
    _pass "Risk prediction: VaR=$VAR  CVaR=$CVAR  volatility=$VOL  method=$METHOD"
  else
    _fail "Risk prediction failed: $PREDICT_RESP"
  fi

  # Also test historical fallback
  _info "Testing historical simulation fallback..."
  HIST_RESP=$(curl -sf -X POST "${INFERENCE}/api/risk/predict" \
    -H "Content-Type: application/json" \
    -d "{\"portfolio_id\":${PORTFOLIO_ID},\"method\":\"historical\",\"alpha\":0.99,\"horizon_days\":1}" \
    --max-time 120 2>/dev/null || echo '{"error":"timeout"}')

  if echo "$HIST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(1 if d.get('error') else 0)" 2>/dev/null; then
    VAR_H=$(echo "$HIST_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"{d.get('var',0):.4f}\")" 2>/dev/null || echo "?")
    _pass "Historical simulation: VaR=$VAR_H"
  else
    _fail "Historical simulation failed: $HIST_RESP"
  fi
fi

# ---------------------------------------------------------------------------
# 6. API Gateway routing
# ---------------------------------------------------------------------------
_section "API Gateway — Route Verification"

# Gateway should proxy /api/portfolios → portfolio-service
GW_PORT_RESP=$(curl -sf "${GW}/api/portfolios" --max-time 15 2>/dev/null || echo "")
if [[ -n "$GW_PORT_RESP" ]]; then
  _pass "Gateway proxies /api/portfolios correctly"
else
  _fail "Gateway /api/portfolios returned empty response"
fi

# Gateway should proxy /api/market-data/sources → market-data-service
GW_MDS_RESP=$(curl -sf "${GW}/api/market-data/sources" --max-time 15 2>/dev/null || echo "")
if [[ -n "$GW_MDS_RESP" ]]; then
  _pass "Gateway proxies /api/market-data/sources correctly"
else
  _fail "Gateway /api/market-data/sources returned empty response"
fi

# ---------------------------------------------------------------------------
# 7. Cleanup
# ---------------------------------------------------------------------------
_section "Cleanup"

if [[ -n "$PORTFOLIO_ID" && "$PORTFOLIO_ID" != "1" ]]; then
  DEL_STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X DELETE \
    "${PORTFOLIO}/api/portfolios/${PORTFOLIO_ID}" --max-time 15 2>/dev/null || echo "000")
  if [[ "$DEL_STATUS" == "200" || "$DEL_STATUS" == "204" || "$DEL_STATUS" == "404" ]]; then
    _pass "Deleted test portfolio $PORTFOLIO_ID"
  else
    _fail "Failed to delete test portfolio $PORTFOLIO_ID (HTTP $DEL_STATUS)"
  fi
else
  _skip "Portfolio cleanup (using fallback id=1)"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "${BOLD}  E2E Test Results${NC}"
echo -e "${BOLD}══════════════════════════════════════════${NC}"
echo -e "  ${GREEN}Passed:${NC}  $PASS"
echo -e "  ${RED}Failed:${NC}  $FAIL"
echo -e "  ${YELLOW}Skipped:${NC} $SKIP"
echo -e "${BOLD}══════════════════════════════════════════${NC}"

if (( FAIL > 0 )); then
  echo -e "\n${RED}${BOLD}RESULT: FAILED ($FAIL test(s) failed)${NC}\n"
  exit 1
else
  echo -e "\n${GREEN}${BOLD}RESULT: ALL TESTS PASSED${NC}\n"
  exit 0
fi
