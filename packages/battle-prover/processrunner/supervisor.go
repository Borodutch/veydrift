// Package processrunner executes a pinned proving engine under a pinned Linux
// resource launcher. It does not verify proofs or implement service.Runner.
package processrunner

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"debug/elf"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

const Protocol = "veydrift-prover-process-v1"

var digest = regexp.MustCompile("^[0-9a-f]{64}$")
var ErrUnsupported = errors.New("hard process enforcement requires Linux")
var ErrOutput = errors.New("invalid or oversized engine output")

type Manifest struct {
	Protocol       string
	EngineSHA256   string
	LauncherSHA256 string
	RulesSHA256    string
	VerifierSHA256 string
}

// Manifest hash is SHA256 of json.Marshal(Manifest), including the fixed field
// order above. Paths are configured independently; arguments cannot be supplied.
func (m Manifest) Hash() string { b, _ := json.Marshal(m); return hash(b) }
func hash(b []byte) string      { s := sha256.Sum256(b); return hex.EncodeToString(s[:]) }

type Config struct {
	EnginePath         string
	LauncherPath       string
	Manifest           Manifest
	ManifestSHA256     string
	CPUs               int
	AddressSpaceBytes  uint64
	CPUSeconds         uint64
	WallLimit          time.Duration
	MaxInputBytes      int
	MaxCheckpointBytes int
	MaxProofBytes      int
	MaxOutputBytes     int
	MaxStderrBytes     int
}
type Request struct {
	Identity       string // exact service.Identity.Key(), never a battle ID alone
	RulesSHA256    string
	VerifierSHA256 string
	Input          []byte
	Checkpoint     *Checkpoint
}
type Checkpoint struct {
	Identity       string
	ManifestSHA256 string
	Data           []byte
}

// CheckpointEvent requires durable, fenced persistence before Ack. Send exactly
// one error (nil on success). Ack is buffered so late acknowledgments never block.
// The supervisor never runs caller callbacks or waits past its context deadline.
type CheckpointEvent struct {
	Checkpoint Checkpoint
	Ack        chan<- error
}

type Result struct {
	Proof          []byte
	Identity       string
	ManifestSHA256 string
}
type wireRequest struct {
	Protocol       string
	Identity       string
	Attempt        string
	ManifestSHA256 string
	Input          []byte
	Checkpoint     []byte
}

// Engine stdout is NDJSON of this schema. Each checkpoint/result is bound to
// the unpredictable invocation Attempt; replayed files/stdout cannot succeed.
type Message struct {
	Type     string // checkpoint or result
	Identity string
	Attempt  string
	Data     []byte
}
type Supervisor struct{ cfg Config }

func New(c Config) (*Supervisor, error) {
	if c.Manifest.Protocol != Protocol || !digest.MatchString(c.ManifestSHA256) || c.Manifest.Hash() != c.ManifestSHA256 {
		return nil, errors.New("manifest pin mismatch")
	}
	for _, h := range []string{c.Manifest.EngineSHA256, c.Manifest.LauncherSHA256, c.Manifest.RulesSHA256, c.Manifest.VerifierSHA256} {
		if !digest.MatchString(h) {
			return nil, errors.New("invalid manifest hash")
		}
	}
	if !filepath.IsAbs(c.EnginePath) || !filepath.IsAbs(c.LauncherPath) || c.CPUs < 1 || c.CPUs > 1024 || c.AddressSpaceBytes < 1 || c.AddressSpaceBytes > 1<<62 || c.CPUSeconds < 1 || c.CPUSeconds > 3600*uint64(c.CPUs) || c.WallLimit <= 0 || c.WallLimit > 60*time.Minute {
		return nil, errors.New("invalid hard resource limits")
	}
	for _, n := range []int{c.MaxInputBytes, c.MaxCheckpointBytes, c.MaxProofBytes, c.MaxOutputBytes, c.MaxStderrBytes} {
		if n < 1 || n > 256<<20 {
			return nil, errors.New("invalid IO bound")
		}
	}
	if c.MaxOutputBytes < c.MaxProofBytes || c.MaxOutputBytes < c.MaxCheckpointBytes {
		return nil, errors.New("output budget below artifact budget")
	}
	if err := supported(); err != nil {
		return nil, err
	}
	return &Supervisor{cfg: c}, nil
}

