#!/usr/bin/env bash
# Runs every tests/cases/*.vela and compares its stdout with the matching
# .out file.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VELAC="$ROOT/build/velac"
WORK="$ROOT/build/tests"
export VELA_RUNTIME="$ROOT/runtime"

if [ ! -x "$VELAC" ]; then
  echo "velac not found at $VELAC - run 'make' first"
  exit 1
fi

mkdir -p "$WORK"
pass=0
fail=0
shopt -s nullglob

for src in "$ROOT"/tests/cases/*.vela; do
  name="$(basename "$src" .vela)"
  expected="$ROOT/tests/cases/$name.out"

  if [ ! -f "$expected" ]; then
    echo "skip $name (no $name.out)"
    continue
  fi

  if ! "$VELAC" "$src" -o "$WORK/$name" >"$WORK/$name.build.log" 2>&1; then
    echo "FAIL $name (compile)"
    sed 's/^/    /' "$WORK/$name.build.log"
    fail=$((fail + 1))
    continue
  fi

  actual="$(cd "$WORK" && "./$name")"
  wanted="$(cat "$expected")"

  if [ "$actual" = "$wanted" ]; then
    echo "ok   $name"
    pass=$((pass + 1))
  else
    echo "FAIL $name"
    diff <(printf '%s\n' "$actual") "$expected" | sed 's/^/    /'
    fail=$((fail + 1))
  fi
done

echo ""
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
