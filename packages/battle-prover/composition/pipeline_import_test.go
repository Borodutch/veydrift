package composition

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

var reviewedLinked = [4]string{"8d7936a360c27a25b050c7ecabff9dc27c5e2e3906b59ef1b81207819491f5b7", "1ea7aac42cb0f8055d6d0e7282f47dbdd6c35ba2141c8e55bfbd46f2d45fb9e7", "715b5a17438be44c1c6860e5cb3fe1c46c4e4d40ac1c5c71a374bb351e4e86fc", "46b333144d8bd7dd365f215625398580a62e83b33495db2162bd8402c9879a7c"}

func copyPublicArtifact(t *testing.T, from, to string) {
	b, e := os.ReadFile(from)
	check(t, e)
	writeExclusive(t, to, b)
}

// Import is EXPLICIT and source-owned: verify all genuine proofs against pins
// recovered from terminal receipts, recompile all five raw circuits and actual
// LinkedCircuit to exactly matching CCS hashes, then install separate approvals.
// No PK/setup reconstruction, no arbitrary receipt promotion, no old SHA schema.
func TestImportReviewedPublicStages(t *testing.T) {
	if os.Getenv("PIPELINE_IMPORT_REVIEWED") != "1" {
		t.Skip("explicit audited migration")
	}
	run := os.Getenv("PIPELINE_RUN")
	if run == "" || run == "." || run == ".." || filepath.Base(run) != run {
		t.Fatal("run namespace")
	}
	base := filepath.Join("staged-public", pipelineVersion, run)
	verifyPinnedRawCircuitIdentity(t)
	f := buildSettlement(t, false)
	sources := pipelineSources(t)
	for _, stage := range []int{-1, 0} {
		dir := pipelineStageDir(base, RawJournal, stage)
		check(t, os.MkdirAll(filepath.Dir(dir), 0700))
		check(t, os.Mkdir(dir, 0700))
		m := pipelineManifest{Version: pipelineVersion, Phase: RawJournal, Stage: stage, Height: pipelineHeights[RawJournal], GroupSizes: pipelineSizes[RawJournal], Sources: sources, Dependencies: map[string]string{}, Receipts: map[string]string{}, Keys: map[string]pipelineKeyManifest{}, Complete: true}
		for i, s := range f.raw {
			old := fmt.Sprintf("staged-public/raw-v1/leaf-%02d", i)
			name := pipelineLeafName(0, i)
			id := FamilyID{Phase: RawJournal, Kind: s.Kind}
			keyName := fmt.Sprintf("leaf-%02d", s.Kind)
			keyFile := fmt.Sprintf("leaf-key-%02d.vk", s.Kind)
			if stage == 0 {
				old = fmt.Sprintf("staged-public/raw-v1/D0-%02d", i)
				name = pipelineReceiptName(0, i)
				id = FamilyID{Phase: RawJournal, Arity: 1}
				keyName = "D"
				keyFile = "D-key.vk"
			}
			loadPinnedRaw0(t, old, id)
			for _, ext := range []string{"proof", "public", "vk", "json"} {
				copyPublicArtifact(t, old+"."+ext, filepath.Join(dir, name+"."+ext))
			}
			m.Receipts[name] = pipelineHash(t, filepath.Join(dir, name+".json"))
			pin := reviewedRaw0[old]
			if _, ok := m.Keys[keyName]; !ok {
				copyPublicArtifact(t, old+".vk", filepath.Join(dir, keyFile))
				m.Keys[keyName] = pipelineKeyManifest{VKHash: pin[1], CCSHash: pin[2]}
			}
		}
		if stage == 0 {
			leaf := filepath.Join(pipelineStageDir(base, RawJournal, -1), "manifest.json")
			rel, e := filepath.Rel(base, leaf)
			check(t, e)
			m.Dependencies[filepath.ToSlash(rel)] = pipelineHash(t, leaf)
		}
		pipelineWriteExclusive(t, filepath.Join(dir, "manifest.json"), m)
		pipelineApproveStage(t, base, m)
		if stage < 0 {
			pipelineLoadLeaves(t, base, RawJournal, sources)
		} else {
			pipelineLoadLevel(t, base, RawJournal, 0, sources)
		}
	}
	path := "staged-public/linked-v1/qualification"
	b, e := os.ReadFile(path + ".json")
	check(t, e)
	var old nativeStageMeta
	check(t, json.Unmarshal(b, &old))
	if old.Role != "linked-qualification-v3" || old.Hashes["proof"] != reviewedLinked[0] || old.Hashes["vk"] != reviewedLinked[1] || old.Hashes["public"] != reviewedLinked[2] || old.CCSHash != reviewedLinked[3] {
		t.Fatal("LinkedCircuit independent pin mismatch")
	}
	values := adapterValues(f, "qualification")
	loadPublic(t, path, "linked-qualification-v3", values)
	cc := compile(t, "audited-linked-qualification", f.qualified)
	h := sha256.New()
	_, e = cc.WriteTo(h)
	check(t, e)
	if fmt.Sprintf("%x", h.Sum(nil)) != reviewedLinked[3] {
		t.Fatal("LinkedCircuit differs from approved CCS")
	}
	cc = nil
	runtime.GC()
	dir := adapterDir(base, "qualification")
	check(t, os.MkdirAll(filepath.Dir(dir), 0700))
	check(t, os.Mkdir(dir, 0700))
	for _, ext := range []string{"proof", "public", "vk"} {
		copyPublicArtifact(t, path+"."+ext, filepath.Join(dir, "receipt."+ext))
	}
	old.Role = "qualification"
	data, e := json.MarshalIndent(old, "", "  ")
	check(t, e)
	writeExclusive(t, filepath.Join(dir, "receipt.json"), data)
	m := adapterManifest{Role: "qualification", Sources: sources, Dependencies: map[string]string{}, ReceiptHash: pipelineHash(t, filepath.Join(dir, "receipt.json"))}
	data, e = json.MarshalIndent(m, "", "  ")
	check(t, e)
	writeExclusive(t, filepath.Join(dir, "manifest.json"), data)
	approveAdapter(t, base, "qualification", m)
	loadAdapter(t, base, "qualification", sources, f)
	t.Logf("AUDITED PUBLIC MIGRATION VERIFIED run=%s rawLeaf7 rawD0=7 LinkedCircuit=1 all6CCS-identities matched; no setups or proving keys", run)
}
