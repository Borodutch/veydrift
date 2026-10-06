package processrunner

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
	"time"
)

func config() Config {
	m := Manifest{Protocol, hash([]byte("engine")), hash([]byte("launcher")), hash([]byte("rules")), hash([]byte("verifier"))}
	return Config{EnginePath: "/not/a/default/engine", LauncherPath: "/not/a/default/launcher", Manifest: m, ManifestSHA256: m.Hash(), CPUs: 1, AddressSpaceBytes: 2 << 30, CPUSeconds: 10, WallLimit: 2 * time.Second, MaxInputBytes: 4096, MaxCheckpointBytes: 256, MaxProofBytes: 256, MaxOutputBytes: 4096, MaxStderrBytes: 256}
}
func request() wireRequest {
	return wireRequest{Protocol: Protocol, Identity: hash([]byte("full immutable tuple")), Attempt: hash([]byte("attempt")), ManifestSHA256: config().ManifestSHA256, Input: []byte("public input")}
}
func line(m Message) []byte { b, _ := json.Marshal(m); return append(b, byte(10)) }
func TestPinsAndUnsupported(t *testing.T) {
	c := config()
	c.ManifestSHA256 = hash([]byte("wrong"))
	if _, e := New(c); e == nil {
		t.Fatal("unpinned manifest")
	}
	c = config()
	c.WallLimit = 61 * time.Minute
	if _, e := New(c); e == nil {
		t.Fatal("unbounded wall time")
	}
	c = config()
	c.CPUSeconds = 3601
	if _, e := New(c); e == nil {
		t.Fatal("unbounded CPU time")
	}
	if runtime.GOOS != "linux" {
		if _, e := New(config()); !errors.Is(e, ErrUnsupported) {
			t.Fatal(e)
		}
	}
	f, e := os.CreateTemp(t.TempDir(), "engine")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = f.WriteString("#!/bin/sh\nexit 0"); e != nil {
		t.Fatal(e)
	}
	f.Close()
	os.Chmod(f.Name(), 0700)
	if _, e = pinned(context.Background(), f.Name(), hash([]byte("different"))); e == nil {
		t.Fatal("mutated executable accepted")
	}
	if _, e = pinned(context.Background(), f.Name(), hash([]byte("#!/bin/sh\nexit 0"))); e == nil {
		t.Fatal("shell accepted")
	}
}
func TestStrictProtocolAndStaleArtifacts(t *testing.T) {
	req := request()
	c := config()
	valid := Message{"result", req.Identity, req.Attempt, []byte("UNVERIFIED proof fixture")}
	cases := map[string][]byte{
		"empty":                nil,
		"missing-result":       line(Message{"checkpoint", req.Identity, req.Attempt, []byte("cp")}),
		"stale-attempt":        line(Message{"result", req.Identity, hash([]byte("prior attempt")), []byte("proof")}),
		"stale-identity":       line(Message{"result", hash([]byte("other battle")), req.Attempt, []byte("proof")}),
		"two-results":          append(line(valid), line(valid)...),
		"oversized-result":     line(Message{"result", req.Identity, req.Attempt, bytes.Repeat([]byte("x"), 257)}),
		"oversized-checkpoint": line(Message{"checkpoint", req.Identity, req.Attempt, bytes.Repeat([]byte("x"), 257)}),
		"oversized-line":       bytes.Repeat([]byte("x"), 4097),
		"extra-field":          []byte(fmt.Sprintf("{\"Type\":\"result\",\"Identity\":%q,\"Attempt\":%q,\"Data\":\"YQ==\",\"extra\":true}\n", req.Identity, req.Attempt)),
	}
	for name, b := range cases {
		t.Run(name, func(t *testing.T) {
			if _, e := parse(bytes.NewReader(b), req, c, func(Checkpoint) error { return nil }); e == nil {
				t.Fatal("accepted malformed artifact")
			}
		})
	}
	sentinel := errors.New("stale fencing token")
	b := append(line(Message{"checkpoint", req.Identity, req.Attempt, []byte("cp")}), line(valid)...)
	if _, e := parse(bytes.NewReader(b), req, c, func(Checkpoint) error { return sentinel }); !errors.Is(e, sentinel) {
		t.Fatal(e)
	}
	calls := 0
	p, e := parse(bytes.NewReader(b), req, c, func(cp Checkpoint) error {
		calls++
		if cp.Identity != req.Identity || cp.ManifestSHA256 != req.ManifestSHA256 {
			t.Fatal(cp)
		}
		return nil
	})
	if e != nil || string(p) != string(valid.Data) || calls != 1 {
		t.Fatal(e, calls)
	}
}
func TestRejectResumeBeforeExecution(t *testing.T) {
	c := config()
	s := &Supervisor{cfg: c}
	r := Request{request().Identity, c.Manifest.RulesSHA256, c.Manifest.VerifierSHA256, []byte("input"), &Checkpoint{request().Identity, hash([]byte("obsolete manifest")), []byte("cp")}}
	if _, e := s.Run(context.Background(), r, nil); e == nil || !strings.Contains(e.Error(), "stale") {
		t.Fatal(e)
	}
	r.Checkpoint.ManifestSHA256 = c.ManifestSHA256
	r.Checkpoint.Identity = hash([]byte("unrelated battle"))
	if _, e := s.Run(context.Background(), r, nil); e == nil || !strings.Contains(e.Error(), "stale") {
		t.Fatal(e)
	}
}

