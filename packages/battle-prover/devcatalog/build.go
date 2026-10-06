package devcatalog

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"runtime/debug"
	"strconv"
	"syscall"
	"time"

	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"golang.org/x/sys/unix"
)

// RunStage starts exactly one bounded subprocess. The independently supplied
// previous receipt pin is mandatory, as is the first-stage cost acknowledgment
// on all later stages. No whole-graph setup operation exists.
func RunStage(ctx context.Context, c Config, index int, previous, firstCosts string) (Receipt, error) {
	var zero Receipt
	if e := c.Validate(); e != nil {
		return zero, e
	}
	g, _ := rt.BuildCatalogGraph(c.RootHeights)
	if index < 0 || index >= len(g) {
		return zero, errors.New("stage index out of graph")
	}
	if index == 0 {
		if previous != "" || firstCosts != "" {
			return zero, errors.New("first stage cannot have prior pins")
		}
	} else if !validHash(previous) || !validHash(firstCosts) {
		return zero, errors.New("explicit prior receipt and measured first-stage cost pins required")
	}
	root, e := openDir(Namespace, true)
	if e != nil {
		return zero, e
	}
	defer root.Close()
	lock, e := acquire(root)
	if e != nil {
		return zero, e
	}
	defer lock.Close()
	executable, e := os.Executable()
	if e != nil {
		return zero, e
	}
	f, e := os.Open(executable)
	if e != nil {
		return zero, e
	}
	h, _, e := hashFile(f, MaxArtifact)
	f.Close()
	if e != nil {
		return zero, e
	}
	if h != c.BuilderSHA256 {
		return zero, errors.New("builder executable pin mismatch")
	}
	cb, _ := canonical(c)
	// Config travels through an anonymous pipe: no transient config file and no
	// credentials/environment inheritance. Lock descriptor is shared with child;
	// a dying parent cannot release it while the child is still running.
	rd, wr, e := os.Pipe()
	if e != nil {
		return zero, e
	}
	defer rd.Close()
	if len(cb) > 4096 {
		wr.Close()
		return zero, errors.New("config pipe bound")
	}
	if _, e = wr.Write(cb); e != nil {
		wr.Close()
		return zero, e
	}
	wr.Close()
	work, cancel := context.WithTimeout(ctx, time.Duration(c.StageSeconds)*time.Second)
	defer cancel()
	cmd := exec.CommandContext(work, executable, "-action=worker", "-stage="+strconv.Itoa(index), "-previous="+previous, "-first-costs="+firstCosts)
	cmd.Env = []string{"GOMAXPROCS=2", "GOMEMLIMIT=6GiB"}
	cmd.ExtraFiles = []*os.File{lock, root, rd}
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = time.Second
	if e = cmd.Run(); e != nil {
		return zero, fmt.Errorf("stage failed; interrupted staging is never accepted: %w", e)
	}
	rs, _, e := scan(root, c)
	if e != nil {
		return zero, e
	}
	if index >= len(rs) {
		return zero, errors.New("child exited without committed receipt")
	}
	return rs[index], nil
}

