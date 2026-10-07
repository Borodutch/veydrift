// prover-service wires the durable queue to an explicitly approved Linux engine.
// It ships no engine/key defaults and never creates setup or broadcasts transactions.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	prover "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type config struct {
	Store           string
	Queue           service.Config
	Source          chainsource.Config
	Catalog         prover.CatalogConfig
	Process         processrunner.Config
	Artifacts       prover.ArtifactLimits
	IntervalSeconds int
}

func load(path string) (config, error) {
	var c config
	f, err := os.Open(path)
	if err != nil {
		return c, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil {
		return c, err
	}
	if len(data) > 1<<20 {
		return c, errors.New("oversized configuration")
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err = dec.Decode(&c); err != nil {
		return c, err
	}
	var extra any
	if dec.Decode(&extra) != io.EOF {
		return c, errors.New("trailing or oversized configuration")
	}
	if c.Store == "" || c.IntervalSeconds < 1 || c.IntervalSeconds > 86400 {
		return c, errors.New("store and bounded interval required")
	}
	if c.Queue.Workers != 1 || c.Process.CPUs < 1 || c.Process.CPUs > c.Queue.JobCPUs || c.Queue.JobMemoryBytes < 1 || c.Process.AddressSpaceBytes > uint64(c.Queue.JobMemoryBytes) {
		return c, errors.New("sequential engine resources exceed queue reservations")
	}
	if c.Source.Release.VerifierManifest != c.Catalog.TrustedManifestSHA256 || c.Source.Release.Rules != c.Process.Manifest.RulesSHA256 {
		return c, errors.New("source/engine/catalog approval mismatch")
	}
	if c.Queue.MaxInputBytes < c.Process.MaxInputBytes || c.Queue.MaxArtifactBytes < c.Process.MaxProofBytes || prover.DurableCheckpointLimit(c.Process.MaxCheckpointBytes) == 0 || c.Queue.MaxArtifactBytes < prover.DurableCheckpointLimit(c.Process.MaxCheckpointBytes) {
		return c, errors.New("queue byte budgets below process output budgets")
	}
	return c, nil
}
func canContinueJobFailure(ctx context.Context, once bool, job service.Job, readErr error) bool {
	return !once && ctx.Err() == nil && readErr == nil && job.State == service.Failed
}

func run(ctx context.Context, c config, once bool) error {
	catalog, err := prover.OpenCatalog(c.Catalog)
	if err != nil {
		return err
	}
	defer catalog.Close()
	runner, err := prover.NewApprovedStageRunner(ctx, c.Process, catalog, c.Artifacts)
	if err != nil {
		return err
	}
	source, err := chainsource.New(c.Source, &http.Client{Timeout: 30 * time.Second})
	if err != nil {
		return err
	}
	store, err := service.Open(c.Store, c.Queue)
	if err != nil {
		return err
	}
	svc, err := service.New(store, source, runner)
	if err != nil {
		return err
	}
	for {
		if err = svc.Reconcile(ctx); err != nil {
			return fmt.Errorf("reconcile: %w", err)
		}
		jobs, e := store.List()
		if e != nil {
			return e
		}
		for _, job := range jobs {
			// Failed jobs remain observable; do not create an unbounded automatic retry.
			if job.State != service.Queued && job.State != service.Running {
				continue
			}
			err = svc.RunOne(ctx, job.Identity.Key())
			if errors.Is(err, service.ErrBusy) {
				continue
			}
			if err != nil {
				failed, readErr := store.Get(job.Identity.Key())
				if !canContinueJobFailure(ctx, once, failed, readErr) {
					return fmt.Errorf("job %s: %w", job.Identity.Key(), err)
				}
				log.Printf("job %s failed; durable failure retained, continuing unrelated jobs", job.Identity.Key())
			}
			break
		}
		if once {
			return nil
		}
		timer := time.NewTimer(time.Duration(c.IntervalSeconds) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
func main() {
	path := flag.String("config", "", "explicit approved JSON configuration")
	once := flag.Bool("once", false, "reconcile and attempt at most one queued job")
	flag.Parse()
	if *path == "" || flag.NArg() != 0 {
		log.Fatal("usage: prover-service -config FILE [-once]")
	}
	c, err := load(*path)
	if err != nil {
		log.Fatal(err)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err = run(ctx, c, *once); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatal(err)
	}
}