// Test child uses the existing test executable. This does NOT bypass Linux
// enforcement in exported API: only unexported execute is tested on macOS.
func TestChild(t *testing.T) {
	mode := os.Getenv("PROCESSRUNNER_TEST_CHILD")
	if mode == "" {
		return
	}
	var req wireRequest
	if e := json.NewDecoder(os.Stdin).Decode(&req); e != nil {
		os.Exit(90)
	}
	switch mode {
	case "crash":
		os.Exit(7)
	case "proof-then-crash":
		_, _ = os.Stdout.Write(line(Message{"result", req.Identity, req.Attempt, []byte("fixture")}))
		os.Exit(7)
	case "descendant":
		b, _ := json.Marshal(req)
		cmd := child("sleep")
		cmd.Stdin = bytes.NewReader(b)
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if e := cmd.Start(); e != nil {
			os.Exit(95)
		}
		_, _ = os.Stdout.Write(line(Message{"checkpoint", req.Identity, req.Attempt, []byte(fmt.Sprint(cmd.Process.Pid))}))
		time.Sleep(time.Minute)
	case "sleep":
		time.Sleep(time.Minute)
	case "stdout":
		_, _ = io.WriteString(os.Stdout, strings.Repeat("x", 10000))
		time.Sleep(time.Minute)
	case "stderr":
		_, _ = io.WriteString(os.Stderr, strings.Repeat("x", 10000))
		time.Sleep(time.Minute)
	case "checkpoint":
		_, _ = os.Stdout.Write(line(Message{"checkpoint", req.Identity, req.Attempt, []byte("checkpoint")}))
		time.Sleep(time.Minute)
	case "stale":
		_, _ = os.Stdout.Write(line(Message{"result", req.Identity, "prior-attempt", []byte("fixture")}))
		os.Exit(0)
	case "ok":
		_, _ = os.Stdout.Write(line(Message{"checkpoint", req.Identity, req.Attempt, []byte("checkpoint")}))
		_, _ = os.Stdout.Write(line(Message{"result", req.Identity, req.Attempt, []byte("UNVERIFIED fixture")}))
		os.Exit(0)
	}
	os.Exit(0)
}
func child(mode string) *exec.Cmd {
	cmd := exec.Command(os.Args[0], "-test.run=^TestChild$")
	cmd.Env = []string{"PROCESSRUNNER_TEST_CHILD=" + mode}
	return cmd
}
func TestChildLifecycle(t *testing.T) {
	for _, mode := range []string{"crash", "proof-then-crash", "sleep", "stdout", "stderr", "stale", "checkpoint", "ok"} {
		t.Run(mode, func(t *testing.T) {
			c := config()
			c.WallLimit = 1500 * time.Millisecond
			if mode == "sleep" {
				c.WallLimit = 100 * time.Millisecond
			}
			req := request()
			b, _ := json.Marshal(req)
			cmd := child(mode)
			start := time.Now()
			p, e := execute(context.Background(), cmd, b, req, c, sink(t, func(Checkpoint) error {
				if mode == "checkpoint" {
					return errors.New("fenced")
				}
				return nil
			}))
			if time.Since(start) > 3*time.Second {
				t.Fatal("child not bounded")
			}
			if cmd.ProcessState == nil || !cmd.ProcessState.Exited() && cmd.ProcessState.Success() {
				t.Fatal("uncollected process")
			}
			if mode == "ok" {
				if e != nil || string(p) != "UNVERIFIED fixture" {
					t.Fatal(e, string(p))
				}
			} else if e == nil {
				t.Fatal("failure accepted")
			}
			if mode == "sleep" && !errors.Is(e, context.DeadlineExceeded) {
				t.Fatal(e)
			}
		})
	}
}
func TestCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	go func() { time.Sleep(100 * time.Millisecond); cancel() }()
	req := request()
	b, _ := json.Marshal(req)
	cmd := child("sleep")
	_, e := execute(ctx, cmd, b, req, config(), nil)
	if !errors.Is(e, context.Canceled) {
		t.Fatal(e)
	}
	if cmd.ProcessState == nil {
		t.Fatal("uncollected child")
	}
}

func sink(t *testing.T, save func(Checkpoint) error) chan<- CheckpointEvent {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	ch := make(chan CheckpointEvent)
	go func() {
		defer close(done)
		for {
			select {
			case ev := <-ch:
				ev.Ack <- save(ev.Checkpoint)
			case <-ctx.Done():
				return
			}
		}
	}()
	t.Cleanup(func() { cancel(); <-done })
	return ch
}
func TestUnacknowledgedCheckpointHonorsDeadline(t *testing.T) {
	req := request()
	b, _ := json.Marshal(req)
	c := config()
	c.WallLimit = 100 * time.Millisecond
	for _, capacity := range []int{0, 1} {
		ch := make(chan CheckpointEvent, capacity)
		start := time.Now()
		_, e := execute(context.Background(), child("checkpoint"), b, req, c, ch)
		if !errors.Is(e, context.DeadlineExceeded) || time.Since(start) > time.Second {
			t.Fatal("checkpoint sink defeated wall limit", e)
		}
	}
}
