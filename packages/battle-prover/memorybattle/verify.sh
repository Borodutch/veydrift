#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export GOMAXPROCS=2 GOMEMLIMIT=2GiB
gofmt -w memorybattle/*.go
go test ./memorybattle -count=1 -v -timeout=900s > memorybattle/solver-evidence.txt 2>&1
shasum -a 256 memorybattle/*.go memorybattle/oracle-*.ts memorybattle/LAYOUT.md > memorybattle/source-sha256.txt
