// Package service provides durable orchestration, not a prover or transaction signer.
// Local POSIX filesystems only: flock, atomic rename and directory fsync are required.
package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"path/filepath"
	"regexp"
	"syscall"
	"time"
)

var (
	ErrBusy         = errors.New("lease or capacity busy")
	ErrStale        = errors.New("expired or fenced lease")
	ErrBackpressure = errors.New("queue capacity exhausted")
)
var digestRE = regexp.MustCompile("^[0-9a-f]{64}$")
var addressRE = regexp.MustCompile("^0x[0-9a-f]{40}$")
var uintRE = regexp.MustCompile("^(0|[1-9][0-9]*)$")

// Identity never truncates chain/battle identifiers. Hashes are lowercase SHA-256
// digests except Rules and Verifier, which identify pinned protocol/key manifests.
type Identity struct {
	ChainID   string
	Game      string
	BattleID  string
	InputHash string
	Rules     string
	Verifier  string
}

func (i Identity) Validate() error {
	for _, s := range []string{i.ChainID, i.BattleID} {
		n, ok := new(big.Int).SetString(s, 10)
		if !uintRE.MatchString(s) || !ok || n.Sign() <= 0 || n.BitLen() > 256 {
			return errors.New("noncanonical uint256 identifier")
		}
	}
	if !addressRE.MatchString(i.Game) || i.Game == "0x0000000000000000000000000000000000000000" {
		return errors.New("noncanonical game address")
	}
	for _, s := range []string{i.InputHash, i.Rules, i.Verifier} {
		if !digestRE.MatchString(s) {
			return errors.New("noncanonical digest")
		}
	}
	return nil
}
func (i Identity) Key() string { b, _ := json.Marshal(i); return Hash(b) }
func Hash(b []byte) string     { h := sha256.Sum256(b); return hex.EncodeToString(h[:]) }

type Anchor struct {
	Number uint64
	Hash   string
}

func (a Anchor) validate() error {
	if !digestRE.MatchString(a.Hash) {
		return errors.New("invalid block hash")
	}
	return nil
}

// Snapshot bytes must be the authoritative canonical serialization. InputHash
// hashes these exact bytes. The source adapter must enforce on-chain commitment,
// finality, rules and verifier allowlists; an event is only a discovery hint.
type Snapshot struct {
	Identity Identity
	Anchor   Anchor
	Input    []byte
}

func (s Snapshot) validate(max int) error {
	if err := s.Identity.Validate(); err != nil {
		return err
	}
	if err := s.Anchor.validate(); err != nil {
		return err
	}
	if len(s.Input) == 0 || len(s.Input) > max || Hash(s.Input) != s.Identity.InputHash {
		return errors.New("invalid canonical snapshot bytes")
	}
	return nil
}

type Config struct {
	MaxJobs          int
	MaxInputBytes    int
	MaxArtifactBytes int
	MaxBlobBytes     int64
	Workers          int
	CPUs             int
	MemoryBytes      int64
	JobCPUs          int
	JobMemoryBytes   int64
	Lease            time.Duration
	StuckAfter       time.Duration
	LagAfter         time.Duration
}

func (c Config) validate() error {
	if c.MaxJobs < 1 || c.MaxInputBytes < 1 || c.MaxArtifactBytes < 1 || c.MaxBlobBytes < int64(c.MaxArtifactBytes) || c.MaxBlobBytes < int64(c.MaxInputBytes) || c.Workers < 1 || c.CPUs < 1 || c.MemoryBytes < 1 || c.JobCPUs < 1 || c.JobMemoryBytes < 1 || c.Lease < 3*time.Millisecond || c.StuckAfter <= 0 || c.LagAfter <= 0 {
		return errors.New("all queue limits must be positive")
	}
	if c.JobCPUs > c.CPUs || c.JobMemoryBytes > c.MemoryBytes {
		return errors.New("job cannot fit resource budget")
	}
	return nil
}

type State string

const (
	Queued   State = "queued"
	Running  State = "running"
	Complete State = "complete"
	Failed   State = "failed"
	Invalid  State = "invalid"
)

