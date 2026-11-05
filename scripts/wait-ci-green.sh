#!/usr/bin/env bash
# Wait for the CI run of this exact head_sha to conclude successfully.
#
# Shared by release.yml (stable + beta routes) and docs-deploy.yml — the three
# steps previously carried byte-identical inline copies of this poll loop.
# Fail-closed: missing / timed-out / non-success CI never unblocks the caller.
#
# Usage in a GitHub Actions step:
#   - name: Wait for CI gate (same SHA)
#     id: cigate
#     env:
#       GH_TOKEN: ${{ github.token }}
#     run: bash scripts/wait-ci-green.sh "docs deploy"
#
# $1 = what is blocked, used in failure messages only ("publish",
# "beta publish", "docs deploy"). Writes `run_id` to $GITHUB_OUTPUT so the
# caller can download that same run's nudo-dist artifact.
set -euo pipefail

blocked="${1:-action}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

timeout="${NUDO_CI_GATE_TIMEOUT:-1200}"
deadline=$(( $(date +%s) + timeout ))

while :; do
  resp=$(gh api \
    "repos/${GITHUB_REPOSITORY}/actions/workflows/ci.yml/runs?head_sha=${GITHUB_SHA}&event=push" \
    --jq 'if (.workflow_runs | length) > 0 then .workflow_runs[0] | "\(.id) \(.status) \(.conclusion // "")" else "" end' || true)
  if [ -n "$resp" ]; then
    set -- $resp
    run_id=$1; status=$2; conclusion=${3:-}
    url="https://github.com/${GITHUB_REPOSITORY}/actions/runs/${run_id}"
    if [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        echo "run_id=$run_id" >> "$GITHUB_OUTPUT"
        echo "CI green at ${GITHUB_SHA::7} — $url"
        exit 0
      fi
      echo "::error::CI run for ${GITHUB_SHA} concluded '${conclusion}' — ${blocked} BLOCKED. $url (若被更新的 push cancel，需 CI 重跑绿后手动 dispatch)"
      exit 1
    fi
    echo "CI ${status} — ${url}"
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::Timed out waiting for CI at ${GITHUB_SHA} — fail closed, ${blocked} NOT run."
    exit 1
  fi
  sleep 15
done
