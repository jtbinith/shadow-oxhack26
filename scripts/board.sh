#!/usr/bin/env bash
# Kanban helper for the GitHub project board.
#   ./scripts/board.sh status <issue-number> <Todo|"In Progress"|Done>
#   ./scripts/board.sh add "<title>" "<label,label>" "<body>" [Todo|"In Progress"|Done]
set -euo pipefail
R=jtbinith/shadow-oxhack26 P=5 O=jtbinith
PID=$(gh project view $P --owner $O --format json --jq .id)
F=$(gh project field-list $P --owner $O --format json --jq '.fields[] | select(.name=="Status")')
FID=$(jq -r .id <<<"$F")
opt() { jq -r --arg n "$1" '.options[] | select(.name==$n) | .id' <<<"$F"; }
item_for() { gh project item-list $P --owner $O --limit 200 --format json --jq ".items[] | select(.content.number==$1) | .id"; }
set_status() {
  local item=$1 status=$2
  gh project item-edit --id "$item" --project-id "$PID" --field-id "$FID" --single-select-option-id "$(opt "$status")" >/dev/null
}
case "${1:-}" in
  status)
    set_status "$(item_for "$2")" "$3"
    if [ "$3" = Done ]; then gh issue close "$2" -R $R >/dev/null 2>&1 || true; else gh issue reopen "$2" -R $R >/dev/null 2>&1 || true; fi
    echo "#$2 → $3" ;;
  add)
    url=$(gh issue create -R $R -t "$2" -l "$3" -b "$4")
    item=$(gh project item-add $P --owner $O --url "$url" --format json --jq .id)
    status=${5:-Todo}
    set_status "$item" "$status"
    [ "$status" = Done ] && gh issue close "$url" >/dev/null
    echo "${url##*/} [$status] $2" ;;
  *) sed -n '2,4p' "$0"; exit 1 ;;
esac
