// Package publisher verifies completed proofs before publishing independent authority.
// Supported filesystems must implement flock, no-replace rename and directory fsync.
package publisher

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"golang.org/x/sys/unix"
)

type directory struct{ file *os.File }

func validPath(s string) bool {
	return s != "." && filepath.IsLocal(s) && filepath.Clean(s) == s && !strings.ContainsRune(s, 92)
}
func digest(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && hex.EncodeToString(b) == s
}

// Walk from / through directory descriptors; NOFOLLOW applies to EVERY component.
// Roots must exist. Publisher never creates directories or changes their permissions.
func openDirectory(path string) (out *directory, err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("open directory %s: %w", path, err)
		}
	}()
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return nil, errors.New("canonical absolute non-root directory required")
	}
	fd, e := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return nil, err
		}
		fd = next
	}
	return &directory{os.NewFile(uintptr(fd), path)}, nil
}
func (d *directory) close() error { return d.file.Close() }
func (d *directory) parent(path string) (int, string, error) {
	if !validPath(path) {
		return -1, "", errors.New("unsafe relative path")
	}
	fd, e := unix.Dup(int(d.file.Fd()))
	if e != nil {
		return -1, "", e
	}
	parts := strings.Split(path, "/")
	for _, part := range parts[:len(parts)-1] {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return -1, "", err
		}
		fd = next
	}
	return fd, parts[len(parts)-1], nil
}
func regular(f *os.File) (unix.Stat_t, error) {
	var st unix.Stat_t
	if e := unix.Fstat(int(f.Fd()), &st); e != nil {
		return st, e
	}
	if st.Mode&unix.S_IFMT != unix.S_IFREG || st.Nlink != 1 {
		return st, errors.New("single-link regular file required")
	}
	return st, nil
}

// exact=0 means use bounded descriptor size, never an unbounded read or stat allocation.
func (d *directory) read(ctx context.Context, path string, cap, exact int64, hash string) (out []byte, err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("read %s: %w", path, err)
		}
	}()
	if cap < 1 || cap > 1<<30 || exact < 0 || exact > cap || (hash != "" && !digest(hash)) {
		return nil, errors.New("invalid read bounds/pin")
	}
	if e := ctx.Err(); e != nil {
		return nil, e
	}
	fd, name, e := d.parent(path)
	if e != nil {
		return nil, e
	}
	defer unix.Close(fd)
	raw, e := unix.Openat(fd, name, unix.O_RDONLY|unix.O_NONBLOCK|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NOCTTY, 0)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(raw), name)
	defer f.Close()
	st, e := regular(f)
	if e != nil {
		return nil, e
	}
	if st.Size < 1 || st.Size > cap || (exact > 0 && st.Size != exact) {
		return nil, errors.New("file size outside exact bounded contract")
	}
	b := make([]byte, int(st.Size))
	if _, e = io.ReadFull(f, b); e != nil {
		return nil, e
	}
	var extra [1]byte
	n, e := f.Read(extra[:])
	if n != 0 || e != io.EOF {
		return nil, errors.New("file changed length")
	}
	after, e := regular(f)
	if e != nil {
		return nil, e
	}
	if after.Size != st.Size || after.Mtim != st.Mtim || after.Ctim != st.Ctim {
		return nil, errors.New("file changed during read")
	}
	if hash != "" && service.Hash(b) != hash {
		return nil, errors.New("file SHA256 mismatch")
	}
	return b, ctx.Err()
}
func canonical(b []byte, out any) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	if e := dec.Decode(out); e != nil {
		return e
	}
	want, e := json.Marshal(out)
	if e != nil {
		return e
	}
	if !bytes.Equal(b, want) {
		return errors.New("canonical json.Marshal bytes required")
	}
	return nil
}
func (d *directory) lock(ctx context.Context) (out *os.File, err error) {
	defer func() {
		if err != nil {
			err = fmt.Errorf("publisher lock: %w", err)
		}
	}()
	// Separate creation from opening an existing stable inode. Concurrent
	// nonexclusive O_CREAT opens returned ENOENT on the supported Darwin host.
	// O_EXCL gives one creator; losers reopen WITHOUT creation or replacement.
	flags := unix.O_RDWR | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC
	fd, e := unix.Openat(int(d.file.Fd()), ".publisher.lock", flags|unix.O_CREAT|unix.O_EXCL, 0600)
	if errors.Is(e, unix.EEXIST) {
		fd, e = unix.Openat(int(d.file.Fd()), ".publisher.lock", flags, 0)
	}
	if e != nil {
		return nil, fmt.Errorf("openat: %w", e)
	}
	f := os.NewFile(uintptr(fd), ".publisher.lock")
	if _, e = regular(f); e != nil {
		f.Close()
		return nil, e
	}
	for {
		if e = ctx.Err(); e != nil {
			f.Close()
			return nil, e
		}
		e = unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB)
		if e == nil {
			return f, nil
		}
		if !errors.Is(e, unix.EWOULDBLOCK) && !errors.Is(e, unix.EINTR) {
			f.Close()
			return nil, fmt.Errorf("flock: %w", e)
		}
		select {
		case <-ctx.Done():
			f.Close()
			return nil, ctx.Err()
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// fault is package-private and per invocation; tests never replace verification.
type faultHook func(stage string) error

func fault(h faultHook, stage string) error {
	if h != nil {
		return h(stage)
	}
	return nil
}
func (d *directory) publish(ctx context.Context, name string, b []byte, cap int, kind string, hook faultHook) error {
	if filepath.Base(name) != name || !validPath(name) || cap < 1 || len(b) == 0 || len(b) > cap {
		return errors.New("invalid publication bounds/name")
	}
	if e := ctx.Err(); e != nil {
		return e
	}
	var nonce [24]byte
	if _, e := rand.Read(nonce[:]); e != nil {
		return e
	}
	tmp := ".publisher-" + hex.EncodeToString(nonce[:])
	fd := int(d.file.Fd())
	raw, e := unix.Openat(fd, tmp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if e != nil {
		return e
	}
	f := os.NewFile(uintptr(raw), tmp)
	// Failed temporary siblings deliberately remain: no unsafe automatic GC.
	defer f.Close()
	if e = fault(hook, kind+".write"); e != nil {
		return e
	}
	for left := b; len(left) > 0; {
		if e = ctx.Err(); e != nil {
			return e
		}
		n, err := f.Write(left)
		if err != nil {
			return err
		}
		if n == 0 {
			return io.ErrShortWrite
		}
		left = left[n:]
	}
	if e = f.Chmod(0444); e != nil {
		return e
	}
	if e = fault(hook, kind+".sync"); e != nil {
		return e
	}
	if e = f.Sync(); e != nil {
		return e
	}
	if e = f.Close(); e != nil {
		return e
	}
	if e = fault(hook, kind+".rename"); e != nil {
		return e
	}
	if e = ctx.Err(); e != nil {
		return e
	}
	if e = noReplace(fd, tmp, name); e != nil {
		return e
	}
	if e = fault(hook, kind+".dirsync"); e != nil {
		return e
	}
	return d.file.Sync()
}
