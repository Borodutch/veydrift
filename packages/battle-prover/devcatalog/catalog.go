package devcatalog

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"time"

	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"golang.org/x/sys/unix"
)

const Protocol = "veydrift-development-catalog-v1"

// Config is source-frozen AFTER review. Hashes reference independently reviewed
// public source/rules/schema/provenance documents, never secrets or witnesses.
// EngineeringApprovalSHA256 records authorization to execute, NOT key approval.
type Config struct {
	Protocol                                                  string
	RootHeights                                               [7]int
	SourceSHA256, RulesSHA256, SchemaSHA256, ProvenanceSHA256 string
	BuilderSHA256, EngineeringApprovalSHA256                  string
	BudgetBytes                                               int64
	StageSeconds                                              int
}
type DependencyPin struct{ ID, CCSSHA256, VKSHA256, ReceiptSHA256 string }
type Costs struct {
	Constraints                                      int
	CompileNanos, SetupNanos, WriteNanos, TotalNanos int64
	ArtifactBytes                                    int64
	PeakRSSBytes                                     int64
	UserCPUNanos, SystemCPUNanos                     int64
}
type Receipt struct {
	Protocol, ConfigSHA256, PreviousReceiptSHA256 string
	Index                                         int
	Entry                                         rt.CatalogEntry
	Dependencies                                  []DependencyPin
	Costs                                         Costs
}
type Candidate struct {
	Protocol      string
	ConfigSHA256  string
	Complete      bool
	Manifest      rt.CatalogManifest
	ReceiptSHA256 []string
	Warning       string
}
type Plan struct {
	Protocol, Namespace, ConfigSHA256                                     string
	Graph                                                                 []rt.CatalogNode
	BudgetBytes, StageReserveBytes, AvailableFloorBytes, MaxArtifactBytes int64
	MaxConstraints, CPUs                                                  int
	SoftMemoryBytes                                                       int64
	StageSeconds                                                          int
	Warning                                                               string
}

