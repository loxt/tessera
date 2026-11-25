#!/usr/bin/env bash
# Prints the next release tag (vX.Y.Z) from the Conventional Commits since the last v* tag,
# or nothing when there is nothing to release (only docs/chore/ci/test/style commits).
#   breaking change (type!: or BREAKING CHANGE) → major (minor while still 0.x)
#   feat → minor · fix, perf, refactor → patch
set -euo pipefail

last=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' 2>/dev/null || echo v0.0.0)
if [[ $last == v0.0.0 ]]; then range=HEAD; else range="$last..HEAD"; fi
log=$(git log --format='%s%n%b' "$range")
IFS=. read -r major minor patch <<<"${last#v}"

if grep -qE '^[a-z]+(\([^)]*\))?!:|^BREAKING[ -]CHANGE' <<<"$log"; then
  if ((major > 0)); then major=$((major + 1)); minor=0; else minor=$((minor + 1)); fi
  patch=0
elif grep -qE '^feat(\([^)]*\))?:' <<<"$log"; then
  minor=$((minor + 1)); patch=0
elif grep -qE '^(fix|perf|refactor)(\([^)]*\))?:' <<<"$log"; then
  patch=$((patch + 1))
else
  echo "nothing to release since $last" >&2
  exit 0
fi
echo "v$major.$minor.$patch"
