package publisher

import (
	"context"
	"encoding/hex"
	"errors"
	"net/url"
	"path/filepath"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	q "github.com/Borodutch/veydrift/packages/battle-prover/qualification"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
)

const ConfigSchema = "veydrift.proof-publisher.v1"
const MaxConfigBytes = 64 << 10
const MaxAuthorityBytes = 16 << 10
const MaxEVMBytes = 16 << 20
const MaxLeaves = 16384

type Config struct {
	Schema         string
	StoreRoot      string
	ArtifactRoot   string
	AuthorityRoot  string
	Catalog        rt.CatalogConfig
	Source         chainsource.Config
	Limits         rt.ArtifactLimits
	MaxJobBytes    int
	MaxExportBytes int
}

// ApprovedConfig cannot be constructed by supplying job-controlled pins. LoadConfig
// requires the exact full-file pin supplied independently by the deployment owner.
type ApprovedConfig struct {
	config Config
	sha256 string
}

func (a *ApprovedConfig) SHA256() string {
	if a == nil {
		return ""
	}
	return a.sha256
}

// LoadConfig performs no RPC, setup, proving, directory creation or store mutation.
func LoadConfig(ctx context.Context, path, externalSHA256 string) (*ApprovedConfig, error) {
	if !digest(externalSHA256) || !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("absolute config path and external full config SHA256 required")
	}
	d, e := openDirectory(filepath.Dir(path))
	if e != nil {
		return nil, e
	}
	defer d.close()
	b, e := d.read(ctx, filepath.Base(path), MaxConfigBytes, 0, externalSHA256)
	if e != nil {
		return nil, e
	}
	var c Config
	if e = canonical(b, &c); e != nil {
		return nil, e
	}
	if e = c.validate(); e != nil {
		return nil, e
	}
	return &ApprovedConfig{c, externalSHA256}, nil
}
func (c Config) validate() error {
	if c.Schema != ConfigSchema {
		return errors.New("unsupported publisher config schema")
	}
	roots := []string{c.StoreRoot, c.ArtifactRoot, c.AuthorityRoot, c.Catalog.Root}
	for i, p := range roots {
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == "/" {
			return errors.New("explicit canonical non-root paths required")
		}
		for _, other := range roots[:i] {
			if p == other || strings.HasPrefix(p, other+"/") || strings.HasPrefix(other, p+"/") {
				return errors.New("store/catalog/artifact/authority roots must be disjoint")
			}
		}
	}
	if !validPath(c.Catalog.ManifestPath) || !digest(c.Catalog.TrustedManifestSHA256) || c.Catalog.MaxManifestBytes < 1 || c.Catalog.MaxManifestBytes > 16<<20 || c.Catalog.MaxArtifactBytes < 1 || c.Catalog.MaxArtifactBytes > 8<<30 {
		return errors.New("invalid approved catalog limits")
	}
	l := c.Limits
	if l.MaxVKBytes < 1 || l.MaxVKBytes > 16<<20 || l.MaxInputBytes < 1 || l.MaxInputBytes > 64<<20 || l.MaxArtifactBytes < 1 || l.MaxArtifactBytes > 16<<20 || l.MaxProofBytes < 1 || l.MaxProofBytes > 4096 || l.MaxLeaves < 1 || l.MaxLeaves > MaxLeaves || c.MaxJobBytes < 1 || c.MaxJobBytes > 1<<20 || c.MaxExportBytes < 1 || c.MaxExportBytes >= MaxEVMBytes {
		return errors.New("positive bounded limits and export cap below 16MiB required")
	}
	if c.Source.MaxInputBytes < 1 || c.Source.MaxInputBytes > l.MaxInputBytes || c.Source.MaxResponseBytes < 1 || c.Source.MaxResponseBytes > 64<<20 || c.Source.MaxRows < 1 || c.Source.MaxRows > MaxLeaves {
		return errors.New("source allocation limits outside publisher budget")
	}
	u, e := url.Parse(c.Source.URL)
	if e != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return errors.New("public RPC URL without credentials/query/fragment required")
	}
	if c.Source.Release.VerifierManifest != c.Catalog.TrustedManifestSHA256 {
		return errors.New("source must use independently approved catalog pin")
	}
	// Validate without constructing a Source or touching the RPC endpoint.
	if _, e := decimal(c.Source.ChainID, 256, true); e != nil {
		return e
	}
	if !address(c.Source.Game) || !address(c.Source.Release.Engine) {
		return errors.New("invalid source game/engine")
	}
	if _, e := ReleaseID(c.Source.Release); e != nil {
		return e
	}
	if c.Source.Release.Rules != hex.EncodeToString(raw.Encode(q.RulesID())) || c.Source.Release.Catalog != hex.EncodeToString(raw.Encode(q.CatalogID())) || c.Source.Release.VerifierCodehash == strings.Repeat("0", 64) || c.Source.Release.VerifierManifest == strings.Repeat("0", 64) {
		return errors.New("unsupported linked rules/catalog or zero release approval")
	}
	if c.Source.Release.Version != 3 || c.Source.BlockPage == 0 || c.Source.FleetPage < 1 || c.Source.MaxPages < 1 || c.Source.MaxFleetReads < 1 || c.Source.MaxLogs < 1 {
		return errors.New("invalid approved source budgets/release")
	}
	return nil
}
