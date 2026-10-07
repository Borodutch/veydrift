package runtime

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"golang.org/x/sys/unix"
)

// ApprovedIdentity is the lightweight host-side approval check. OpenCatalog has
// already authenticated/validated the immutable manifest. Actual CCS/PK/VK
// bytes are hashed and decoded at use by Catalog.Load INSIDE the limited child.
func (c *Catalog) ApprovedIdentity(ctx context.Context, id service.Identity) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := id.Validate(); err != nil {
		return err
	}
	if id.Rules != c.manifest.RulesSHA256 || id.Verifier != c.SHA256() {
		return errors.New("identity rules/verifier catalog mismatch")
	}
	return nil
}

// CheckArtifactPresence runs once during host construction. It never reads file
// contents or decodes keys: missing/nonregular/wrong-sized assets fail admission,
// while exact hash validation remains mandatory at child use (including TOCTOU).
func (c *Catalog) CheckArtifactPresence(ctx context.Context) error {
	for _, entry := range c.manifest.Entries {
		for _, a := range []Artifact{entry.Approval.CCS, entry.Approval.PK, entry.Approval.VK} {
			if err := ctx.Err(); err != nil {
				return err
			}
			if !catalogPathValid(a.Path) {
				return errors.New("invalid artifact path")
			}
			part := ""
			for _, component := range strings.Split(a.Path, string(filepath.Separator)) {
				part = filepath.Join(part, component)
				st, err := c.root.Lstat(part)
				if err != nil {
					return err
				}
				if st.Mode()&os.ModeSymlink != 0 {
					return errors.New("artifact symlink refused")
				}
			}
			f, err := c.root.OpenFile(a.Path, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_NOCTTY, 0)
			if err != nil {
				return err
			}
			st, err := f.Stat()
			closeErr := f.Close()
			if err != nil {
				return err
			}
			if closeErr != nil {
				return closeErr
			}
			if !st.Mode().IsRegular() || st.Size() < 1 || st.Size() != a.Bytes || st.Size() > c.cfg.MaxArtifactBytes {
				return errors.New("artifact presence/type/size mismatch")
			}
		}
	}
	return ctx.Err()
}

type catalogAdmissionGate struct{ catalog *Catalog }

func (g catalogAdmissionGate) Ready(ctx context.Context, id service.Identity) error {
	return g.catalog.ApprovedIdentity(ctx, id)
}
