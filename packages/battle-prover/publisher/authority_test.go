package publisher

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
)

func TestCrossLanguageFilenameVector(t *testing.T) {
	var v struct {
		Schema, Status, ChainID, Game, BattleID, Binding string
		Release                                          struct{ Version, Rules, Catalog, Verifier, VerifierCodehash string }
		ExpectedReleaseID, ExpectedBasename              *string
	}
	if e := json.Unmarshal(artifactRead(t, "testdata/filename-vector.json"), &v); e != nil {
		t.Fatal(e)
	}
	if v.Release.Version != "3" {
		t.Fatal("vector release")
	}
	release, e := ReleaseID(chainsource.Release{Version: 3, Rules: v.Release.Rules, Catalog: v.Release.Catalog, Verifier: v.Release.Verifier, VerifierCodehash: v.Release.VerifierCodehash})
	if e != nil {
		t.Fatal(e)
	}
	base, e := Basename(v.ChainID, v.Game, v.BattleID, v.Binding, release)
	if e != nil {
		t.Fatal(e)
	}
	if v.ExpectedReleaseID == nil || v.ExpectedBasename == nil {
		t.Fatalf("vector expected hashes pending authorized offline computation: releaseId=%s basename=%s", release, base)
	}
	if release != *v.ExpectedReleaseID || base != *v.ExpectedBasename {
		t.Fatal("cross-language mismatch")
	}
}
func TestAuthorityAllStringsExactFieldOrder(t *testing.T) {
	a := Authority{Schema: AuthoritySchema, ChainID: "8453", Game: "0x0000000000000000000000000000000000000001", BattleID: "100", Binding: "0x" + strings.Repeat("1", 64), ReleaseID: "0x" + strings.Repeat("2", 64), VKHash: strings.Repeat("3", 64), InputHash: strings.Repeat("4", 64), CompressedProofHash: strings.Repeat("5", 64), ExportSHA256: strings.Repeat("6", 64), CatalogSHA256: strings.Repeat("7", 64), JobKey: strings.Repeat("8", 64), JobGeneration: strings.Repeat("9", 64), JobAnchorNumber: "1", JobAnchorHash: strings.Repeat("a", 64), ArtifactBlobSHA256: strings.Repeat("b", 64), PublisherConfigSHA256: strings.Repeat("c", 64)}
	if e := a.Validate(); e != nil {
		t.Fatal(e)
	}
	b := artifactEncode(t, a)
	var wire map[string]string
	if e := json.Unmarshal(b, &wire); e != nil {
		t.Fatal(e)
	}
	fields := []string{"schema", "chainId", "game", "battleId", "binding", "releaseId", "vkHash", "inputHash", "compressedProofHash", "exportSha256", "catalogSha256", "jobKey", "jobGeneration", "jobAnchorNumber", "jobAnchorHash", "artifactBlobSha256", "publisherConfigSha256"}
	if len(wire) != len(fields) {
		t.Fatal("wire fields")
	}
	offset := 0
	for _, field := range fields {
		needle := string(artifactEncode(t, field)) + ":"
		n := strings.Index(string(b[offset:]), needle)
		if n < 0 {
			t.Fatal("wire order")
		}
		offset += n + len(needle)
	}
	a.JobAnchorHash = "0x" + a.JobAnchorHash
	if a.Validate() == nil {
		t.Fatal("prefixed anchor accepted")
	}
}
