package runtime

import (
	"context"
	"errors"

	"github.com/Borodutch/veydrift/packages/battle-prover/processrunner"
)

// NewApprovedProcessRunner is the concrete production composition. The caller
// retains and closes catalog after all workers stop. Catalog/engine approvals
// come from deployment configuration, never from a candidate proof or job.
func NewApprovedProcessRunner(ctx context.Context, cfg processrunner.Config, catalog *Catalog, limits ArtifactLimits) (*ProcessRunner, error) {
	if catalog == nil {
		return nil, errors.New("approved catalog required")
	}
	if cfg.Manifest.VerifierSHA256 != catalog.SHA256() || cfg.Manifest.RulesSHA256 != catalog.manifest.RulesSHA256 {
		return nil, errors.New("process and key catalog approvals disagree")
	}
	entry, ok := catalog.entries[AdapterKeyID("final")]
	if !ok {
		return nil, errors.New("approved final circuit absent")
	}
	vk, err := catalog.readArtifact(ctx, entry.Approval.VK, int64(limits.MaxVKBytes), true)
	if err != nil {
		return nil, err
	}
	checker, err := NewArtifactVerifier(vk, ArtifactApproval{VKHash: entry.Approval.VK.SHA256, Rules: catalog.manifest.RulesSHA256, VerifierManifest: catalog.SHA256()}, limits)
	if err != nil {
		return nil, err
	}
	return NewProcessRunner(cfg, catalog, checker)
}