type Job struct {
	// Generation changes on admission and reanchor, including identical-anchor ABA.
	Generation string
	Identity   Identity
	Anchor     Anchor
	State      State
	Token      string
	Slot       int
	Expires    time.Time
	Created    time.Time
	Updated    time.Time
	Attempts   uint64
	Checkpoint string
	Proof      string
	Failure    string
}
type Lease struct {
	Key   string
	Token string
	Slot  int
}
type slot struct {
	Key     string
	Token   string
	Expires time.Time
}
type Store struct {
	root string
	cfg  Config
}

func Open(root string, cfg Config) (*Store, error) {
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	for _, dir := range []string{"jobs", "blobs", "locks", "slots"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0700); err != nil {
			return nil, err
		}
	}
	s := &Store{root: root, cfg: cfg}
	// Every process sharing this directory must use identical resource limits.
	err := s.lock("config", func() error {
		p := filepath.Join(root, "config.json")
		var existing Config
		err := readJSON(p, &existing)
		if errors.Is(err, os.ErrNotExist) {
			return atomicJSON(p, cfg)
		}
		if err != nil {
			return err
		}
		if existing != cfg {
			return errors.New("shared store configuration mismatch")
		}
		return nil
	})
	return s, err
}
func (s *Store) lock(name string, fn func() error) error {
	if name == "" || filepath.Base(name) != name || name == "." || name == ".." {
		return errors.New("invalid lock name")
	}
	f, err := os.OpenFile(filepath.Join(s.root, "locks", name+".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return fn()
}
func readJSON(path string, out any) error {
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
func atomicJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return atomicBytes(path, b)
}
func syncDir(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return f.Sync()
}
func atomicBytes(path string, b []byte) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".tmp-")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(tmp, path); err != nil {
		return err
	}
	return syncDir(filepath.Dir(path))
}
func (s *Store) jobPath(k string) string { return filepath.Join(s.root, "jobs", k+".json") }
func (s *Store) get(k string) (Job, error) {
	var j Job
	if !digestRE.MatchString(k) {
		return j, errors.New("invalid job key")
	}
	err := readJSON(s.jobPath(k), &j)
	if err == nil && (j.Identity.Validate() != nil || j.Identity.Key() != k || !digestRE.MatchString(j.Generation)) {
		err = errors.New("corrupt job identity")
	}
	return j, err
}
func (s *Store) Get(k string) (Job, error) { return s.get(k) }
func (s *Store) put(j Job) error           { return atomicJSON(s.jobPath(j.Identity.Key()), j) }

// Artifact accounting serializes only blob I/O, never proof computation.
// Hard retained-byte cap also bounds orphan accumulation after crashes.
func (s *Store) blob(b []byte) (string, error) {
	h := Hash(b)
	err := s.lock("blob-budget", func() error {
		p := filepath.Join(s.root, "blobs", h)
		old, e := os.ReadFile(p)
		if e == nil {
			if Hash(old) != h {
				return errors.New("corrupt cached artifact")
			}
			return nil
		}
		if !errors.Is(e, os.ErrNotExist) {
			return e
		}
		es, e := os.ReadDir(filepath.Join(s.root, "blobs"))
		if e != nil {
			return e
		}
		var total int64
		for _, f := range es {
			i, e := f.Info()
			if e != nil {
				return e
			}
			total += i.Size()
		}
		if total+int64(len(b)) > s.cfg.MaxBlobBytes {
			return ErrBackpressure
		}
		return atomicBytes(p, b)
	})
	return h, err
}
func (s *Store) Blob(h string) ([]byte, error) {
	if !digestRE.MatchString(h) {
		return nil, errors.New("invalid artifact hash")
	}
	b, err := os.ReadFile(filepath.Join(s.root, "blobs", h))
	if err != nil {
		return nil, err
	}
	if Hash(b) != h {
		return nil, errors.New("corrupt artifact")
	}
	return b, nil
}
func (s *Store) List() ([]Job, error) {
	es, err := os.ReadDir(filepath.Join(s.root, "jobs"))
	if err != nil {
		return nil, err
	}
	out := []Job{}
	for _, e := range es {
		if filepath.Ext(e.Name()) != ".json" {
			continue
		}
		j, err := s.get(e.Name()[:len(e.Name())-5])
		if err != nil {
			return nil, err
		}
		out = append(out, j)
	}
	return out, nil
}

