package service

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
)

// GC is explicit maintenance. It refuses to run while ANY job is queued or
// running, then locks all retained jobs (stable sorted List order) and admission.
// No proof computation is stopped, nor is this lock part of the worker path.
// Terminal pruning plus GC removes unreferenced blobs and crash temp files.
func (s *Store) GC() error {
	return s.lock("admission", func() error {
		jobs, err := s.List()
		if err != nil {
			return err
		}
		held := []*os.File{}
		defer func() {
			for _, f := range held {
				_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
				_ = f.Close()
			}
		}()
		for _, j := range jobs {
			f, e := os.OpenFile(filepath.Join(s.root, "locks", j.Identity.Key()+".lock"), os.O_CREATE|os.O_RDWR, 0600)
			if e != nil {
				return e
			}
			if e = syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); e != nil {
				f.Close()
				return ErrBusy
			}
			held = append(held, f)
		}
		jobs, err = s.List()
		if err != nil {
			return err
		}
		refs := map[string]bool{}
		for _, j := range jobs {
			if j.State == Queued || j.State == Running {
				return ErrBusy
			}
			refs[j.Identity.InputHash] = true
			refs[j.Checkpoint] = true
			refs[j.Proof] = true
		}
		return s.lock("blob-budget", func() error {
			es, e := os.ReadDir(filepath.Join(s.root, "blobs"))
			if e != nil {
				return e
			}
			for _, f := range es {
				if f.IsDir() {
					return errors.New("unexpected artifact directory")
				}
				if !refs[f.Name()] {
					if e = os.Remove(filepath.Join(s.root, "blobs", f.Name())); e != nil {
						return e
					}
				}
			}
			return syncDir(filepath.Join(s.root, "blobs"))
		})
	})
}
