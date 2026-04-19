#!/usr/bin/env bash
# Maps changed file paths (one per line) to docker compose service names for this repo.
# Prints a single space-separated line, or ALL_APPS, or nothing (no known app paths).
set -euo pipefail

file="${1:-}"
if [[ -z "${file}" || ! -f "${file}" ]]; then
  echo "usage: $0 changed_files.txt" >&2
  exit 1
fi

need_all=false
list="$(mktemp)"
cleanup() { rm -f "${list}"; }
trap cleanup EXIT

add() {
  grep -qxF "$1" "${list}" 2>/dev/null || echo "$1" >>"${list}"
}

add_go_stack() {
  add gateway
  add portfolio-service
  add market-data-service
}

add_airflow_stack() {
  add airflow-init
  add airflow-webserver
  add airflow-scheduler
}

while IFS= read -r f || [[ -n "${f}" ]]; do
  [[ -z "${f}" ]] && continue
  case "${f}" in
    docker-compose.yaml|docker-compose.yml|compose.yaml|compose.yml)
      need_all=true
      ;;
    go.mod|go.sum)
      add_go_stack
      ;;
    pkg/*)
      add_go_stack
      ;;
    apps/gateway/*|apps/gateway)
      add gateway
      ;;
    apps/portfolio-service/*|apps/portfolio-service)
      add portfolio-service
      ;;
    apps/market-data-service/*|apps/market-data-service)
      add market-data-service
      ;;
    apps/training-service/*|apps/training-service)
      add training-service
      ;;
    apps/inference-service/*|apps/inference-service)
      add inference-service
      ;;
    apps/frontend/*|apps/frontend)
      add frontend
      ;;
    apps/pipelines/*|apps/pipelines)
      add pipelines
      add_airflow_stack
      ;;
    infra/airflow/*|infra/airflow)
      add_airflow_stack
      ;;
    infra/prometheus/*)
      add prometheus
      ;;
    infra/grafana/*)
      add grafana
      ;;
    infra/db/*)
      add db
      ;;
    infra/caddy/*|infra/caddy)
      add caddy
      ;;
    *)
      ;;
  esac
done <"${file}"

if [[ "${need_all}" == true ]]; then
  printf '%s\n' "ALL_APPS"
  exit 0
fi

if [[ ! -s "${list}" ]]; then
  exit 0
fi

out=""
while IFS= read -r line; do
  [[ -z "${line}" ]] && continue
  out="${out}${line} "
done < <(sort -u "${list}")
printf '%s\n' "${out%% }"
