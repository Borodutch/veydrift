package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"

	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark/frontend"
)

// This metadata-only catalog deliberately has NO proving keys. Native execution
// tests below are not proof success tests and cannot activate production.
func engineTestCatalog(s service.Snapshot) *Catalog {
	return &Catalog{cfg: CatalogConfig{TrustedManifestSHA256: s.Identity.Verifier}, manifest: CatalogManifest{RulesSHA256: s.Identity.Rules, RootHeights: [7]int{8, 8, 8, 8, 8, 8, 8}}, entries: map[string]CatalogEntry{}}
}
func TestEnginePendingRestartAndAdmission(t *testing.T) {
	ctx := context.Background()
	s, d := witnessTestDocument(t, 2, 1)
	c := engineTestCatalog(s)
	e, err := NewEngine(s, d.Release, witnessTestLimits, c)
	if err != nil {
		t.Fatal(err)
	}
	initial, err := e.Checkpoint()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = RestoreEngine(ctx, s, d.Release, witnessTestLimits, c, initial); err != nil {
		t.Fatal(err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if _, err = e.Advance(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	after, _ := e.Checkpoint()
	if !bytes.Equal(initial, after) {
		t.Fatal("cancel moved cursor")
	}
	if _, err = e.Advance(ctx); err == nil {
		t.Fatal("missing approved PK accepted")
	}
	cp, err := e.Checkpoint()
	if err != nil {
		t.Fatal(err)
	}
	restored, err := RestoreEngine(ctx, s, d.Release, witnessTestLimits, c, cp)
	if err != nil {
		t.Fatal(err)
	}
	if restored.pending == nil || restored.trace.count.Cmp(big.NewInt(1)) != 0 {
		t.Fatal("pending native event lost")
	}
	if _, err = restored.Advance(ctx); err == nil {
		t.Fatal("unexpected proof success")
	}
	again, _ := restored.Checkpoint()
	if !bytes.Equal(cp, again) {
		t.Fatal("failed proof skipped instruction")
	}
	if _, err = restored.Result(ctx, ArtifactLimits{}); err == nil {
		t.Fatal("stage treated as final")
	}
	var saved engineState
	if err = json.Unmarshal(cp, &saved); err != nil {
		t.Fatal(err)
	}
	attacks := map[string]func(*engineState){
		"skip-leaf":       func(x *engineState) { x.Pending = false },
		"skip-prefix":     func(x *engineState) { x.Trace.Events = "2" },
		"digest":          func(x *engineState) { x.Trace.Digest = strings.Repeat("0", 64) },
		"catalog":         func(x *engineState) { x.CatalogSHA256 = strings.Repeat("0", 64) },
		"identity":        func(x *engineState) { x.Trace.Identity.BattleID = "9" },
		"anchor":          func(x *engineState) { x.Trace.Anchor.Number++ },
		"unknown-adapter": func(x *engineState) { x.Adapters = append(x.Adapters, NativeReceipt{KeyID: "unknown"}) },
		"skipped-adapter": func(x *engineState) { x.Adapters = append(x.Adapters, NativeReceipt{KeyID: AdapterKeyID("final")}) },
		"extra-empty-group": func(x *engineState) {
			f, err := NewFrontier(c, e.binding(engineGroup{comp.Attribution, "99"}))
			if err != nil {
				t.Fatal(err)
			}
			b, _ := f.Checkpoint()
			x.Frontiers = append(x.Frontiers, engineSavedFrontier{engineGroup{comp.Attribution, "99"}, b})
		},
	}
	for name, mutate := range attacks {
		t.Run(name, func(t *testing.T) {
			var x engineState
			json.Unmarshal(cp, &x)
			mutate(&x)
			b, _ := json.Marshal(x)
			if _, err := RestoreEngine(ctx, s, d.Release, witnessTestLimits, c, b); err == nil {
				t.Fatal("accepted forged checkpoint")
			}
		})
	}
	if _, err = RestoreEngine(ctx, s, d.Release, witnessTestLimits, c, append(cp, ' ')); err == nil {
		t.Fatal("noncanonical JSON")
	}
}

// Full native two-input coverage, not fake proofs: constructors/claims/output
// are checked while all trust-dependent public APIs remain fail-closed.
func TestEngineNativeTwoDocuments(t *testing.T) {
	ctx := context.Background()
	roots := map[string]bool{}
	for _, variant := range []int{2, 3} {
		s, d := witnessTestDocument(t, variant, 1)
		e, err := NewEngine(s, d.Release, witnessTestLimits, engineTestCatalog(s))
		if err != nil {
			t.Fatal(err)
		}
		seen := map[int]bool{}
		groups := map[string]bool{}
		closes := map[string]bool{}
		for {
			ev, err := e.trace.Next(ctx)
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			seen[ev.Phase] = true
			if ev.Phase == TraceQualification {
				if _, err = e.adapterWitness(ctx, "qualification"); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if ev.Phase == comp.Attribution {
				groups[ev.Group] = true
			}
			if ev.Phase == comp.Bridge && ev.Kind == rb.Close {
				if !groups[ev.Group] {
					t.Fatal("Close skipped group")
				}
				closes[ev.Group] = true
				if _, err = comp.NewLeafWitness(ev.Step); err == nil {
					t.Fatal("bare Close accepted")
				}
				continue
			}
			leaf, err := comp.NewLeafWitness(ev.Step)
			if err != nil {
				t.Fatal(err)
			}
			r, err := NewFamilyReceipt(comp.FamilyID{Phase: ev.Phase, Kind: ev.Kind}, leaf.Range, NativeReceipt{})
			if err != nil {
				t.Fatal(err)
			}
			if r.Count != [4]uint64{1} {
				t.Fatal("non-elementary work")
			}
		}
		if len(seen) != 8 || len(groups) == 0 || len(groups) != len(closes) {
			t.Fatal("missing phase/group", seen, groups, closes)
		}
		a, b, err := e.claims()
		if err != nil {
			t.Fatal(err)
		}
		if traceScalar(a.Qualified[2]).Cmp(traceScalar(a.RawLast[3])) != 0 {
			t.Fatal("raw qualification link")
		}
		if traceScalar(b.First[0]).Cmp(traceScalar(b.Last[0])) != 0 {
			t.Fatal("output binding changed")
		}
		widths := []int{7, 8, 8, 8, 1, 1, 22}
		for i, role := range engineRoles {
			values, err := e.adapterValues(role)
			if err != nil || len(values) != widths[i] {
				t.Fatal(role, err)
			}
			for _, v := range values {
				if _, err := frontierScalar(v); err != nil {
					t.Fatal(err)
				}
			}
		}
		artifact, err := e.finalArtifact(NativeReceipt{Proof: []byte{1}})
		if err != nil {
			t.Fatal(err)
		}
		if artifact.Manifest.ChainRecord != raw.Integer(e.trace.result.Manifest.ChainRecord).String() || artifact.Manifest.InputHash != s.Identity.InputHash {
			t.Fatal("authority lost")
		}
		var limbs [22]uint64
		for i, v := range artifact.Public {
			x, err := artifactUint(v, 64)
			if err != nil {
				t.Fatal(err)
			}
			limbs[i] = x.Uint64()
		}
		values := []*big.Int{artifactWord(limbs[:4]), artifactWord(limbs[4:8]), artifactWord(limbs[8:12]), new(big.Int).SetUint64(limbs[12]), artifactWord(limbs[13:17]), artifactWord(limbs[17:21]), new(big.Int).SetUint64(limbs[21])}
		if err = (&ArtifactVerifier{}).artifactLeaves(ctx, artifact.Leaves, values); err != nil {
			t.Fatal(err)
		}
		roots[artifact.Manifest.OutputRoot] = true
		if _, err = e.Result(ctx, ArtifactLimits{}); err == nil {
			t.Fatal("native advice accepted as final proof")
		}
	}
	if len(roots) != 2 {
		t.Fatal("different documents produced same output")
	}
}

// Explicit TEST-LOCAL trust only. These frozen receipts validate actual crypto
// decoding/options, never a production approval or successful fresh proof run.
var engineAdapterTestPins = map[string]string{
	"qualification":   "1ea7aac42cb0f8055d6d0e7282f47dbdd6c35ba2141c8e55bfbd46f2d45fb9e7",
	"prepared-combat": "6f56337bdadb47c38bead082bbdfce49c3408d992f1e299f27db79faeb9e1d6b",
	"bridge-report":   "8fe91a764867c5900143785e0d45a6cef5202eb6a86a3ced1dd082496fbbd122",
	"pipeline":        "2249dfd58ddd0e3603b339a3ec7a85f34e5e1686233e930eab594f0e969fdc44",
	"raw-qualified":   "950ba03953b11d039d0b9d4acf74d5646c5f1c54f3341469c423b7ebbb0fe05c",
	"output-pipeline": "03687a256c002fef45db994965b9240e95af90232f9fb32e0f31d91524a8836b",
	"final":           "bb99dcb236243b696f0cb812ccc16df40e50659f769168a5458df861473d6505",
}

func TestEngineActualAdapterReceipts(t *testing.T) {
	ctx := context.Background()
	base := "../composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters"
	dir := t.TempDir()
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	c := &Catalog{root: root, cfg: CatalogConfig{TrustedManifestSHA256: strings.Repeat("a", 64), MaxArtifactBytes: 1 << 20}, entries: map[string]CatalogEntry{}}
	for _, role := range engineRoles {
		t.Run(role, func(t *testing.T) {
			path := filepath.Join(base, role, "receipt")
			kb := artifactRead(t, path+".vk")
			pin := engineAdapterTestPins[role]
			if service.Hash(kb) != pin {
				t.Fatal("test trust pin changed")
			}
			name := role + ".vk"
			if err := os.WriteFile(filepath.Join(dir, name), kb, 0600); err != nil {
				t.Fatal(err)
			}
			var meta struct{ Values []string }
			if err := json.Unmarshal(artifactRead(t, path+".json"), &meta); err != nil {
				t.Fatal(err)
			}
			values := make([]frontend.Variable, len(meta.Values))
			for i, s := range meta.Values {
				values[i], _ = new(big.Int).SetString(s, 10)
			}
			c.entries[AdapterKeyID(role)] = CatalogEntry{Node: CatalogNode{ID: AdapterKeyID(role), Role: role, PublicInputs: len(values)}, Approval: KeyApproval{VK: Artifact{Path: name, SHA256: pin, Bytes: int64(len(kb))}}}
			n := NativeReceipt{CatalogSHA256: c.SHA256(), KeyID: AdapterKeyID(role), Proof: artifactRead(t, path+".proof"), Public: artifactRead(t, path+".public")}
			encoded, err := json.Marshal(n)
			if err != nil {
				t.Fatal(err)
			}
			var restored NativeReceipt
			if err = artifactJSON(encoded, &restored); err != nil {
				t.Fatal(err)
			}
			auth, err := engineVerifyNative(ctx, c, role, restored, values)
			if err != nil {
				t.Fatal(err)
			}
			if len(auth.Witness.Public) != len(values) {
				t.Fatal("Auth schema")
			}
			for _, attack := range []string{"proof", "public", "key", "catalog", "allocation", "point", "native"} {
				bad := n
				bad.Proof = bytes.Clone(n.Proof)
				bad.Public = bytes.Clone(n.Public)
				v := append([]frontend.Variable{}, values...)
				switch attack {
				case "proof":
					bad.Proof[len(bad.Proof)-1] ^= 1
				case "public":
					bad.Public[len(bad.Public)-1] ^= 1
				case "key":
					bad.KeyID = "adapter/not-approved"
				case "catalog":
					bad.CatalogSHA256 = strings.Repeat("b", 64)
				case "allocation":
					binary.BigEndian.PutUint32(bad.Proof[128:132], ^uint32(0))
				case "point":
					bad.Proof[0] &= 0x3f
				case "native":
					v[0] = new(big.Int).Add(values[0].(*big.Int), big.NewInt(1))
				}
				if _, err := engineVerifyNative(ctx, c, role, bad, v); err == nil {
					t.Fatal("accepted", attack)
				}
			}
		})
	}
}