// admission lock protects only short admission transactions, never proving or
// unrelated job transitions. MaxJobs bounds total retained records, not only
// queued records: callers prune terminal jobs explicitly before admitting more.
func (s *Store) admit(snap Snapshot) (string, error) {
	if err := snap.validate(s.cfg.MaxInputBytes); err != nil {
		return "", err
	}
	k := snap.Identity.Key()
	err := s.lock("admission", func() error {
		return s.lock(k, func() error {
			j, err := s.get(k)
			if err == nil {
				if j.Anchor != snap.Anchor {
					return errors.New("same identity on different anchor: reconcile first")
				}
				return nil
			}
			if !errors.Is(err, os.ErrNotExist) {
				return err
			}
			jobs, err := s.List()
			if err != nil {
				return err
			}
			if len(jobs) >= s.cfg.MaxJobs {
				return ErrBackpressure
			}
			if _, err = s.blob(snap.Input); err != nil {
				return err
			}
			generation, err := token()
			if err != nil {
				return err
			}
			now := time.Now()
			return s.put(Job{Generation: generation, Identity: snap.Identity, Anchor: snap.Anchor, State: Queued, Slot: -1, Created: now, Updated: now})
		})
	})
	return k, err
}
func token() (string, error) {
	b := make([]byte, 32)
	_, err := io.ReadFull(rand.Reader, b)
	return hex.EncodeToString(b), err
}
func (s *Store) slots() int {
	n := s.cfg.Workers
	if m := s.cfg.CPUs / s.cfg.JobCPUs; m < n {
		n = m
	}
	if m := s.cfg.MemoryBytes / s.cfg.JobMemoryBytes; m < int64(n) {
		n = int(m)
	}
	return n
}
func (s *Store) slotPath(n int) string { return filepath.Join(s.root, "slots", fmt.Sprint(n)+".json") }

// holdExecution is an OS-held per-slot lock for the actual runner lifetime.
// Lease expiry never permits overlapping CPU/RAM use by a paused old runner.
// Process death releases it automatically, unlike PID files.
func (s *Store) holdExecution(n int) (*os.File, error) {
	return s.holdExecutionLock(fmt.Sprintf("execution-%d", n))
}

// The identity-level lock survives reanchor/prune/recreate and prevents a live
// runner moving to another slot after expiry. Never unlink this lock file.
func (s *Store) holdJobExecution(k string) (*os.File, error) {
	if !digestRE.MatchString(k) {
		return nil, errors.New("invalid job key")
	}
	return s.holdExecutionLock("job-execution-" + k)
}
func (s *Store) holdExecutionLock(name string) (*os.File, error) {
	f, err := os.OpenFile(filepath.Join(s.root, "locks", name+".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrBusy
		}
		return nil, err
	}
	return f, nil
}
func releaseExecution(f *os.File) { _ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN); _ = f.Close() }
func (s *Store) Claim(k string) (Lease, error) {
	execution, err := s.holdJobExecution(k)
	if err != nil {
		return Lease{}, err
	}
	defer releaseExecution(execution)
	return s.claim(k)
}

