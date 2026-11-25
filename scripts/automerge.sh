#!/bin/bash
# Merge agents' pull requests that passed CATE's review, but only if the tests (and the site build, when web/
# changed) pass on the MERGED result. Anything doubtful is left for the owner, with the reason in the chat.
set -uo pipefail
cd "$(dirname "$0")/.."

candidates=$(python3 -m cate merge-candidates --json)
if [ "$candidates" = "[]" ] || [ -z "$candidates" ]; then echo "Nothing to merge."; exit 0; fi
author=$(python3 -c 'from cate.util import settings; print(settings()["merge"]["author"])')
name="${author% <*}"; email="${author##*<}"; email="${email%>}"
repo=$(python3 -c 'from cate.util import settings; print(settings()["repo"])')

record() { python3 -m cate merge-record --task "$task" --pr "$pr" --status "$1" --detail "$2"; }

while read -r task pr; do
  [ -n "$task" ] || continue
  echo "== $task: pull request #$pr"
  info=$(gh api "repos/$repo/pulls/$pr" --jq '[.state, (.merged|tostring), .head.ref, .base.ref] | @tsv') \
    || { record waiting "could not read the pull request"; continue; }
  IFS=$'\t' read -r state merged head base <<<"$info"
  files=$(gh api --paginate "repos/$repo/pulls/$pr/files" --jq '.[].filename' | tr '\n' ' ')
  if [ "$merged" = true ]; then record merged "it was already merged on GitHub"; continue; fi
  if [ "$state" != open ]; then record blocked "the pull request is $state"; continue; fi
  case "$head" in cate/*) ;; *) record blocked "branch $head is not an agent branch"; continue ;; esac
  if [ "$base" != main ]; then record blocked "it targets $base, not main"; continue; fi
  if [[ " $files" == *" .github/"* ]]; then record blocked "it changes .github/ (workflow changes need the owner)"; continue; fi

  git fetch -q origin main "$head" || { record waiting "could not fetch the branch"; continue; }
  git checkout -q -B automerge origin/main
  if ! git -c user.name="$name" -c user.email="$email" merge -q --no-ff "origin/$head" \
       -m "Merge pull request #$pr from $head" -m "Auto-merged by CATE ($task): review passed; tests and build passed on the merged result."; then
    git merge --abort 2>/dev/null; record blocked "it conflicts with main"; continue
  fi
  if ! python3 -m unittest discover -s tests > /tmp/cate-tests.log 2>&1; then
    record blocked "tests failed on the merged result: $(tail -4 /tmp/cate-tests.log | tr '\n' ' ' | cut -c1-300)"; continue
  fi
  if [[ " $files" == *" web/"* ]]; then
    if ! (cd web && npm ci --no-audit --no-fund > /tmp/cate-npm.log 2>&1 && npm run build > /tmp/cate-build.log 2>&1); then
      record blocked "the site build failed: $(tail -6 /tmp/cate-build.log /tmp/cate-npm.log 2>/dev/null | tr '\n' ' ' | cut -c1-300)"; continue
    fi
  fi
  if git push -q origin automerge:main; then
    gh api "repos/$repo/issues/$pr/comments" -f body="Merged by CATE ($task): another model reviewed the change, and the tests and site build passed on the merged result." > /dev/null || true
    gh api -X DELETE "repos/$repo/git/refs/heads/$head" > /dev/null 2>&1 || true   # tidy: the branch is merged
    record merged "review, tests and build passed"
  else
    record waiting "main changed while checking; will retry next run"
  fi
done < <(echo "$candidates" | python3 -c 'import json, sys; [print(c["task"], c["pr"]) for c in json.load(sys.stdin)]')
git checkout -q --detach 2>/dev/null || true
