#!/usr/bin/env bash
# Run ONLY in the separately authorized operational environment.
# No remote mutation, workflow dispatch, RPC, migration, merge, deploy or git push.
set -u
umask 077
orulo_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
orulo_repo_dir="$(cd -- "$orulo_script_dir/.." && pwd)"
orulo_service=''
orulo_output=''
while (($#)); do
  case "$1" in
    --service) [[ $# -ge 2 ]] || exit 64; orulo_service="$2"; shift 2 ;;
    --output-dir) [[ $# -ge 2 ]] || exit 64; orulo_output="$2"; shift 2 ;;
    *) printf '%s\n' 'ARGUMENT_NOT_ALLOWED'; exit 64 ;;
  esac
done
[[ "$orulo_service" =~ ^[A-Za-z0-9_-]+$ && -n "$orulo_output" ]] || { printf '%s\n' 'SERVICE_AND_OUTPUT_REQUIRED'; exit 64; }
[[ ! -e "$orulo_output" ]] || { printf '%s\n' 'OUTPUT_MUST_NOT_EXIST'; exit 64; }
cd -- "$orulo_repo_dir" || exit 1
if ! sha256sum -c orulo-national-v2/handoff/PACKAGE-SHA256SUMS > /dev/null; then
  printf '%s\n' 'BLOCKER_PACKAGE_HASH_MISMATCH'; exit 1
fi
mkdir -p -- "$orulo_output" || exit 1
orulo_output="$(cd -- "$orulo_output" && pwd)"
orulo_queue='orulo-national-v2/handoff/source-queue.json'
orulo_queue_sha='b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e'
if node scripts/orulo-national-source-readonly.mjs --queue "$orulo_queue" --queue-sha256 "$orulo_queue_sha" --output-dir "$orulo_output/source" > "$orulo_output/source-console.txt" 2>&1; then
  orulo_source_rc=0
else
  orulo_source_rc=$?
fi
# A source failure does not prevent the independent read-only inventory export.
if python3 scripts/orulo-national-export-readonly.py --service "$orulo_service" --output-dir "$orulo_output/rows" > "$orulo_output/export-console.txt" 2>&1; then
  orulo_export_rc=0
else
  orulo_export_rc=$?
fi
orulo_simulation_rc=125
if [[ "$orulo_export_rc" -eq 0 && -f "$orulo_output/source/index.json" ]]; then
  if node scripts/orulo-national-simulate.mjs --manifest orulo-national-v2/manifest/national-v2.json --queue "$orulo_queue" --queue-sha256 "$orulo_queue_sha" --rows-dir "$orulo_output/rows" --recheck "$orulo_output/rows/recheck.json" --source-dir "$orulo_output/source" --output-dir "$orulo_output/dry-run" > "$orulo_output/simulation-console.txt" 2>&1; then
    orulo_simulation_rc=0
  else
    orulo_simulation_rc=$?
  fi
fi
printf 'stage\texit_code\tclassification\nsource\t%s\t%s\nexport\t%s\t%s\nsimulation\t%s\t%s\n' \
 "$orulo_source_rc" "$([[ "$orulo_source_rc" -eq 0 ]] && printf NON_BLOCKER || printf BLOCKER)" \
 "$orulo_export_rc" "$([[ "$orulo_export_rc" -eq 0 ]] && printf NON_BLOCKER || printf BLOCKER)" \
 "$orulo_simulation_rc" "$([[ "$orulo_simulation_rc" -eq 0 ]] && printf NON_BLOCKER || printf BLOCKER)" > "$orulo_output/stage-results.tsv"
printf '%s\n' 'Production writes: 0. Production eligibility: BLOCKED. Read stage-results.tsv and per-item incidents.'
[[ "$orulo_source_rc" -eq 0 && "$orulo_export_rc" -eq 0 && "$orulo_simulation_rc" -eq 0 ]] || exit 2