// Caller holds job execution exclusion before taking job/slot transition locks.
func (s *Store) claim(k string) (Lease, error) {
	var l Lease
	err := s.lock(k, func() error {
		j, err := s.get(k)
		if err != nil {
			return err
		}
		now := time.Now()
		if j.State != Queued && !(j.State == Running && !now.Before(j.Expires)) {
			return ErrBusy
		}
		for n := 0; n < s.slots(); n++ {
			err = s.lock(fmt.Sprintf("slot-%d", n), func() error {
				execution, e := s.holdExecution(n)
				if e != nil {
					return e
				}
				defer releaseExecution(execution)
				now = time.Now()
				var sl slot
				err := readJSON(s.slotPath(n), &sl)
				if err != nil && !errors.Is(err, os.ErrNotExist) {
					return err
				}
				if now.Before(sl.Expires) {
					return ErrBusy
				}
				t, err := token()
				if err != nil {
					return err
				}
				expires := now.Add(s.cfg.Lease)
				// Slot first: crash between writes leaks capacity only until lease expiry.
				if err = atomicJSON(s.slotPath(n), slot{k, t, expires}); err != nil {
					return err
				}
				j.State = Running
				j.Token = t
				j.Slot = n
				j.Expires = expires
				j.Updated = now
				j.Attempts++
				j.Failure = ""
				if err = s.put(j); err != nil {
					return err
				}
				l = Lease{k, t, n}
				return nil
			})
			if err == nil {
				return nil
			}
			if !errors.Is(err, ErrBusy) {
				return err
			}
		}
		return ErrBusy
	})
	return l, err
}
func (s *Store) withLease(l Lease, fn func(*Job, *slot) error) error {
	if !digestRE.MatchString(l.Key) || l.Slot < 0 || l.Slot >= s.slots() {
		return ErrStale
	}
	return s.lock(l.Key, func() error {
		return s.lock(fmt.Sprintf("slot-%d", l.Slot), func() error {
			j, err := s.get(l.Key)
			if err != nil {
				return err
			}
			var sl slot
			if err = readJSON(s.slotPath(l.Slot), &sl); err != nil {
				return err
			}
			now := time.Now()
			if j.State != Running || j.Token != l.Token || j.Slot != l.Slot || sl.Token != l.Token || sl.Key != l.Key || !now.Before(j.Expires) || !now.Before(sl.Expires) {
				return ErrStale
			}
			return fn(&j, &sl)
		})
	})
}
func (s *Store) Renew(l Lease) error {
	return s.withLease(l, func(j *Job, sl *slot) error {
		j.Expires = time.Now().Add(s.cfg.Lease)
		sl.Expires = j.Expires
		if err := atomicJSON(s.slotPath(l.Slot), sl); err != nil {
			return err
		}
		return s.put(*j)
	})
}

// Checkpoints are opaque runner state, NOT proofs. A resumed runner must validate
// their binding and cryptographic contents before use. No partial proof is READY.
func (s *Store) Checkpoint(l Lease, b []byte) error {
	if len(b) == 0 || len(b) > s.cfg.MaxArtifactBytes {
		return errors.New("invalid checkpoint size")
	}
	return s.withLease(l, func(j *Job, _ *slot) error {
		h, err := s.blob(b)
		if err != nil {
			return err
		}
		j.Checkpoint = h
		j.Updated = time.Now()
		return s.put(*j)
	})
}
func (s *Store) finish(l Lease, state State, proof string, reason string) error {
	return s.withLease(l, func(j *Job, sl *slot) error {
		j.State = state
		j.Proof = proof
		j.Failure = reason
		j.Token = ""
		j.Expires = time.Time{}
		j.Updated = time.Now()
		if err := s.put(*j); err != nil {
			return err
		}
		return atomicJSON(s.slotPath(l.Slot), slot{})
	})
}

// Retry is explicit: failures/timeouts never masquerade as successful proofs.
func (s *Store) Retry(k string) error {
	return s.lock(k, func() error {
		j, err := s.get(k)
		if err != nil {
			return err
		}
		if j.State != Failed {
			return errors.New("only failed jobs can retry")
		}
		j.State = Queued
		j.Updated = time.Now()
		return s.put(j)
	})
}

// Invalidation fences even a live worker. Content-addressed bytes are never
// silently rebound to a different input/rules/verifier identity.
func (s *Store) invalidate(observed Job, reason string) error {
	k := observed.Identity.Key()
	return s.lock(k, func() error {
		j, err := s.get(k)
		if err != nil {
			return err
		}
		if j.Generation != observed.Generation || j.Anchor != observed.Anchor {
			return ErrStale
		}
		j.State = Invalid
		j.Token = ""
		j.Proof = ""
		j.Checkpoint = ""
		j.Failure = reason
		j.Updated = time.Now()
		return s.put(j)
	})
}

// Prune removes a terminal record, not blobs. Never unlink lock files (inode ABA).
func (s *Store) Prune(k string) error {
	return s.lock("admission", func() error {
		return s.lock(k, func() error {
			j, err := s.get(k)
			if err != nil {
				return err
			}
			if j.State == Running || j.State == Queued {
				return ErrBusy
			}
			if err = os.Remove(s.jobPath(k)); err != nil {
				return err
			}
			return syncDir(filepath.Join(s.root, "jobs"))
		})
	})
}
