#!/usr/bin/env bash
#
# Prints release notes for a tag, grouped from the conventional commits since the previous one.
#
#   ./scripts/release-notes.sh v0.2.0
#
# Written here rather than taken from an action: the commit convention is the repository's own
# (docs/DEVELOPMENT_PLAN.md), the output is a dozen lines of markdown, and this way the release
# workflow hands its token to nothing it did not write.

set -euo pipefail

tag="${1:-}"
[ -n "$tag" ] || {
	echo "usage: $0 <tag>" >&2
	exit 1
}

repo="${GITHUB_REPOSITORY:-Flibbleware/goodies-beacon}"

# This repository's own subjects contain pipes — `feat: P0-12 | Droplet bootstrap` — so the field
# separator is the one character a commit subject cannot carry.
US=$'\x1f'
FORMAT="%s${US}%h"

# Strips the conventional prefix, which the heading above the line already says.
subject_of() { printf '%s' "$1" | sed -E 's/^[a-z]+(\([^)]*\))?!?: *//'; }

# The tag before this one, by the order git describes them in, so a release cut from anywhere
# still compares against its own ancestry rather than whatever sorts highest.
previous="$(git describe --tags --abbrev=0 "${tag}^" 2>/dev/null || true)"
range="${previous:+$previous..}$tag"

# Conventional prefixes, in the order they are worth reading. `feat` first because that is what
# someone upgrading wants to know; `chore` and `test` are left out entirely.
emit_section() {
	local heading="$1" prefixes="$2" body
	body="$(git log --no-merges --pretty="format:$FORMAT" "$range" |
		grep -E "^($prefixes)(\([^)]*\))?!?:" || true)"
	[ -n "$body" ] || return 0

	printf '### %s\n\n' "$heading"
	while IFS="$US" read -r subject sha; do
		[ -n "$subject" ] || continue
		printf -- '- %s (%s)\n' "$(subject_of "$subject")" "$sha"
	done <<< "$body"
	printf '\n'
}

printf '## %s\n\n' "$tag"

breaking="$(git log --no-merges --pretty="format:$FORMAT" "$range" |
	grep -E '^[a-z]+(\([^)]*\))?!:' || true)"
if [ -n "$breaking" ]; then
	printf '### Breaking\n\n'
	while IFS="$US" read -r subject sha; do
		[ -n "$subject" ] || continue
		printf -- '- %s (%s)\n' "$(subject_of "$subject")" "$sha"
	done <<< "$breaking"
	printf '\n'
fi

emit_section 'Added and changed' 'feat'
emit_section 'Fixed' 'fix|perf'
emit_section 'Documentation' 'docs'

if [ -n "$previous" ]; then
	printf '**Full changelog**: https://github.com/%s/compare/%s...%s\n' "$repo" "$previous" "$tag"
else
	printf '**Full changelog**: https://github.com/%s/commits/%s\n' "$repo" "$tag"
fi