// Worker is an internal CLI entrypoint requiring inherited lock/root/config
// descriptors. It must not be called as an in-process setup API.
func Worker(index int, previous, firstCosts string) error {
	started := time.Now()
	startupTimer := time.AfterFunc(time.Hour, func() { os.Exit(124) })
	defer startupTimer.Stop()
	runtime.GOMAXPROCS(2)
	debug.SetMemoryLimit(6 << 30)
	lock := os.NewFile(3, "inherited-lock")
	root := os.NewFile(4, "inherited-root")
	cfg := os.NewFile(5, "config")
	if lock == nil || root == nil || cfg == nil {
		return errors.New("worker requires supervisor descriptors")
	}
	defer lock.Close()
	defer root.Close()
	defer cfg.Close()
	b, e := io.ReadAll(io.LimitReader(cfg, 4097))
	if e != nil || len(b) > 4096 {
		return errors.New("worker config bound")
	}
	var c Config
	if e = decode(b, &c); e != nil {
		return e
	}
	if e = c.Validate(); e != nil {
		return e
	}
	exe, e := os.Executable()
	if e != nil {
		return e
	}
	ef, e := os.Open(exe)
	if e != nil {
		return e
	}
	eh, _, e := hashFile(ef, MaxArtifact)
	ef.Close()
	if e != nil {
		return e
	}
	if eh != c.BuilderSHA256 {
		return errors.New("worker executable pin mismatch")
	}
	// An independent watchdog survives supervisor death. Exit releases inherited
	// flock only AFTER heavy work is killed. Also disable core dumps (setup secrets).
	remaining := time.Duration(c.StageSeconds)*time.Second - time.Since(started)
	if remaining <= 0 {
		return errors.New("stage deadline exhausted during startup")
	}
	timer := time.AfterFunc(remaining, func() { os.Exit(124) })
	defer timer.Stop()
	if e = unix.Setrlimit(unix.RLIMIT_CORE, &unix.Rlimit{Cur: 0, Max: 0}); e != nil {
		return e
	}
	if e = unix.Setrlimit(unix.RLIMIT_CPU, &unix.Rlimit{Cur: uint64(c.StageSeconds * 2), Max: uint64(c.StageSeconds * 2)}); e != nil {
		return e
	}
	if e = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); e != nil {
		return e
	}
	// Verify the inherited root and lock refer to the exact namespace objects.
	expected, e := openDir(Namespace, false)
	if e != nil {
		return e
	}
	defer expected.Close()
	a, e := root.Stat()
	if e != nil {
		return e
	}
	z, e := expected.Stat()
	if e != nil || !os.SameFile(a, z) {
		return errors.New("inherited namespace mismatch")
	}
	lf, e := openAt(root, "builder.lock", unix.O_RDWR)
	if e != nil {
		return e
	}
	la, e := lf.Stat()
	lf.Close()
	if e != nil {
		return e
	}
	lb, e := lock.Stat()
	if e != nil || !os.SameFile(la, lb) {
		return errors.New("inherited lock mismatch")
	}
	graph, _ := rt.BuildCatalogGraph(c.RootHeights)
	if index < 0 || index >= len(graph) {
		return errors.New("stage index out of graph")
	}
	rs, hs, e := scan(root, c)
	if e != nil {
		return e
	}
	if index > len(rs) {
		return errors.New("must execute next graph stage")
	}
	if index == 0 {
		if previous != "" || firstCosts != "" {
			return errors.New("unexpected first-stage pins")
		}
	} else {
		if len(hs) < index || previous != hs[index-1] || firstCosts != hs[0] {
			return errors.New("prior receipt/first-stage measurement pin mismatch")
		}
	}
	if index < len(rs) {
		return nil
	} // Exact immutable resume, never setup again.
	if _, _, e = reserve(root, c.BudgetBytes); e != nil {
		return e
	}
	pending := stageName(index) + ".pending"
	// EEXIST after interruption is a blocker requiring explicit operator cleanup,
	// not permission to overwrite or treat incomplete output as resumable.
	if e = unix.Mkdirat(int(root.Fd()), pending, 0700); e != nil {
		return fmt.Errorf("staging conflict: %w", e)
	}
	dir, e := childDir(root, pending)
	if e != nil {
		return e
	}
	defer dir.Close()
	deps := make([]rt.TemplateDependency, 0, len(graph[index].Dependencies))
	pins := []DependencyPin{}
	approvals := []rt.DependencyApproval{}
	byID := map[string]int{}
	for i, r := range rs {
		byID[r.Entry.Node.ID] = i
	}
	for _, id := range graph[index].Dependencies {
		k, ok := byID[id]
		if !ok {
			return errors.New("unbuilt dependency")
		}
		a := rs[k].Entry.Approval
		d, e := loadDependency(root, k, a.CCS, a.VK)
		if e != nil {
			return e
		}
		deps = append(deps, d)
		pins = append(pins, DependencyPin{id, a.CCS.SHA256, a.VK.SHA256, hs[k]})
		approvals = append(approvals, rt.DependencyApproval{ID: id, VKSHA256: a.VK.SHA256})
	}
	began := time.Now()
	template, e := rt.BuildCatalogTemplate(graph[index], deps...)
	if e != nil {
		return e
	}
	cs, e := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, template)
	if e != nil {
		return e
	}
	costs := Costs{Constraints: cs.GetNbConstraints(), CompileNanos: time.Since(began).Nanoseconds()}
	if costs.Constraints < 1 || costs.Constraints > 4000000 || cs.GetNbPublicVariables() != graph[index].PublicInputs+1 {
		return errors.New("compiled circuit exceeds 4M or public schema mismatch; Setup NOT called")
	}
	// Gnark Setup has no recursion option. Recursion's matching native hash
	// options belong to Prove/Verify, not Setup; runtime/prove.go supplies them.
	began = time.Now()
	pk, vk, e := groth16.Setup(cs)
	if e != nil {
		return e
	}
	costs.SetupNanos = time.Since(began).Nanoseconds()
	began = time.Now()
	artifacts := make([]rt.Artifact, 3)
	for i, obj := range []io.WriterTo{cs, pk, vk} {
		artifacts[i], e = writeArtifact(dir, []string{"ccs.bin", "pk.bin", "vk.bin"}[i], obj, MaxArtifact)
		if e != nil {
			return e
		}
		artifacts[i].Path = stageName(index) + "/" + artifacts[i].Path
		costs.ArtifactBytes += artifacts[i].Bytes
	}
	costs.WriteNanos = time.Since(began).Nanoseconds()
	costs.TotalNanos = time.Since(started).Nanoseconds()
	measure(&costs)
	if costs.TotalNanos > int64(time.Duration(c.StageSeconds)*time.Second) {
		return errors.New("stage deadline exceeded before publication")
	}
	a2 := rt.KeyApproval{SourceSHA256: c.SourceSHA256, CircuitSHA256: artifacts[0].SHA256, SchemaSHA256: c.SchemaSHA256, ProvenanceSHA256: c.ProvenanceSHA256, CCS: artifacts[0], PK: artifacts[1], VK: artifacts[2], Dependencies: approvals}
	receipt := Receipt{Protocol: Protocol, ConfigSHA256: digest(b), PreviousReceiptSHA256: previous, Index: index, Entry: rt.CatalogEntry{Node: graph[index], Approval: a2}, Dependencies: pins, Costs: costs}
	if e = writeJSON(dir, "receipt.json", receipt); e != nil {
		return e
	}
	if e = dir.Sync(); e != nil {
		return e
	}
	if e = dir.Chmod(0500); e != nil {
		return e
	}
	if e = publish(int(root.Fd()), pending, stageName(index)); e != nil {
		return e
	}
	return root.Sync()
}
func loadDependency(root *os.File, index int, ccs, vk rt.Artifact) (rt.TemplateDependency, error) {
	d := rt.TemplateDependency{CCS: groth16.NewCS(ecc.BN254), VK: groth16.NewVerifyingKey(ecc.BN254)}
	dir, e := childDir(root, stageName(index))
	if e != nil {
		return d, e
	}
	defer dir.Close()
	for i, a := range []rt.Artifact{ccs, vk} {
		name := []string{"ccs.bin", "vk.bin"}[i]
		if a.Path != stageName(index)+"/"+name {
			return d, errors.New("dependency path mismatch")
		}
		f, e := openAt(dir, name, unix.O_RDONLY)
		if e != nil {
			return d, e
		}
		e = decodePinned(f, a, i == 0, []io.ReaderFrom{d.CCS, d.VK}[i])
		f.Close()
		if e != nil {
			return d, e
		}
	}
	return d, nil
}
func decodePinned(f *os.File, a rt.Artifact, isCCS bool, dst io.ReaderFrom) error {
	h, n, e := hashFile(f, MaxArtifact)
	if e != nil {
		return e
	}
	if h != a.SHA256 || n != a.Bytes {
		return errors.New("dependency exact hash/length mismatch")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return e
	}
	if isCCS {
		var header [32]byte
		if _, e = io.ReadFull(f, header[:]); e != nil {
			return e
		}
		if n < 32 || binary.LittleEndian.Uint64(header[:8]) != uint64(n-32) || binary.LittleEndian.Uint64(header[8:16]) != 0 || binary.LittleEndian.Uint64(header[16:24]) != 16 || binary.LittleEndian.Uint64(header[24:]) != 3 {
			return errors.New("CCS serialized header mismatch")
		}
		if _, e = f.Seek(0, 0); e != nil {
			return e
		}
	}
	consumed, e := dst.ReadFrom(io.LimitReader(f, n))
	if e != nil {
		return e
	}
	if consumed != n {
		return errors.New("dependency trailing bytes")
	}
	// Repeat hash on the same descriptor, detecting modification during decode.
	h2, n2, e := hashFile(f, MaxArtifact)
	if e != nil {
		return e
	}
	if h2 != h || n2 != n {
		return errors.New("dependency modified while decoding")
	}
	return nil
}
func measure(c *Costs) {
	var u unix.Rusage
	if unix.Getrusage(unix.RUSAGE_SELF, &u) != nil {
		return
	}
	c.PeakRSSBytes = u.Maxrss
	if runtime.GOOS != "darwin" {
		c.PeakRSSBytes *= 1024
	}
	c.UserCPUNanos = u.Utime.Nano()
	c.SystemCPUNanos = u.Stime.Nano()
}