func (c Config) Validate() error {
	if c.Protocol != Protocol {
		return errors.New("unsupported development protocol")
	}
	if _, e := rt.BuildCatalogGraph(c.RootHeights); e != nil {
		return e
	}
	// This namespace is expressly finite-height validation, not the D256 catalog.
	for _, h := range c.RootHeights {
		if h == 256 {
			return errors.New("finite development heights must be below 256")
		}
	}
	for _, h := range []string{c.SourceSHA256, c.RulesSHA256, c.SchemaSHA256, c.ProvenanceSHA256, c.BuilderSHA256, c.EngineeringApprovalSHA256} {
		if !validHash(h) {
			return errors.New("missing source/rules/schema/provenance/builder/engineering digest")
		}
	}
	if c.BudgetBytes < StageReserve || c.BudgetBytes > MaxBudget || c.StageSeconds < 1 || c.StageSeconds > 3600 {
		return errors.New("invalid storage/time budget")
	}
	return nil
}
func ReadConfig(path, pin string) (Config, error) {
	var c Config
	if !validHash(pin) {
		return c, errors.New("explicit config SHA256 required")
	}
	d, e := openDir(filepath.Dir(path), false)
	if e != nil {
		return c, e
	}
	defer d.Close()
	b, e := readSmall(d, filepath.Base(path))
	if e != nil {
		return c, e
	}
	if digest(b) != pin {
		return c, errors.New("config pin mismatch")
	}
	if e = decode(b, &c); e != nil {
		return c, e
	}
	return c, c.Validate()
}
func MakePlan(c Config) (Plan, error) {
	if e := c.Validate(); e != nil {
		return Plan{}, e
	}
	g, e := rt.BuildCatalogGraph(c.RootHeights)
	if e != nil {
		return Plan{}, e
	}
	b, _ := canonical(c)
	return Plan{Protocol: Protocol, Namespace: Namespace, ConfigSHA256: digest(b), Graph: g, BudgetBytes: c.BudgetBytes, StageReserveBytes: StageReserve, AvailableFloorBytes: FreeFloor, MaxArtifactBytes: MaxArtifact, MaxConstraints: 4000000, CPUs: 2, SoftMemoryBytes: 6 << 30, StageSeconds: c.StageSeconds, Warning: "PLAN ONLY: no compile/setup. Individual stages require authorization; no full-graph action. Candidate hashes are not external key approval."}, nil
}
func childDir(root *os.File, name string) (*os.File, error) {
	fd, e := unix.Openat(int(root.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	return os.NewFile(uintptr(fd), name), nil
}
func validateArtifacts(root *os.File, r Receipt) error {
	d, e := childDir(root, stageName(r.Index))
	if e != nil {
		return e
	}
	defer d.Close()
	for i, a := range []rt.Artifact{r.Entry.Approval.CCS, r.Entry.Approval.PK, r.Entry.Approval.VK} {
		name := []string{"ccs.bin", "pk.bin", "vk.bin"}[i]
		if a.Path != stageName(r.Index)+"/"+name || !validHash(a.SHA256) || a.Bytes < 1 || a.Bytes > MaxArtifact {
			return errors.New("invalid receipt artifact")
		}
		f, err := openAt(d, name, unix.O_RDONLY)
		if err != nil {
			return err
		}
		h, n, err := hashFile(f, MaxArtifact)
		f.Close()
		if err != nil {
			return err
		}
		if h != a.SHA256 || n != a.Bytes {
			return errors.New("immutable artifact conflict")
		}
	}
	return nil
}

// scan validates a contiguous canonical receipt chain and all persisted bytes.
// Partial stage directories are not a success signal and always block resume.
func scan(root *os.File, c Config) ([]Receipt, []string, error) {
	graph, _ := rt.BuildCatalogGraph(c.RootHeights)
	if err := validateNamespace(root, len(graph)); err != nil {
		return nil, nil, err
	}
	cb, _ := canonical(c)
	configHash := digest(cb)
	receipts := []Receipt{}
	hashes := []string{}
	byID := map[string]int{}
	previous := ""
	gap := false
	for i, node := range graph {
		d, e := childDir(root, stageName(i))
		if errors.Is(e, os.ErrNotExist) {
			gap = true
			continue
		}
		if e != nil {
			return nil, nil, e
		}
		if gap {
			d.Close()
			return nil, nil, errors.New("out of order committed stage")
		}
		b, e := readSmall(d, "receipt.json")
		d.Close()
		if e != nil {
			return nil, nil, e
		}
		var r Receipt
		if e = decode(b, &r); e != nil {
			return nil, nil, e
		}
		a := r.Entry.Approval
		if r.Protocol != Protocol || r.ConfigSHA256 != configHash || r.PreviousReceiptSHA256 != previous || r.Index != i || !reflect.DeepEqual(r.Entry.Node, node) || a.SourceSHA256 != c.SourceSHA256 || a.SchemaSHA256 != c.SchemaSHA256 || a.ProvenanceSHA256 != c.ProvenanceSHA256 || a.ApprovalSHA256 != "" || a.CircuitSHA256 != a.CCS.SHA256 {
			return nil, nil, errors.New("receipt metadata conflict")
		}
		if r.Costs.Constraints < 1 || r.Costs.Constraints > 4000000 || r.Costs.TotalNanos < 1 || r.Costs.TotalNanos > int64(time.Duration(c.StageSeconds)*time.Second) || r.Costs.ArtifactBytes != a.CCS.Bytes+a.PK.Bytes+a.VK.Bytes {
			return nil, nil, errors.New("invalid stage cost evidence")
		}
		if len(r.Dependencies) != len(node.Dependencies) || len(a.Dependencies) != len(node.Dependencies) {
			return nil, nil, errors.New("dependency length mismatch")
		}
		for j, id := range node.Dependencies {
			k, ok := byID[id]
			if !ok {
				return nil, nil, errors.New("missing prior dependency")
			}
			prior := receipts[k].Entry.Approval
			want := DependencyPin{id, prior.CCS.SHA256, prior.VK.SHA256, hashes[k]}
			if r.Dependencies[j] != want || a.Dependencies[j] != (rt.DependencyApproval{ID: id, VKSHA256: prior.VK.SHA256}) {
				return nil, nil, errors.New("dependency pin mismatch")
			}
		}
		if e = validateArtifacts(root, r); e != nil {
			return nil, nil, e
		}
		previous = digest(b)
		byID[node.ID] = i
		receipts = append(receipts, r)
		hashes = append(hashes, previous)
	}
	return receipts, hashes, nil
}
func candidate(c Config, rs []Receipt, hs []string) Candidate {
	b, _ := canonical(c)
	g, _ := rt.BuildCatalogGraph(c.RootHeights)
	m := rt.CatalogManifest{Protocol: rt.CatalogProtocol, GnarkVersion: rt.CatalogGnarkVersion, Curve: "BN254", SourceSHA256: c.SourceSHA256, RulesSHA256: c.RulesSHA256, SchemaSHA256: c.SchemaSHA256, RootHeights: c.RootHeights, Entries: []rt.CatalogEntry{}}
	for _, r := range rs {
		m.Entries = append(m.Entries, r.Entry)
	}
	return Candidate{Protocol: Protocol, ConfigSHA256: digest(b), Complete: len(rs) == len(g), Manifest: m, ReceiptSHA256: hs, Warning: "UNAPPROVED development candidate. Empty per-key ApprovalSHA256 deliberately prevents runtime admission. External reviewer must attest keys and pin final canonical manifest bytes separately. Not production or a ceremony."}
}
func acquire(root *os.File) (*os.File, error) {
	f, e := openAt(root, "builder.lock", unix.O_RDWR|unix.O_CREAT)
	if e != nil {
		return nil, e
	}
	if e = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); e != nil {
		f.Close()
		return nil, fmt.Errorf("another stage holds lock: %w", e)
	}
	return f, nil
}

// Inspect never compiles or sets up. It emits a candidate to the caller, not an
// automatically approved CatalogManifest. Existing bytes are verified streamed.
func Inspect(c Config) (Candidate, error) {
	if e := c.Validate(); e != nil {
		return Candidate{}, e
	}
	root, e := openDir(Namespace, false)
	if e != nil {
		return Candidate{}, e
	}
	defer root.Close()
	lock, e := acquire(root)
	if e != nil {
		return Candidate{}, e
	}
	defer lock.Close()
	rs, hs, e := scan(root, c)
	if e != nil {
		return Candidate{}, e
	}
	return candidate(c, rs, hs), nil
}
