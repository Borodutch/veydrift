package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"reflect"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
)

func TestEVMExportFrozenFinal(t *testing.T) {
	// Reuses explicit TEST-ONLY trust and genuine frozen proof; no setup/proving.
	v, snap, a := artifactTestData(t)
	data := artifactEncode(t, a)
	before := append([]byte(nil), data...)
	got, err := v.ExportEVM(context.Background(), snap, data)
	if err != nil {
		t.Fatal(err)
	}
	var historical struct {
		DevelopmentOnly bool
		Schema          string
		Public          [22]string
		Proof           string
	}
	if err := json.Unmarshal(artifactRead(t, artifactFixture+".evm.json"), &historical); err != nil {
		t.Fatal(err)
	}
	if !historical.DevelopmentOnly || got.Schema != historical.Schema || got.Public != historical.Public || got.Proof != historical.Proof {
		t.Fatal("export differs from historical Solidity export")
	}
	proof, err := hex.DecodeString(strings.TrimPrefix(got.Proof, "0x"))
	if err != nil {
		t.Fatal(err)
	}
	if len(proof) != 384 || service.Hash(proof) != "8c40bcefd450e7cd3d31ba8bb497c596a498b11c600d6903820d2b1eaf5fac7f" {
		t.Fatal("wrong complete Solidity proof")
	}
	if got.Manifest != a.Manifest || !reflect.DeepEqual(got.Leaves, a.Leaves) {
		t.Fatal("authenticated manifest/leaves changed")
	}
	if got.Manifest.ProofHash != service.Hash(a.Proof) || got.Manifest.ProofHash == service.Hash(proof) {
		t.Fatal("compressed transport proof hash lost its meaning")
	}
	pr := new(bn.Proof)
	if err := artifactBinary(a.Proof, pr); err != nil {
		t.Fatal(err)
	}
	if len(v.vk.CommitmentKeys) != 1 || len(pr.Commitments) != 1 {
		t.Fatal("fixture commitment schema changed")
	}
	var raw bytes.Buffer
	if _, err := pr.WriteRawTo(&raw); err != nil {
		t.Fatal(err)
	}
	// All A/B/C, commitment and PoK bytes survive, with only the gnark slice
	// length prefix removed. Do not drop to the legacy 256-byte proof shape.
	if !bytes.Equal(proof[:256], raw.Bytes()[:256]) || !bytes.Equal(proof[256:], raw.Bytes()[260:]) {
		t.Fatal("commitment-aware serialization changed")
	}
	if !bytes.Equal(before, data) {
		t.Fatal("compressed artifact was modified")
	}
	got.Public[0] = "0"
	got.Leaves[0].Owner = "0"
	again, err := v.ExportEVM(context.Background(), snap, data)
	if err != nil || again.Public != historical.Public || !reflect.DeepEqual(again.Leaves, a.Leaves) {
		t.Fatalf("returned data aliases verifier state: %v", err)
	}
}

func TestEVMExportRejectsTampering(t *testing.T) {
	v, snap, a := artifactTestData(t)
	original := artifactEncode(t, a)
	attacks := map[string]func(*FinalArtifact){
		"schema": func(a *FinalArtifact) { a.Schema = "legacy" },
		"proof":  func(a *FinalArtifact) { a.Proof[1] ^= 1; a.Manifest.ProofHash = service.Hash(a.Proof) },
		"commitment-count": func(a *FinalArtifact) {
			binary.BigEndian.PutUint32(a.Proof[128:132], 0)
			a.Manifest.ProofHash = service.Hash(a.Proof)
		},
		"rebound-round":     func(a *FinalArtifact) { a.Public[12] = "2"; a.Manifest.Rounds = "2" },
		"leaf":              func(a *FinalArtifact) { a.Leaves[0].Owner = "4" },
		"leaf-omitted":      func(a *FinalArtifact) { a.Leaves = a.Leaves[1:] },
		"leaf-reordered":    func(a *FinalArtifact) { a.Leaves[0], a.Leaves[1] = a.Leaves[1], a.Leaves[0] },
		"manifest":          func(a *FinalArtifact) { a.Manifest.OutputRoot = "1" },
		"noncanonical-limb": func(a *FinalArtifact) { a.Public[0] = "01" },
		"overflow-limb":     func(a *FinalArtifact) { a.Public[0] = "18446744073709551616" },
	}
	for i := range a.Public {
		attacks[fmt.Sprintf("public-%d", i)] = func(a *FinalArtifact) {
			n, _ := new(big.Int).SetString(a.Public[i], 10)
			a.Public[i] = n.Add(n, big.NewInt(1)).String()
		}
	}
	for name, mutate := range attacks {
		t.Run(name, func(t *testing.T) {
			var bad FinalArtifact
			if err := json.Unmarshal(original, &bad); err != nil {
				t.Fatal(err)
			}
			mutate(&bad)
			got, err := v.ExportEVM(context.Background(), snap, artifactEncode(t, bad))
			if err == nil || got != nil {
				t.Fatal("exported unauthenticated artifact")
			}
			if name == "rebound-round" && !strings.Contains(err.Error(), "Groth16") {
				t.Fatalf("did not reach cryptographic gate: %v", err)
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := v.ExportEVM(ctx, snap, original); err != context.Canceled || got != nil {
		t.Fatalf("canceled export: %v", err)
	}
	var absent *ArtifactVerifier
	if got, err := absent.ExportEVM(context.Background(), snap, original); err == nil || got != nil {
		t.Fatal("unconfigured export")
	}
	wrong := snap
	wrong.Identity.BattleID = "101"
	if got, err := v.ExportEVM(context.Background(), wrong, original); err == nil || got != nil {
		t.Fatal("export outside authority")
	}
}
