#!/usr/bin/env bash
# Deploys one commit of main on this VM: check it out, build the images, run the migrations, restart the stack and
# wait until the API is healthy. Used by .github/workflows/deploy.yml (through a forced SSH command, which passes the
# commit in SSH_ORIGINAL_COMMAND) and by hand:
#
#   git -C ~/bytesac fetch origin && ~/bytesac/deploy/deploy.sh "$(git -C ~/bytesac rev-parse origin/main)"
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

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

# One deploy at a time
exec 9>/tmp/bytesac-deploy.lock
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

cd deploy
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
echo "the API did not become healthy; to roll back run: deploy/deploy.sh $previous" >&2
exit 1
}
