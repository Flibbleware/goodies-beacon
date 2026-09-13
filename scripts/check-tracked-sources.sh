#!/usr/bin/env sh
# Fails if a source file is ignored by .gitignore.
#
# A bare pattern in .gitignore matches a directory of that name at any depth, so `media/` — meant
# for the runtime media volume — also matched packages/core/src/media and apps/api/src/media.
# Everything built locally and CI failed with "cannot find module", which is a slow way to find
# out. Anchor a root-only pattern with a leading slash.
set -eu

# Filtered with grep rather than a git pathspec: `*` in a pathspec does not cross a slash, so
# `packages/*/src` silently matches nothing and the check passes while the bug is still there.
ignored=$(git ls-files --others --ignored --exclude-standard \
  | grep -E '^((apps|packages)/.*/(src|scripts|fixtures)/|scripts/)' || true)

if [ -n "$ignored" ]; then
  echo "These files are ignored by .gitignore but look like source; CI would never see them:" >&2
  echo "$ignored" | sed 's/^/  /' >&2
  echo >&2
  echo "A bare 'name/' pattern matches that directory at any depth. Anchor it with a leading" >&2
  echo "slash if it only exists at the repository root." >&2
  exit 1
fi
