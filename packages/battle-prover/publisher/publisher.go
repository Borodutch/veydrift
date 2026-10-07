package publisher

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
)

type Result struct {
	ArtifactName, AuthorityName string
	Authority                   Authority
}

// Publish is the only production path. Callers cannot substitute a Source or a
// verifier; test-only source injection is private. No setup/proving or key load
// other than the approved final VK occurs. Pin the executable outside this API.
func Publish(ctx context.Context, approved *ApprovedConfig, jobKey string) (*Result, error) {
	if approved == nil {
		return nil, errors.New("independently pinned configuration required")
	}
	if e := approved.config.validate(); e != nil {
		return nil, e
	}
	src, e := chainsource.New(approved.config.Source, nil)
	if e != nil {
		return nil, e
	}
	return publishWithSource(ctx, approved, jobKey, src, nil)
}

// Read-only adapter for service.Store's jobs/<key>.json and blobs/<sha256>.
// Deliberately does NOT call service.Open (which creates dirs/config/locks), nor
// Store.Blob (unbounded). Complete is lifecycle admission, never proof trust.
func readJob(ctx context.Context, store *directory, key string, cap int) (service.Job, error) {
	var j service.Job
	if !digest(key) {
		return j, errors.New("canonical job key required")
	}
	b, e := store.read(ctx, "jobs/"+key+".json", int64(cap), 0, "")
	if e != nil {
		return j, e
	}
	if e = canonical(b, &j); e != nil {
		return j, e
	}
	if e = j.Identity.Validate(); e != nil {
		return j, e
	}
	if j.Identity.Key() != key || !digest(j.Generation) || !digest(j.Anchor.Hash) || !digest(j.Proof) || j.State != service.Complete || (j.Checkpoint != "" && !digest(j.Checkpoint)) {
		return j, errors.New("job is not an exact canonical Complete record")
	}
	return j, nil
}
func snapshot(ctx context.Context, src service.Source, j service.Job, c Config) (service.Snapshot, error) {
	h, e := src.Finalized(ctx)
	if e != nil {
		return service.Snapshot{}, e
	}
	if !digest(h.Hash) || j.Anchor.Number > h.Number {
		return service.Snapshot{}, errors.New("job anchor not finalized")
	}
	ok, e := src.Canonical(ctx, j.Anchor, h)
	if e != nil {
		return service.Snapshot{}, e
	}
	if !ok {
		return service.Snapshot{}, errors.New("job anchor not canonical")
	}
	s, e := src.Snapshot(ctx, j.Identity, h)
	if e != nil {
		return s, e
	}
	if s.Identity != j.Identity || s.Anchor != j.Anchor || len(s.Input) < 1 || len(s.Input) > c.Limits.MaxInputBytes || service.Hash(s.Input) != j.Identity.InputHash {
		return s, errors.New("authoritative snapshot identity/input/anchor mismatch")
	}
	var d chainsource.Document
	if e = canonical(s.Input, &d); e != nil {
		return s, e
	}
	if d.Schema != "veydrift.finalized-public-input.v1" || d.Release != c.Source.Release || d.ChainID != c.Source.ChainID || d.Game != c.Source.Game || d.ChainID != j.Identity.ChainID || d.Game != j.Identity.Game || d.BattleID != j.Identity.BattleID || d.Anchor != j.Anchor || !digest(d.ChainRecord) {
		return s, errors.New("source document outside approved authority")
	}
	return s, nil
}
func publishWithSource(ctx context.Context, approved *ApprovedConfig, key string, src service.Source, hook faultHook) (*Result, error) {
	if approved == nil || !digest(approved.sha256) || src == nil {
		return nil, errors.New("missing approved publisher inputs")
	}
	c := approved.config
	if e := c.validate(); e != nil {
		return nil, e
	}
	store, e := openDirectory(c.StoreRoot)
	if e != nil {
		return nil, e
	}
	defer store.close()
	assets, e := openDirectory(c.ArtifactRoot)
	if e != nil {
		return nil, e
	}
	defer assets.close()
	authority, e := openDirectory(c.AuthorityRoot)
	if e != nil {
		return nil, e
	}
	defer authority.close()
	catdir, e := openDirectory(c.Catalog.Root)
	if e != nil {
		return nil, e
	}
	defer catdir.close()
	// ponytail: one stable authority-directory lock serializes all jobs. Split only
	// if measured throughput demands it; never unlink/replace this lock inode.
	lock, e := authority.lock(ctx)
	if e != nil {
		return nil, e
	}
	defer lock.Close()
	j, e := readJob(ctx, store, key, c.MaxJobBytes)
	if e != nil {
		return nil, e
	}
	// Independently enforce no-follow/single-link manifest admission before the
	// frozen catalog parser. Catalog roots/ancestors must be deployment-immutable.
	manifest, e := catdir.read(ctx, c.Catalog.ManifestPath, c.Catalog.MaxManifestBytes, 0, c.Catalog.TrustedManifestSHA256)
	if e != nil {
		return nil, e
	}
	cat, e := rt.OpenCatalog(c.Catalog)
	if e != nil {
		return nil, e
	}
	defer cat.Close()
	if e = cat.ApprovedIdentity(ctx, j.Identity); e != nil {
		return nil, e
	}
	var vk rt.Artifact
	for _, entry := range cat.Manifest().Entries {
		if entry.Node.ID == rt.AdapterKeyID("final") {
			vk = entry.Approval.VK
		}
	}
	if vk.Bytes < 1 {
		return nil, errors.New("approved final VK absent")
	}
	vkBytes, e := catdir.read(ctx, vk.Path, int64(c.Limits.MaxVKBytes), vk.Bytes, vk.SHA256)
	if e != nil {
		return nil, e
	}
	verifier, e := rt.NewArtifactVerifier(vkBytes, rt.ArtifactApproval{VKHash: vk.SHA256, Rules: j.Identity.Rules, VerifierManifest: cat.SHA256()}, c.Limits)
	if e != nil {
		return nil, e
	}
	snap, e := snapshot(ctx, src, j, c)
	if e != nil {
		return nil, e
	}
	input, e := store.read(ctx, "blobs/"+j.Identity.InputHash, int64(c.Limits.MaxInputBytes), int64(len(snap.Input)), j.Identity.InputHash)
	if e != nil {
		return nil, e
	}
	if !bytes.Equal(input, snap.Input) {
		return nil, errors.New("store input differs from authoritative snapshot")
	}
	blob, e := store.read(ctx, "blobs/"+j.Proof, int64(c.Limits.MaxArtifactBytes), 0, j.Proof)
	if e != nil {
		return nil, e
	}
	evm, e := verifier.ExportEVM(ctx, snap, blob)
	if e != nil {
		return nil, e
	}
	// All output hashes below are independently computed AFTER full verification.
	var compressed rt.FinalArtifact
	if e = canonical(blob, &compressed); e != nil {
		return nil, e
	}
	var doc chainsource.Document
	if e = canonical(snap.Input, &doc); e != nil {
		return nil, e
	}
	inputHash, proofHash := service.Hash(snap.Input), service.Hash(compressed.Proof)
	if evm.Manifest.VKHash != vk.SHA256 || evm.Manifest.InputHash != inputHash || evm.Manifest.ProofHash != proofHash {
		return nil, errors.New("verified manifest/hash inconsistency")
	}
	if len(evm.Leaves) > c.Limits.MaxLeaves || len(evm.Leaves) > MaxLeaves {
		return nil, errors.New("export leaf cap")
	}
	wire, e := json.Marshal(evm)
	if e != nil {
		return nil, e
	}
	if len(wire) > c.MaxExportBytes {
		return nil, errors.New("canonical EVM export exceeds configured cap")
	}
	release, e := ReleaseID(doc.Release)
	if e != nil {
		return nil, e
	}
	a := Authority{Schema: AuthoritySchema, ChainID: doc.ChainID, Game: doc.Game, BattleID: doc.BattleID, Binding: "0x" + doc.ChainRecord, ReleaseID: release, VKHash: service.Hash(vkBytes), InputHash: inputHash, CompressedProofHash: proofHash, ExportSHA256: service.Hash(wire), CatalogSHA256: service.Hash(manifest), JobKey: key, JobGeneration: j.Generation, JobAnchorNumber: anchorNumber(j.Anchor.Number), JobAnchorHash: j.Anchor.Hash, ArtifactBlobSHA256: service.Hash(blob), PublisherConfigSHA256: approved.sha256}
	if e = a.Validate(); e != nil {
		return nil, e
	}
	metadata, e := json.Marshal(a)
	if e != nil {
		return nil, e
	}
	if len(metadata) > MaxAuthorityBytes {
		return nil, errors.New("authority size cap")
	}
	base, e := Basename(a.ChainID, a.Game, a.BattleID, a.Binding, a.ReleaseID)
	if e != nil {
		return nil, e
	}
	result := &Result{ArtifactName: base + ".evm.json", AuthorityName: base + ".authority.json", Authority: a}
	// Retry checks never trust an existing record: the current complete artifact
	// has just passed ExportEVM and current Source authority; exact bytes follow.
	oldMeta, me := authority.read(ctx, result.AuthorityName, MaxAuthorityBytes, 0, "")
	if me != nil && !errors.Is(me, os.ErrNotExist) {
		return nil, me
	}
	oldWire, we := assets.read(ctx, result.ArtifactName, int64(c.MaxExportBytes), 0, "")
	if we != nil && !errors.Is(we, os.ErrNotExist) {
		return nil, we
	}
	if me == nil && we != nil {
		return nil, errors.New("authority exists without artifact: manual repair required")
	}
	if me == nil && !bytes.Equal(oldMeta, metadata) {
		return nil, errors.New("existing authority conflicts")
	}
	if we == nil && !bytes.Equal(oldWire, wire) {
		return nil, errors.New("existing artifact conflicts")
	}
	recheck := func() error {
		if e := fault(hook, "recheck"); e != nil {
			return e
		}
		current, e := readJob(ctx, store, key, c.MaxJobBytes)
		if e != nil {
			return e
		}
		if current != j {
			return errors.New("complete job changed (including generation/anchor/proof references)")
		}
		latest, e := snapshot(ctx, src, j, c)
		if e != nil {
			return e
		}
		if latest.Identity != snap.Identity || latest.Anchor != snap.Anchor || !bytes.Equal(latest.Input, snap.Input) {
			return errors.New("source authority changed before publication")
		}
		// Source calls can take time: bracket them with another exact store read.
		current, e = readJob(ctx, store, key, c.MaxJobBytes)
		if e != nil {
			return e
		}
		if current != j {
			return errors.New("complete job changed during source recheck")
		}
		currentInput, e := store.read(ctx, "blobs/"+j.Identity.InputHash, int64(c.Limits.MaxInputBytes), int64(len(input)), j.Identity.InputHash)
		if e != nil {
			return e
		}
		if !bytes.Equal(currentInput, input) {
			return errors.New("input blob changed")
		}
		again, e := store.read(ctx, "blobs/"+j.Proof, int64(c.Limits.MaxArtifactBytes), int64(len(blob)), j.Proof)
		if e != nil {
			return e
		}
		if !bytes.Equal(again, blob) {
			return errors.New("proof blob changed")
		}
		return ctx.Err()
	}
	if e = recheck(); e != nil {
		return nil, e
	}
	if we != nil {
		artifactHook := func(stage string) error {
			if e := fault(hook, stage); e != nil {
				return e
			}
			if stage == "artifact.rename" {
				return recheck()
			}
			return nil
		}
		if e = assets.publish(ctx, result.ArtifactName, wire, c.MaxExportBytes, "artifact", artifactHook); e != nil {
			return nil, fmt.Errorf("artifact publication: %w", e)
		}
	} else if e = assets.file.Sync(); e != nil {
		return nil, e
	}
	// Even a recovered artifact is synced before the LAST commit marker.
	if e = fault(hook, "metadata"); e != nil {
		return nil, e
	}
	if e = recheck(); e != nil {
		return nil, e
	}
	if me != nil {
		// Recheck after staging/sync and immediately before metadata no-replace rename.
		metadataHook := func(stage string) error {
			if e := fault(hook, stage); e != nil {
				return e
			}
			if stage == "authority.rename" {
				return recheck()
			}
			return nil
		}
		if e = authority.publish(ctx, result.AuthorityName, metadata, MaxAuthorityBytes, "authority", metadataHook); e != nil {
			return nil, fmt.Errorf("authority publication: %w", e)
		}
	} else if e = authority.file.Sync(); e != nil {
		return nil, e
	}
	return result, nil
}
