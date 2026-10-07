// catalog-builder is development tooling, not a runtime engine entrypoint.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Borodutch/veydrift/packages/battle-prover/devcatalog"
)

func run() error {
	action := flag.String("action", "plan", "plan | preflight | stage | inspect (worker is supervisor-only)")
	config := flag.String("config", "", "absolute canonical public config JSON path")
	pin := flag.String("config-sha256", "", "external SHA256 pin of config bytes")
	index := flag.Int("stage", -1, "explicit zero-based BuildCatalogGraph index; exactly one stage")
	previous := flag.String("previous", "", "prior receipt SHA256; empty only for stage zero")
	first := flag.String("first-costs", "", "stage-zero receipt hash: explicit acknowledgment of measured costs")
	authorize := flag.Bool("authorize-development-setup", false, "explicitly authorize this one development Setup/public-key persistence")
	flag.Parse()
	if flag.NArg() != 0 {
		return errors.New("unexpected positional input; witness inputs are not accepted")
	}
	if *action == "worker" {
		return devcatalog.Worker(*index, *previous, *first)
	}
	c, e := devcatalog.ReadConfig(*config, *pin)
	if e != nil {
		return e
	}
	var output any
	switch *action {
	case "plan":
		output, e = devcatalog.MakePlan(c)
	case "preflight":
		output, e = devcatalog.Preflight(c)
	case "inspect":
		output, e = devcatalog.Inspect(c)
	case "stage":
		if !*authorize {
			return errors.New("stage requires explicit development setup authorization")
		}
		ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		output, e = devcatalog.RunStage(ctx, c, *index, *previous, *first)
	default:
		return errors.New("unknown action; no whole-graph action exists")
	}
	if e != nil {
		return e
	}
	b, e := json.Marshal(output)
	if e != nil {
		return e
	}
	_, e = os.Stdout.Write(b)
	return e
}
func main() {
	if e := run(); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
