// Package devcatalog is development-only setup tooling. Runtime must never import it.
package devcatalog

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"golang.org/x/sys/unix"
)

const Namespace = "/Users/borodutch/.openclaw/workspace/artifacts/ticket44/dev-catalog-20261006-v2"
const MaxArtifact int64 = 8 << 30
const MaxBudget int64 = 100 << 30
const FreeFloor int64 = 100 << 30
const MaxMetadata int64 = 16 << 20

// Three maximum artifacts plus bounded metadata; renaming publishes without copying.
const StageReserve int64 = 3*MaxArtifact + MaxMetadata

func digest(b []byte) string { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }
func validHash(s string) bool {
	b, e := hex.DecodeString(s)
	return e == nil && len(b) == 32 && strings.ToLower(s) == s
}
func canonical(v any) ([]byte, error) { return json.Marshal(v) }
func decode(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	c, e := canonical(v)
	if e != nil || !bytes.Equal(b, c) {
		return errors.New("noncanonical JSON (including extra/duplicate/missing fields)")
	}
	return nil
}

// openDir traverses every absolute component using openat/O_NOFOLLOW. No path
// supplied by metadata can escape or follow even an in-root symlink.
func openDir(path string, create bool) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path {
		return nil, errors.New("unclean absolute directory")
	}
	fd, e := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if e != nil {
		return nil, e
	}
	for _, p := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		if create {
			e = unix.Mkdirat(fd, p, 0700)
			if e != nil && e != unix.EEXIST {
				unix.Close(fd)
				return nil, e
			}
		}
		next, err := unix.Openat(fd, p, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return nil, err
		}
		fd = next
	}
	return os.NewFile(uintptr(fd), path), nil
}
func openAt(dir *os.File, name string, flags int) (*os.File, error) {
	if name == "" || name == "." || name == ".." || (strings.ContainsRune(name, 47) || strings.ContainsRune(name, 92)) {
		return nil, errors.New("expected single path component")
	}
	fd, e := unix.Openat(int(dir.Fd()), name, flags|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0600)
	if e != nil {
		return nil, e
	}
	f := os.NewFile(uintptr(fd), name)
	s, e := f.Stat()
	if e != nil || !s.Mode().IsRegular() {
		f.Close()
		return nil, errors.New("not a regular file")
	}
	return f, nil
}
func readSmall(dir *os.File, name string) ([]byte, error) {
	f, e := openAt(dir, name, unix.O_RDONLY)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, MaxMetadata+1))
	if int64(len(b)) > MaxMetadata {
		return nil, errors.New("metadata exceeds bound")
	}
	return b, e
}
func hashFile(f *os.File, max int64) (string, int64, error) {
	s, e := f.Stat()
	if e != nil {
		return "", 0, e
	}
	if !s.Mode().IsRegular() || s.Size() < 1 || s.Size() > max {
		return "", 0, errors.New("file size/type outside bound")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return "", 0, e
	}
	h := sha256.New()
	n, e := io.CopyBuffer(h, io.LimitReader(f, max+1), make([]byte, 128<<10))
	if e != nil {
		return "", n, e
	}
	if n != s.Size() {
		return "", n, errors.New("file changed while hashing")
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

type cappedWriter struct {
	w            io.Writer
	remaining, n int64
}

func (w *cappedWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > w.remaining {
		return 0, errors.New("artifact write exceeds cap")
	}
	n, e := w.w.Write(p)
	w.remaining -= int64(n)
	w.n += int64(n)
	return n, e
}
func writeArtifact(dir *os.File, name string, src io.WriterTo, limit int64) (rt.Artifact, error) {
	var a rt.Artifact
	f, e := openAt(dir, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL)
	if e != nil {
		return a, e
	}
	defer f.Close()
	h := sha256.New()
	w := &cappedWriter{w: io.MultiWriter(f, h), remaining: limit}
	n, e := src.WriteTo(w)
	if e != nil {
		return a, e
	}
	if n != w.n || n < 1 {
		return a, errors.New("serializer byte count mismatch")
	}
	if e = f.Sync(); e != nil {
		return a, e
	}
	if e = f.Chmod(0400); e != nil {
		return a, e
	}
	return rt.Artifact{Path: name, SHA256: hex.EncodeToString(h.Sum(nil)), Bytes: n}, nil
}
func writeJSON(dir *os.File, name string, v any) error {
	b, e := canonical(v)
	if e != nil {
		return e
	}
	_, e = writeArtifact(dir, name, bytes.NewReader(b), MaxMetadata)
	return e
}

func budgetCheck(used, budget, free, reserve int64) error {
	if budget < 1 || budget > MaxBudget || used < 0 || reserve < 0 || reserve > budget-used {
		return errors.New("insufficient namespace budget including transient reservation")
	}
	if free < FreeFloor || reserve > free-FreeFloor {
		return errors.New("free disk floor would be crossed by reservation")
	}
	return nil
}
func diskUsage(dir *os.File) (int64, error) {
	// Descriptor-relative traversal refuses symlinks and special files, including
	// abandoned staging files. All transient bytes count; nothing auto-deletes.
	entries, e := dir.ReadDir(-1)
	if e != nil {
		return 0, e
	}
	var total int64
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() {
			fd, err := unix.Openat(int(dir.Fd()), name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
			if err != nil {
				return 0, err
			}
			d := os.NewFile(uintptr(fd), name)
			n, err := diskUsage(d)
			d.Close()
			if err != nil {
				return 0, err
			}
			total += n
		} else {
			f, err := openAt(dir, name, unix.O_RDONLY)
			if err != nil {
				return 0, err
			}
			s, err := f.Stat()
			f.Close()
			if err != nil {
				return 0, err
			}
			total += s.Size()
		}
		if total > MaxBudget {
			return 0, errors.New("namespace exceeds budget")
		}
	}
	_, e = dir.Seek(0, 0)
	return total, e
}
func reserve(dir *os.File, budget int64) (int64, int64, error) {
	used, e := diskUsage(dir)
	if e != nil {
		return 0, 0, e
	}
	var st unix.Statfs_t
	if e = unix.Fstatfs(int(dir.Fd()), &st); e != nil {
		return 0, 0, e
	}
	free := int64(st.Bavail) * int64(st.Bsize)
	return used, free, budgetCheck(used, budget, free, StageReserve)
}
func stageName(i int) string { return fmt.Sprintf("stage-%04d", i) }