// Run creates a private fresh working directory, supplies only a minimal fixed
// environment, and never interprets a shell command. The checkpoint receiver must
// persist using its current fenced lease before acknowledging; errors kill the child.
// Proof bytes are UNVERIFIED and must pass the actual cryptographic verifier.
func (s *Supervisor) Run(ctx context.Context, r Request, checkpoints chan<- CheckpointEvent) (Result, error) {
	var zero Result
	c := s.cfg
	ctx, cancel := context.WithTimeout(ctx, c.WallLimit)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	if !digest.MatchString(r.Identity) || r.RulesSHA256 != c.Manifest.RulesSHA256 || r.VerifierSHA256 != c.Manifest.VerifierSHA256 {
		return zero, errors.New("request identity/manifest mismatch")
	}
	if len(r.Input) == 0 || len(r.Input) > c.MaxInputBytes {
		return zero, errors.New("input size limit")
	}
	var resume []byte
	if r.Checkpoint != nil {
		p := r.Checkpoint
		if p.Identity != r.Identity || p.ManifestSHA256 != c.ManifestSHA256 || len(p.Data) == 0 || len(p.Data) > c.MaxCheckpointBytes {
			return zero, errors.New("stale or oversized checkpoint")
		}
		resume = p.Data
	}
	engine, err := pinned(c.EnginePath, c.Manifest.EngineSHA256)
	if err != nil {
		return zero, err
	}
	defer engine.Close()
	launcher, err := pinned(c.LauncherPath, c.Manifest.LauncherSHA256)
	if err != nil {
		return zero, err
	}
	defer launcher.Close()
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		return zero, err
	}
	request := wireRequest{Protocol, r.Identity, hex.EncodeToString(nonce), c.ManifestSHA256, r.Input, resume}
	input, err := json.Marshal(request)
	if err != nil {
		return zero, err
	}
	dir, err := os.MkdirTemp("", "veydrift-engine-")
	if err != nil {
		return zero, err
	}
	defer os.RemoveAll(dir)
	// fd3 is the pinned immutable launcher, fd4 the pinned immutable engine.
	cmd := exec.Command("/proc/self/fd/3", strconv.Itoa(c.CPUs), strconv.FormatUint(c.AddressSpaceBytes, 10), strconv.FormatUint(c.CPUSeconds, 10), strconv.Itoa(c.MaxOutputBytes))
	cmd.ExtraFiles = []*os.File{launcher, engine}
	cmd.Dir = dir
	cmd.Env = []string{"GOMAXPROCS=" + strconv.Itoa(c.CPUs), "HOME=" + dir, "TMPDIR=" + dir, "LANG=C"}
	proof, err := execute(ctx, cmd, input, request, c, checkpoints)
	if err != nil {
		return zero, err
	}
	return Result{proof, r.Identity, c.ManifestSHA256}, nil
}
func execute(ctx context.Context, cmd *exec.Cmd, input []byte, request wireRequest, c Config, checkpoints chan<- CheckpointEvent) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, c.WallLimit)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	group(cmd)
	cmd.Stdin = bytes.NewReader(input)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		stdout.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		stdout.Close()
		stderr.Close()
		return nil, err
	}
	// Killing the entire group also removes descendants retaining pipe handles.
	finished := make(chan struct{})
	watchDone := make(chan struct{})
	go func() {
		defer close(watchDone)
		select {
		case <-ctx.Done():
			killGroup(cmd)
		case <-finished:
		}
	}()
	type parsed struct {
		proof []byte
		err   error
	}
	out := make(chan parsed, 1)
	errs := make(chan error, 1)
	go func() {
		p, e := parse(stdout, request, c, func(cp Checkpoint) error {
			if checkpoints == nil {
				return ErrOutput
			}
			ack := make(chan error, 1)
			select {
			case checkpoints <- CheckpointEvent{cp, ack}:
			case <-ctx.Done():
				return ctx.Err()
			}
			select {
			case e := <-ack:
				return e
			case <-ctx.Done():
				return ctx.Err()
			}
		})
		if e != nil {
			killGroup(cmd)
		}
		out <- parsed{p, e}
	}()
	go func() {
		n, e := io.Copy(io.Discard, io.LimitReader(stderr, int64(c.MaxStderrBytes)+1))
		if n > int64(c.MaxStderrBytes) {
			e = ErrOutput
			killGroup(cmd)
		}
		errs <- e
	}()
	parsedOut := <-out
	stderrErr := <-errs
	// Stop cancellation before reaping: never signal a potentially reused PID
	// after Wait. If streams close while the process remains live, Wait is still
	// bounded by the deadline via the waiter below.
	waitErr := waitProcess(ctx, cmd, finished, watchDone)
	if err = ctx.Err(); err != nil {
		return nil, err
	}
	if parsedOut.err != nil || stderrErr != nil {
		return nil, errors.Join(parsedOut.err, stderrErr, waitErr)
	}
	if waitErr != nil {
		return nil, fmt.Errorf("engine failed: %w", waitErr)
	}
	return parsedOut.proof, nil
}
func parse(r io.Reader, req wireRequest, c Config, save func(Checkpoint) error) ([]byte, error) {
	limited := &io.LimitedReader{R: r, N: int64(c.MaxOutputBytes) + 1}
	scanner := bufio.NewScanner(limited)
	lineLimit := c.MaxProofBytes
	if c.MaxCheckpointBytes > lineLimit {
		lineLimit = c.MaxCheckpointBytes
	}
	lineLimit = lineLimit*2 + 1024
	if lineLimit > c.MaxOutputBytes {
		lineLimit = c.MaxOutputBytes
	}
	scanner.Buffer(make([]byte, 1024), lineLimit)
	var proof []byte
	for scanner.Scan() {
		if proof != nil {
			return nil, ErrOutput
		}
		var msg Message
		d := json.NewDecoder(bytes.NewReader(scanner.Bytes()))
		d.DisallowUnknownFields()
		if e := d.Decode(&msg); e != nil {
			return nil, ErrOutput
		}
		if e := d.Decode(new(any)); e != io.EOF {
			return nil, ErrOutput
		}
		if msg.Identity != req.Identity || msg.Attempt != req.Attempt || len(msg.Data) == 0 {
			return nil, ErrOutput
		}
		switch msg.Type {
		case "checkpoint":
			if len(msg.Data) > c.MaxCheckpointBytes || save == nil {
				return nil, ErrOutput
			}
			if e := save(Checkpoint{req.Identity, req.ManifestSHA256, msg.Data}); e != nil {
				return nil, e
			}
		case "result":
			if len(msg.Data) > c.MaxProofBytes {
				return nil, ErrOutput
			}
			proof = msg.Data
		default:
			return nil, ErrOutput
		}
	}
	if limited.N <= 0 || scanner.Err() != nil || proof == nil {
		return nil, ErrOutput
	}
	return proof, nil
}

// Pinning copies verified executable bytes to Linux sealed memfd files; a
// rename OR in-place overwrite of the source cannot change an active invocation.
func pinned(path, want string) (*os.File, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&0111 == 0 || info.Size() == 0 || info.Size() > 512<<20 {
		return nil, errors.New("invalid executable")
	}
	b, err := io.ReadAll(io.LimitReader(f, 512<<20+1))
	if err != nil {
		return nil, err
	}
	if len(b) > 512<<20 || hash(b) != want {
		return nil, errors.New("executable hash mismatch")
	}
	binary, e := elf.NewFile(bytes.NewReader(b))
	if e != nil {
		return nil, errors.New("engine and launcher must be native ELF executables")
	}
	defer binary.Close()
	for _, p := range binary.Progs {
		if p.Type == elf.PT_INTERP {
			return nil, errors.New("dynamic executable dependencies are not pinned; static ELF required")
		}
	}
	return sealed(b)
}
