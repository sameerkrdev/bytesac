#!/usr/bin/env bash
# Deploys one commit of main on this VM with rootless Docker (runs as the ordinary user that owns the checkout; no
# sudo, no root daemon): check it out, build the images, run the migrations, restart the stack and wait until the API
# is healthy. Used by .github/workflows/deploy.yml (through a forced SSH command, which passes the
# commit in SSH_ORIGINAL_COMMAND) and by hand:
#
#   git -C ~/bytesac fetch origin && ~/bytesac/infra/server/deploy.sh "$(git -C ~/bytesac rev-parse origin/main)"
#
# Only full commit hashes already on origin/main are accepted. Rollback = run it with an older commit of main.
# Runbook: docs/engineering/DEPLOY-GCP.md §22.

# The whole script is one block so bash parses it before running: the checkout below may replace this file.
{
set -euo pipefail

sha="${1:-${SSH_ORIGINAL_COMMAND:-}}"
if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "usage: deploy.sh <full 40-character commit hash on main>" >&2
  exit 2
fi

if [[ "$(id -u)" == "0" ]]; then
  echo "refusing to run as root: deploy as the user that runs rootless Docker" >&2
  exit 4
fi

# Rootless Docker's socket. Non-interactive SSH sessions (GitHub Actions) do not read ~/.bashrc, so set it here.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DOCKER_HOST="${DOCKER_HOST:-unix://$XDG_RUNTIME_DIR/docker.sock}"

server_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$server_dir/../.."

# One deploy at a time
exec 9>"$XDG_RUNTIME_DIR/bytesac-deploy.lock"
if ! flock -n 9; then
  echo "another deploy is running" >&2
  exit 75
fi

git fetch --quiet origin main
if ! git merge-base --is-ancestor "$sha" origin/main; then
  echo "refusing: $sha is not on origin/main" >&2
  exit 3
fi
previous="$(git rev-parse HEAD)"
git checkout --quiet --detach "$sha"
echo "deploying $sha (previous: $previous)"

cd infra/server
docker compose build
docker compose build migrate
# Migrations are additive, so the running version keeps working while they apply
docker compose --profile tools run --rm migrate
docker compose up -d

echo "waiting for the API to report healthy"
api="$(docker compose ps -q api)"
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$api" 2>/dev/null || true)"
  if [[ "$status" == "healthy" ]]; then
    docker image prune -f > /dev/null
    docker builder prune -f --filter until=168h > /dev/null
    docker compose ps
    echo "deployed $sha"
    exit 0
  fi
  sleep 3
done

docker compose ps
docker compose logs --tail 50 api
echo "the API did not become healthy; to roll back run: infra/server/deploy.sh $previous" >&2
exit 1
}
