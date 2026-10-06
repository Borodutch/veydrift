//go:build linux

package processrunner

import (
	"context"
	"encoding/json"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func integrationConfig(t *testing.T) Config {
	t.Helper()
	engine := os.Getenv("PROCESSRUNNER_LINUX_ENGINE")
	launcher := os.Getenv("PROCESSRUNNER_LINUX_LAUNCHER")
	if engine == "" || launcher == "" {
		t.Skip("Linux fixture binaries not supplied; see README")
	}
	c := config()
	c.EnginePath = engine
	c.LauncherPath = launcher
	b, e := os.ReadFile(engine)
	if e != nil {
		t.Fatal(e)
	}
	c.Manifest.EngineSHA256 = hash(b)
	b, e = os.ReadFile(launcher)
	if e != nil {
		t.Fatal(e)
	}
	c.Manifest.LauncherSHA256 = hash(b)
	c.ManifestSHA256 = c.Manifest.Hash()
	c.WallLimit = 5 * time.Second
	c.CPUSeconds = 2
	c.MaxProofBytes = 16384
	c.MaxOutputBytes = 32768
	return c
}
func runLinux(t *testing.T, c Config, mode string) (Result, error) {
	t.Helper()
	s, e := New(c)
	if e != nil {
		t.Fatal(e)
	}
	return s.Run(context.Background(), Request{Identity: request().Identity, RulesSHA256: c.Manifest.RulesSHA256, VerifierSHA256: c.Manifest.VerifierSHA256, Input: []byte(mode)}, sink(t, func(Checkpoint) error { return nil }))
}
func TestLinuxActualHardLimits(t *testing.T) {
	c := integrationConfig(t)
	r, e := runLinux(t, c, "probe")
	if e != nil {
		t.Fatal(e)
	}
	var report struct {
		Limits  string
		CPUs    int
		Env     []string
		Denials map[string]bool
	}
	if e = json.Unmarshal(r.Proof, &report); e != nil {
		t.Fatal(e)
	}
	if report.CPUs != 1 {
		t.Fatal(report)
	}
	for name, denied := range report.Denials {
		if !denied {
			t.Fatalf("resource escape %s: %+v", name, report)
		}
	}
	if len(report.Denials) != 6 {
		t.Fatal(report)
	}
	for _, pair := range []struct{ name, value string }{{"Max cpu time", "2"}, {"Max address space", "2147483648"}, {"Max core file size", "0"}, {"Max file size", "32768"}, {"Max open files", "64"}} {
		found := false
		for _, line := range strings.Split(report.Limits, "\n") {
			if strings.HasPrefix(line, pair.name) {
				fields := strings.Fields(strings.TrimPrefix(line, pair.name))
				if len(fields) < 2 || fields[0] != pair.value || fields[1] != pair.value {
					t.Fatal(line)
				}
				found = true
			}
		}
		if !found {
			t.Fatal("missing limit", pair.name)
		}
	}
	if len(report.Env) != 4 {
		t.Fatal("environment leak", report.Env)
	}
	for _, v := range report.Env {
		if !strings.HasPrefix(v, "GOMAXPROCS=") && !strings.HasPrefix(v, "HOME=") && !strings.HasPrefix(v, "TMPDIR=") && v != "LANG=C" {
			t.Fatal("environment leak", v)
		}
	}
	t.Logf("Linux enforced: CPUs=%d; address space=2GiB; hard CPU=2s; fork/group/limit/affinity escape denied; oversized mmap ENOMEM", report.CPUs)
}
func TestLinuxCPUAndWallKill(t *testing.T) {
	c := integrationConfig(t)
	c.CPUSeconds = 1
	start := time.Now()
	if _, e := runLinux(t, c, "cpu"); e == nil || errors.Is(e, context.DeadlineExceeded) {
		t.Fatalf("CPU limit was not responsible: %v", e)
	} else {
		var exited *exec.ExitError
		if !errors.As(e, &exited) {
			t.Fatalf("missing kernel exit evidence: %v", e)
		}
		status, ok := exited.Sys().(syscall.WaitStatus)
		if !ok || !status.Signaled() || status.Signal() != syscall.SIGKILL {
			t.Fatalf("CPU limit did not SIGKILL: %v", e)
		}
		t.Log("hard CPU limit delivered SIGKILL before wall deadline")
	}
	if time.Since(start) > 4*time.Second {
		t.Fatal("CPU limit too late")
	}
	c.WallLimit = 200 * time.Millisecond
	if _, e := runLinux(t, c, "sleep"); !errors.Is(e, context.DeadlineExceeded) {
		t.Fatal(e)
	}
}
func TestLinuxCrashOutputAndCheckpoint(t *testing.T) {
	c := integrationConfig(t)
	for _, mode := range []string{"crash", "stdout"} {
		if _, e := runLinux(t, c, mode); e == nil {
			t.Fatal("accepted", mode)
		}
	}
	if r, e := runLinux(t, c, "checkpoint"); e != nil || string(r.Proof) != "UNVERIFIED fixture" {
		t.Fatal(r, e)
	}
}
func TestLinuxSealedExecutable(t *testing.T) {
	c := integrationConfig(t)
	original, e := os.ReadFile(c.EnginePath)
	if e != nil {
		t.Fatal(e)
	}
	path := filepath.Join(t.TempDir(), "engine")
	if e = os.WriteFile(path, original, 0700); e != nil {
		t.Fatal(e)
	}
	f, e := pinned(path, c.Manifest.EngineSHA256)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	if _, e = f.WriteAt([]byte("changed"), 0); !errors.Is(e, unix.EPERM) {
		t.Fatal("sealed engine mutable", e)
	}
	if e = os.WriteFile(path, []byte("changed"), 0700); e != nil {
		t.Fatal(e)
	}
	head := make([]byte, 4)
	if _, e = f.ReadAt(head, 0); e != nil || string(head) != "\x7fELF" {
		t.Fatal(e, head)
	}
	if _, e = pinned(path, c.Manifest.EngineSHA256); e == nil {
		t.Fatal("stale pin accepted")
	}
}

func TestLinuxGroupCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req := request()
	b, _ := json.Marshal(req)
	pid := ""
	cmd := child("descendant")
	_, e := execute(ctx, cmd, b, req, config(), sink(t, func(cp Checkpoint) error { pid = string(cp.Data); cancel(); return nil }))
	if !errors.Is(e, context.Canceled) || pid == "" {
		t.Fatal("descendant not canceled", pid, e)
	}
	stat, e := os.ReadFile("/proc/" + pid + "/stat")
	if os.IsNotExist(e) {
		return
	}
	if e != nil {
		t.Fatal(e)
	}
	// Orphans may remain briefly as zombies until namespace init reaps them.
	fields := strings.Fields(string(stat))
	if len(fields) < 3 || fields[2] != "Z" {
		t.Fatalf("descendant still running: %s", stat)
	}
}
