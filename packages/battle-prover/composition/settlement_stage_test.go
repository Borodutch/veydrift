package composition

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	bn254 "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

type nativeStageMeta struct {
	Role         string
	Values       []string
	Hashes       map[string]string
	CCSHash      string
	Dependencies []string
}

func provePublic(t *testing.T, path, role string, a frontend.Circuit, values []frontend.Variable, deps []string) Auth {
	t.Helper()
	if _, e := os.Stat(path + ".json"); e == nil {
		t.Fatal("completed public stage already exists")
	} else if !os.IsNotExist(e) {
		t.Fatal(e)
	}
	l := setupFamily(t, role, a)
	w := wit(t, a)
	pub, e := w.Public()
	check(t, e)
	pr, e := groth16.Prove(l.cc, l.pk, w, nativeStageProverOption(role))
	check(t, e)
	check(t, groth16.Verify(pr, l.vk, pub, nativeStageVerifierOption(role)))
	m := nativeStageMeta{Role: role, Hashes: map[string]string{}, Dependencies: deps}
	for _, v := range values {
		m.Values = append(m.Values, integer(v).String())
	}
	h := sha256.New()
	_, e = l.cc.WriteTo(h)
	check(t, e)
	m.CCSHash = fmt.Sprintf("%x", h.Sum(nil))
	check(t, os.MkdirAll(filepath.Dir(path), 0700))
	for ext, obj := range map[string]io.WriterTo{"proof": pr, "vk": l.vk, "public": pub} {
		var b bytes.Buffer
		_, e = obj.WriteTo(&b)
		check(t, e)
		m.Hashes[ext] = fmt.Sprintf("%x", sha256.Sum256(b.Bytes()))
		check(t, os.WriteFile(path+"."+ext, b.Bytes(), 0600))
	}
	if role == "final" {
		var sol bytes.Buffer
		check(t, l.vk.ExportSolidity(&sol))
		check(t, os.WriteFile(path+".sol", sol.Bytes(), 0600))
		m.Hashes["sol"] = fmt.Sprintf("%x", sha256.Sum256(sol.Bytes()))
		evm := struct {
			DevelopmentOnly bool     `json:"developmentOnly"`
			Schema          string   `json:"schema"`
			Public          []string `json:"public"`
			Proof           string   `json:"proof"`
		}{true, "raw-linked-settlement22-v3", m.Values, "0x" + hex.EncodeToString(pr.(*bn254.Proof).MarshalSolidity())}
		data, e := json.MarshalIndent(evm, "", "  ")
		check(t, e)
		check(t, os.WriteFile(path+".evm.json", data, 0600))
		m.Hashes["evm.json"] = fmt.Sprintf("%x", sha256.Sum256(data))
	}
	data, e := json.MarshalIndent(m, "", "  ")
	check(t, e)
	check(t, os.WriteFile(path+".json", data, 0600))
	t.Logf("PUBLIC STAGE VERIFIED role=%s public=%d proof_sha256=%s vk_sha256=%s", role, len(values), m.Hashes["proof"], m.Hashes["vk"])
	l = nil
	runtime.GC()
	return loadPublic(t, path, role, values)
}
func loadPublic(t *testing.T, path, role string, expected []frontend.Variable) Auth {
	t.Helper()
	data, e := os.ReadFile(path + ".json")
	check(t, e)
	var m nativeStageMeta
	check(t, json.Unmarshal(data, &m))
	if m.Role != role || len(m.Values) != len(expected) {
		t.Fatal("native stage role/schema mismatch")
	}
	pr, vk := groth16.NewProof(ecc.BN254), groth16.NewVerifyingKey(ecc.BN254)
	pub, e := witness.New(ecc.BN254.ScalarField())
	check(t, e)
	for ext, obj := range map[string]io.ReaderFrom{"proof": pr, "vk": vk, "public": pub} {
		b, e := os.ReadFile(path + "." + ext)
		check(t, e)
		if fmt.Sprintf("%x", sha256.Sum256(b)) != m.Hashes[ext] {
			t.Fatal("native stage artifact hash mismatch")
		}
		_, e = obj.ReadFrom(bytes.NewReader(b))
		check(t, e)
	}
	check(t, groth16.Verify(pr, vk, pub, nativeStageVerifierOption(role)))
	if role == "final" {
		for _, ext := range []string{"sol", "evm.json"} {
			b, e := os.ReadFile(path + "." + ext)
			check(t, e)
			if fmt.Sprintf("%x", sha256.Sum256(b)) != m.Hashes[ext] {
				t.Fatal("final export artifact hash mismatch")
			}
		}
	}
	vector := pub.Vector().(fr.Vector)
	if len(vector) != len(expected) {
		t.Fatal("actual public width")
	}
	for i, v := range expected {
		n := integer(v)
		if n.Sign() < 0 || n.Cmp(ecc.BN254.ScalarField()) >= 0 {
			t.Fatal("expected scalar canonicality")
		}
		var got big.Int
		vector[i].BigInt(&got)
		if got.Cmp(n) != 0 || m.Values[i] != n.String() {
			t.Fatal("authenticated public value mismatch")
		}
	}
	cp, e := rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pr)
	check(t, e)
	cw, e := rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	return Auth{Proof: cp, Witness: cw, Key: key}
}

// Public-only reusable qualification receipt. Complete raw-prefix authentication
// is deliberately deferred to the consuming RawQualified bundle proof.
func TestLinkedQualificationPublicProof(t *testing.T) {
	if os.Getenv("RUN_LINKED_PUBLIC") != "1" {
		t.Skip("explicit real linked qualification")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) <= 0 || debug.SetMemoryLimit(-1) > 6<<30 {
		t.Fatal("proof resource envelope")
	}
	deadline, ok := t.Deadline()
	if !ok || time.Until(deadline) > 60*time.Minute {
		t.Fatal("60min proof maximum")
	}
	f := buildSettlement(t, false)
	v := f.qualified.Statement()
	provePublic(t, "staged-public/linked-v1/qualification", "linked-qualification-v3", f.qualified, v[:], nil)
}

func nativeStageProverOption(role string) backend.ProverOption {
	if role == "final" {
		return solidity.WithProverTargetSolidityVerifier(backend.GROTH16)
	}
	return rec.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())
}
func nativeStageVerifierOption(role string) backend.VerifierOption {
	if role == "final" {
		return solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)
	}
	return rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())
}
