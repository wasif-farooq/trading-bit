#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
TEMPLATE_FILE="${PROJECT_ROOT}/env.template"

if command -v docker-compose >/dev/null 2>&1; then
	DOCKER_COMPOSE_CMD=("docker-compose")
elif command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
	DOCKER_COMPOSE_CMD=("docker" "compose")
else
	echo "Error: docker-compose (v1) or docker compose (v2) not found in PATH."
	echo "Please install Docker Compose or add it to your PATH."
	exit 1
fi

usage() {
	cat <<EOF
Usage: $(basename "$0") <command> [env-file]

Commands:
  up [env]       Start docker-compose services (default env: .env)
  down [env]     Stop docker-compose services
  logs [env]     Tail logs for running services
  ps [env]       Show status of docker-compose services

Examples:
  $(basename "$0") up
  $(basename "$0") up .env.simulation
  $(basename "$0") down
  $(basename "$0") ps
EOF
	exit 1
}

ensure_env_file() {
	local env_file="$1"
	if [[ -f "${env_file}" ]]; then
		return
	fi

	if [[ -f "${TEMPLATE_FILE}" ]]; then
		echo "Environment file '${env_file}' not found."
		echo "Creating it from template '${TEMPLATE_FILE}'."
		cp "${TEMPLATE_FILE}" "${env_file}"
		echo "Please review and update '${env_file}' before running again."
	else
		echo "Environment file '${env_file}' not found and no template available."
		exit 1
	fi
}

compose_cmd() {
	local env_file="$1"
	shift
	"${DOCKER_COMPOSE_CMD[@]}" --env-file "${env_file}" "$@"
}

COMMAND="${1:-}"
ENV_FILE_RELATIVE="${2:-.env}"
ENV_FILE="${PROJECT_ROOT}/${ENV_FILE_RELATIVE}"

if [[ -z "${COMMAND}" ]]; then
	usage
fi

case "${COMMAND}" in
	up|down|logs|ps)
		ensure_env_file "${ENV_FILE}"
		;;
	*)
		usage
		;;
esac

pushd "${PROJECT_ROOT}" >/dev/null

case "${COMMAND}" in
	up)
		echo "Starting services using env file '${ENV_FILE_RELATIVE}'..."
		compose_cmd "${ENV_FILE_RELATIVE}" up -d
		;;
	down)
		echo "Stopping services using env file '${ENV_FILE_RELATIVE}'..."
		compose_cmd "${ENV_FILE_RELATIVE}" down
		;;
	logs)
		echo "Tailing logs using env file '${ENV_FILE_RELATIVE}'..."
		compose_cmd "${ENV_FILE_RELATIVE}" logs -f
		;;
	ps)
		compose_cmd "${ENV_FILE_RELATIVE}" ps
		;;
esac

popd >/dev/null

