//go:build linux || darwin

package processrunner

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// Regression for review79f48d04: even opening an executable must not wait for
// a FIFO peer before descriptor-type validation or context observation.
func TestPinFIFODeadlineAndCancellation(t *testing.T) {
	for _, replaced := range []bool{false, true} {
		for _, cancelled := range []bool{false, true} {
			name := "configured/deadline"
			if replaced {
				name = "replaced/deadline"
			}
			if cancelled {
				name += "/cancel"
			}
			t.Run(name, func(t *testing.T) {
				path := filepath.Join(t.TempDir(), "engine")
				fifo := path
				if replaced {
					if err := os.WriteFile(path, []byte("previous regular executable"), 0700); err != nil {
						t.Fatal(err)
					}
					fifo = path + ".fifo"
				}
				if err := unix.Mkfifo(fifo, 0700); err != nil {
					t.Fatal(err)
				}
				if replaced {
					if err := os.Rename(fifo, path); err != nil {
						t.Fatal(err)
					}
				}
				c := config()
				c.EnginePath = path
				c.WallLimit = 20 * time.Millisecond
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				if cancelled {
					c.WallLimit = time.Minute
					timer := time.AfterFunc(20*time.Millisecond, cancel)
					defer timer.Stop()
				}
				s := &Supervisor{cfg: c}
				done := make(chan error, 1)
				go func() {
					_, err := s.Run(ctx, Request{Identity: request().Identity, RulesSHA256: c.Manifest.RulesSHA256, VerifierSHA256: c.Manifest.VerifierSHA256, Input: []byte("public input")}, nil)
					done <- err
				}()
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("FIFO accepted as executable")
					}
				case <-time.After(200 * time.Millisecond):
					// Release the old blocking open so the baseline regression leaves no
					// goroutine behind, even when the implementation is broken.
					fd, err := unix.Open(path, unix.O_RDWR|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
					if err != nil {
						t.Fatal(err)
					}
					select {
					case <-done:
					case <-time.After(time.Second):
						t.Error("FIFO reader did not exit after release")
					}
					unix.Close(fd)
					t.Error("executable FIFO pinning exceeded cancellation/deadline by 200ms")
				}
			})
		}
	}
}

type cancellingPinReader struct {
	cancel context.CancelFunc
	calls  int
	chunk  int
}

func (r *cancellingPinReader) Read(p []byte) (int, error) {
	r.calls++
	r.chunk = len(p)
	r.cancel()
	return len(p), nil
}
func TestPinningContextObservation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := pinned(ctx, filepath.Join(t.TempDir(), "absent"), hash(nil)); !errors.Is(err, context.Canceled) {
		t.Fatalf("pre-canceled pin performed file IO: %v", err)
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	source := &cancellingPinReader{cancel: cancel}
	h := sha256.New()
	if _, err := io.ReadAll(pinReader{ctx, io.TeeReader(source, h)}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if source.calls != 1 || source.chunk > 64<<10 {
		t.Fatal("read/hash cancellation not chunk-bounded", source.calls, source.chunk)
	}
	ctx, cancel = context.WithCancel(context.Background())
	defer cancel()
	source = &cancellingPinReader{cancel: cancel}
	if _, err := (pinReader{ctx, source}).Read(make([]byte, 1<<20)); !errors.Is(err, context.Canceled) || source.chunk != 64<<10 {
		t.Fatal("oversized read/hash chunk", source.chunk, err)
	}
	if _, err := sealed(ctx, []byte("unused")); !errors.Is(err, context.Canceled) {
		t.Fatal("canceled sealing attempted", err)
	}
}
func TestOpenedExecutableDoesNotFollowReplacement(t *testing.T) {
	path := filepath.Join(t.TempDir(), "engine")
	original := []byte("original inode")
	if err := os.WriteFile(path, original, 0700); err != nil {
		t.Fatal(err)
	}
	f, err := openExecutable(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	fifo := path + ".fifo"
	if err = unix.Mkfifo(fifo, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.Rename(fifo, path); err != nil {
		t.Fatal(err)
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		t.Fatal("descriptor changed", err)
	}
	b, err := io.ReadAll(f)
	if err != nil || !bytes.Equal(b, original) {
		t.Fatal("path was reopened after descriptor validation", err)
	}
}
