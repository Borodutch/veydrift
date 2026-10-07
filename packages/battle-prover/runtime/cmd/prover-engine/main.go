// prover-engine executes one approved proof operation; never setup or Go test.
package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	prover "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/consensys/gnark/logger"
)

// Set only at a reviewed build with -ldflags -X; neither argv, job nor inherited
// environment can replace these. The resulting binary is independently pinned.
var configPath string
var configSHA256 string

func main() {
	logger.Disable() // Stdout must contain protocol NDJSON only.
	if len(os.Args) != 1 {
		os.Exit(2)
	}
	c, err := prover.LoadEngineConfig(configPath, configSHA256)
	if err != nil {
		os.Exit(3)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err = prover.ServeEngine(ctx, os.Stdin, os.Stdout, c); err != nil {
		os.Exit(4)
	}
}
