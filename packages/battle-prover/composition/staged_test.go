package composition

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend/groth16"
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
	"strconv"
	"testing"
	"time"
)

// Disk format contains ONLY public artifacts. Never add a ProvingKey or seed.
// These are trusted local DEVELOPMENT receipts, not prover-supplied approval.
// Production approval must audit source/CCS/VK chain and pin the final key.
type publicReceipt struct {
	ID                                     FamilyID
	First, Last                            [10]string
	Count                                  [4]string
	VKHash, ProofHash, PublicHash, CCSHash string
}

func saveStage(t *testing.T, path string, l *devSetup, a frontend.Circuit, r FamilyRange, id FamilyID) familyReceipt {
	t.Helper()
	if _, err := os.Stat(path + ".json"); err == nil {
		t.Fatal("refusing to overwrite a completed public checkpoint")
	} else if !os.IsNotExist(err) {
		t.Fatal(err)
	}
	w := wit(t, a)
	pub, e := w.Public()
	check(t, e)
	start := time.Now()
	pr, e := groth16.Prove(l.cc, l.pk, w, rec.GetNativeProverOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField()))
	check(t, e)
	check(t, groth16.Verify(pr, l.vk, pub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	check(t, os.MkdirAll(filepath.Dir(path), 0700))
	m := publicReceipt{ID: id}
	for i := range m.First {
		m.First[i] = integer(r.First[i]).String()
		m.Last[i] = integer(r.Last[i]).String()
	}
	for i := range m.Count {
		m.Count[i] = integer(r.Count[i]).String()
	}
	// Write public artifacts, then metadata last. A missing/mismatched component
	// is a failed checkpoint, never silently treated as a completed proof.
	for ext, obj := range map[string]io.WriterTo{"proof": pr, "vk": l.vk, "public": pub} {
		var b bytes.Buffer
		_, e = obj.WriteTo(&b)
		check(t, e)
		hash := fmt.Sprintf("%x", sha256.Sum256(b.Bytes()))
		switch ext {
		case "proof":
			m.ProofHash = hash
		case "vk":
			m.VKHash = hash
		case "public":
			m.PublicHash = hash
		}
		check(t, os.WriteFile(path+"."+ext, b.Bytes(), 0600))
	}
	h := sha256.New()
	_, e = l.cc.WriteTo(h)
	check(t, e)
	m.CCSHash = fmt.Sprintf("%x", h.Sum(nil))
	data, e := json.MarshalIndent(m, "", "  ")
	check(t, e)
	check(t, os.WriteFile(path+".json", data, 0600))
	t.Logf("PUBLIC CHECKPOINT %s id=%+v proof_sha256=%s vk_sha256=%s ccs_sha256=%s time=%s", path, id, m.ProofHash, m.VKHash, m.CCSHash, time.Since(start))
	return loadStage(t, path, id)
}
func receiptAuth(t *testing.T, pr groth16.Proof, vk groth16.VerifyingKey, pub witness.Witness, r FamilyRange) familyReceipt {
	cp, e := rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](pr)
	check(t, e)
	cw, e := rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	check(t, e)
	key, e := rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	check(t, e)
	return familyReceipt{r, CatalogAuth{Proof: cp, Witness: cw, Selector: 0, Keys: []Key{key}}}
}
func loadStage(t *testing.T, path string, want FamilyID) familyReceipt {
	t.Helper()
	data, e := os.ReadFile(path + ".json")
	check(t, e)
	var m publicReceipt
	check(t, json.Unmarshal(data, &m))
	if m.ID != want {
		t.Fatal("stage key role mismatch")
	}
	pr, vk := groth16.NewProof(ecc.BN254), groth16.NewVerifyingKey(ecc.BN254)
	pub, e := witness.New(ecc.BN254.ScalarField())
	check(t, e)
	for ext, obj := range map[string]io.ReaderFrom{"proof": pr, "vk": vk, "public": pub} {
		b, e := os.ReadFile(path + "." + ext)
		check(t, e)
		hash := fmt.Sprintf("%x", sha256.Sum256(b))
		want := map[string]string{"proof": m.ProofHash, "vk": m.VKHash, "public": m.PublicHash}[ext]
		if hash != want {
			t.Fatal("public receipt hash mismatch")
		}
		_, e = obj.ReadFrom(bytes.NewReader(b))
		check(t, e)
	}
	check(t, groth16.Verify(pr, vk, pub, rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())))
	var r FamilyRange
	parse := func(s string) *big.Int {
		n, ok := new(big.Int).SetString(s, 10)
		if !ok || n.Sign() < 0 {
			t.Fatal("bad receipt integer")
		}
		return n
	}
	for i := range r.First {
		r.First[i] = parse(m.First[i])
		r.Last[i] = parse(m.Last[i])
	}
	for i := range r.Count {
		r.Count[i] = parse(m.Count[i])
	}
	// Endpoints/count are untrusted until their hash equals the PUBLIC witness.
	for _, x := range r.Count {
		if integer(x).BitLen() > 64 {
			t.Fatal("noncanonical work limb")
		}
	}
	for _, xs := range [][10]frontend.Variable{r.First, r.Last} {
		for _, x := range xs {
			if integer(x).Cmp(ecc.BN254.ScalarField()) >= 0 {
				t.Fatal("noncanonical endpoint")
			}
		}
	}
	expected := r.Public(want.Phase)
	native := pub.Vector().(fr.Vector)
	if len(native) != 3 {
		t.Fatal("resumed public schema")
	}
	for i, v := range expected.Digests {
		var got big.Int
		native[i].BigInt(&got)
		if got.Cmp(integer(v)) != 0 {
			t.Fatal("resumed endpoint/public mismatch")
		}
	}
	return receiptAuth(t, pr, vk, pub, r)
}
func stageNode(phase, height int, children []familyReceipt, keys []Key, selectors []int) *FamilyNode {
	c := familyMerge(phase, height, children, keys, selectors)
	total := new(big.Int)
	for _, r := range children {
		total.Add(total, wordBig(r.rangeValue.Count))
	}
	c.Range.Count = p.MustValue(total)
	c.FamilyPublic = c.Range.Public(phase)
	return c
}
func TestRawJournalStage(t *testing.T) {
	rawStage := os.Getenv("RAW_PROOF_STAGE")
	if rawStage == "" {
		t.Skip("explicit staged real proof run")
	}
	stage, e := strconv.Atoi(rawStage)
	check(t, e)
	if stage != 0 {
		t.Fatal("historical raw-v1 runner cannot authorize resumed keys; use strict pipeline stages and independent approval ledger")
	}
	if runtime.GOMAXPROCS(0) > 2 || debug.SetMemoryLimit(-1) > 6<<30 || debug.SetMemoryLimit(-1) <= 0 {
		t.Fatal("resource envelope")
	}
	start := time.Now()
	f := buildSettlement(t, false)
	dir := "staged-public/raw-v1"
	receipts := []familyReceipt{}
	if stage == 0 {
		receipts = make([]familyReceipt, len(f.raw))
		keys := make([]Key, 4)
		for kind := 0; kind < 4; kind++ {
			var l *devSetup
			for i, s := range f.raw {
				if s.Kind != kind {
					continue
				}
				st := s.Statement()
				chunk := &Chunk{Phase: RawJournal, PublicRange: PublicRange{st[:], st[:]}, Raw: []rawStep{privateRaw(s)}}
				a := NewFamilyLeaf(chunk)
				if l == nil {
					l = setupFamily(t, fmt.Sprintf("raw-leaf%d", kind), a)
					keys[kind] = l.key
				}
				receipts[i] = saveStage(t, fmt.Sprintf("%s/leaf-%02d", dir, i), l, a, a.Range, FamilyID{Phase: RawJournal, Kind: kind})
			}
			l = nil
			runtime.GC()
		}
		first := stageNode(RawJournal, 1, receipts[:1], keys, []int{f.raw[0].Kind})
		l := setupFamily(t, "raw-D0", first)
		for i, r := range receipts {
			a := stageNode(RawJournal, 1, []familyReceipt{r}, keys, []int{f.raw[i].Kind})
			saveStage(t, fmt.Sprintf("%s/D0-%02d", dir, i), l, a, a.Range, FamilyID{Phase: RawJournal, Arity: 1})
		}
	} else {
		n := (len(f.raw) + (1 << (stage - 1)) - 1) >> (stage - 1)
		for i := 0; i < n; i++ {
			receipts = append(receipts, loadStage(t, fmt.Sprintf("%s/D%d-%02d", dir, stage-1, i), FamilyID{Phase: RawJournal, Level: stage - 1, Arity: 1}))
		}
		previousKey := receipts[0].auth.Keys[0]
		b := stageNode(RawJournal, stage, receipts[:2], []Key{previousKey}, []int{0, 0})
		bl := setupFamily(t, fmt.Sprintf("raw-B%d", stage), b)
		binary := []familyReceipt{}
		for i := 0; i+1 < n; i += 2 {
			a := stageNode(RawJournal, stage, receipts[i:i+2], []Key{previousKey}, []int{0, 0})
			binary = append(binary, saveStage(t, fmt.Sprintf("%s/B%d-%02d", dir, stage, i/2), bl, a, a.Range, FamilyID{Phase: RawJournal, Level: stage, Arity: 2}))
		}
		keys := []Key{bl.key, previousKey}
		bl = nil
		runtime.GC()
		a := stageNode(RawJournal, stage, binary[:1], keys, []int{0})
		dl := setupFamily(t, fmt.Sprintf("raw-D%d", stage), a)
		for i, r := range binary {
			w := stageNode(RawJournal, stage, []familyReceipt{r}, keys, []int{0})
			saveStage(t, fmt.Sprintf("%s/D%d-%02d", dir, stage, i), dl, w, w.Range, FamilyID{Phase: RawJournal, Level: stage, Arity: 1})
		}
		if n%2 == 1 {
			w := stageNode(RawJournal, stage, receipts[n-1:], keys, []int{1})
			saveStage(t, fmt.Sprintf("%s/D%d-%02d", dir, stage, n/2), dl, w, w.Range, FamilyID{Phase: RawJournal, Level: stage, Arity: 1})
		}
	}
	t.Logf("RAW STAGE COMPLETE stage=%d actualEdges=%d time=%s; development public artifacts only; final prefix completeness checked by RawQualified", stage, len(f.raw), time.Since(start))
}
