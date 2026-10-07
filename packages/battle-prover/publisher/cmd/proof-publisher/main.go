package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/Borodutch/veydrift/packages/battle-prover/publisher"
)

func run(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("proof-publisher", flag.ContinueOnError)
	config := fs.String("config", "", "owner-approved canonical absolute configuration file")
	pin := fs.String("config-sha256", "", "independently supplied SHA256 of entire configuration")
	key := fs.String("job-key", "", "one canonical complete job key")
	action := fs.String("action", "publish", "publish or validate (no RPC)")
	if e := fs.Parse(args); e != nil {
		return e
	}
	if fs.NArg() != 0 || (*action != "publish" && *action != "validate") {
		return fmt.Errorf("unexpected arguments/action")
	}
	approved, e := publisher.LoadConfig(ctx, *config, *pin)
	if e != nil {
		return e
	}
	if *action == "validate" {
		if *key != "" {
			return fmt.Errorf("validate does not take a job key")
		}
		fmt.Println("canonical configuration pin and local policy validated; no chain/catalog approval asserted")
		return nil
	}
	if *key == "" {
		return fmt.Errorf("-job-key is required")
	}
	result, e := publisher.Publish(ctx, approved, *key)
	if e != nil {
		return e
	}
	fmt.Println(result.ArtifactName + " " + result.AuthorityName)
	return nil
}
func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if e := run(ctx, os.Args[1:]); e != nil {
		fmt.Fprintln(os.Stderr, e)
		os.Exit(1)
	}
}
