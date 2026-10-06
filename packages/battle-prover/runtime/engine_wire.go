package runtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path/filepath"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

// EngineConfig is pinned by hash in the reviewed engine binary, not chosen by a
// job. It contains only public release and read-only artifact location metadata.
// The engine binary hash then enters processrunner.Manifest; no self-hash cycle.
type EngineConfig struct {
	Catalog                                             CatalogConfig
	Release                                             chainsource.Release
	Witness                                             WitnessLimits
	Artifacts                                           ArtifactLimits
	MaxRequestBytes, MaxCheckpointBytes, MaxResultBytes int
}

func LoadEngineConfig(path, pin string) (EngineConfig, error) {
	var c EngineConfig
	if !filepath.IsAbs(path) || !catalogHashValid(pin) {
		return c, errors.New("independent absolute engine configuration and pin required")
	}
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_CLOEXEC|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return c, err
	}
	f := os.NewFile(uintptr(fd), path)
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return c, err
	}
	if !st.Mode().IsRegular() || st.Size() > 1<<20 {
		return c, errors.New("engine configuration is not bounded regular file")
	}
	b, err := io.ReadAll(io.LimitReader(f, (1<<20)+1))
	if err != nil {
		return c, err
	}
	if len(b) > 1<<20 || service.Hash(b) != pin {
		return c, errors.New("engine configuration pin mismatch")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err = d.Decode(&c); err != nil {
		return c, err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return c, errors.New("trailing engine configuration")
	}
	if err = c.validate(); err != nil {
		return c, err
	}
	return c, nil
}
func (c EngineConfig) validate() error {
	for _, n := range []int{c.MaxRequestBytes, c.MaxCheckpointBytes, c.MaxResultBytes} {
		if n < 1 || n > 256<<20 {
			return errors.New("engine wire budget outside range")
		}
	}
	if c.Release.VerifierManifest != c.Catalog.TrustedManifestSHA256 {
		return errors.New("engine release/catalog mismatch")
	}
	return nil
}

// Exact existing processrunner wire schema; no transport API changes.
type engineWireRequest struct {
	Protocol, Identity, Attempt, ManifestSHA256 string
	Input, Checkpoint                           []byte
}

func decodeEngineRequest(r io.Reader, c EngineConfig) (engineWireRequest, service.Snapshot, error) {
	var req engineWireRequest
	var snap service.Snapshot
	b, err := io.ReadAll(io.LimitReader(r, int64(c.MaxRequestBytes)+1))
	if err != nil {
		return req, snap, err
	}
	if len(b) > c.MaxRequestBytes {
		return req, snap, errors.New("engine request budget")
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err = d.Decode(&req); err != nil {
		return req, snap, err
	}
	canonical, err := json.Marshal(req)
	if err != nil || !bytes.Equal(canonical, b) {
		return req, snap, errors.New("noncanonical engine request")
	}
	if req.Protocol != processrunner.Protocol || !catalogHashValid(req.Identity) || !catalogHashValid(req.Attempt) || !catalogHashValid(req.ManifestSHA256) {
		return req, snap, errors.New("engine invocation binding")
	}
	if len(req.Input) == 0 || len(req.Input) > c.Witness.MaxInputBytes || len(req.Checkpoint) > c.MaxCheckpointBytes {
		return req, snap, errors.New("engine input/checkpoint budget")
	}
	var doc chainsource.Document
	if err = witnessCanonicalJSON(req.Input, &doc); err != nil {
		return req, snap, err
	}
	if doc.Release != c.Release {
		return req, snap, errors.New("engine release not approved")
	}
	snap = service.Snapshot{Identity: service.Identity{ChainID: doc.ChainID, Game: doc.Game, BattleID: doc.BattleID, InputHash: service.Hash(req.Input), Rules: c.Release.Rules, Verifier: c.Release.VerifierManifest}, Anchor: doc.Anchor, Input: req.Input}
	if err = snap.Identity.Validate(); err != nil {
		return req, snap, err
	}
	if snap.Identity.Key() != req.Identity {
		return req, snap, errors.New("engine service identity mismatch")
	}
	return req, snap, nil
}

// ServeEngine executes at most one real proof operation. Native and checkpoint
// replay also occur inside the killable process envelope. A stage result is not
// a final battle artifact. Stdout contains only protocol NDJSON, no diagnostics.
func ServeEngine(ctx context.Context, input io.Reader, output io.Writer, c EngineConfig) error {
	if err := c.validate(); err != nil {
		return err
	}
	req, snap, err := decodeEngineRequest(input, c)
	if err != nil {
		return err
	}
	catalog, err := OpenCatalog(c.Catalog)
	if err != nil {
		return err
	}
	defer catalog.Close()
	var engine *Engine
	if len(req.Checkpoint) > 0 {
		engine, err = RestoreEngine(ctx, snap, c.Release, c.Witness, catalog, req.Checkpoint)
	} else {
		engine, err = NewEngine(snap, c.Release, c.Witness, catalog)
	}
	if err != nil {
		return err
	}
	worked, err := engine.Advance(ctx)
	if err != nil {
		return err
	}
	checkpoint, err := engine.Checkpoint()
	if err != nil {
		return err
	}
	if len(checkpoint) > c.MaxCheckpointBytes {
		return errors.New("engine checkpoint budget")
	}
	result := EngineStageResult{Schema: EngineStageSchema, Identity: req.Identity, CatalogSHA256: catalog.SHA256(), CheckpointSHA256: service.Hash(checkpoint), Complete: !worked}
	if !worked {
		final, e := engine.Result(ctx, c.Artifacts)
		if e != nil {
			return e
		}
		result.Artifact, e = json.Marshal(final)
		if e != nil {
			return e
		}
	}
	b, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if len(b) > c.MaxResultBytes {
		return errors.New("engine stage result budget")
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	enc := json.NewEncoder(output)
	if err = enc.Encode(processrunner.Message{Type: "checkpoint", Identity: req.Identity, Attempt: req.Attempt, Data: checkpoint}); err != nil {
		return err
	}
	return enc.Encode(processrunner.Message{Type: "result", Identity: req.Identity, Attempt: req.Attempt, Data: b})
}
