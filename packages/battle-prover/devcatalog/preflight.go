package devcatalog

import (
	"errors"
	"os"
	"path/filepath"

	"golang.org/x/sys/unix"
)

type PreflightReport struct {
	Plan                      Plan
	NamespaceExists           bool
	UsedBytes, AvailableBytes int64
	ReservationFits           bool
	Blocker                   string
}

// Preflight performs no writes, compile or Setup. If namespace does not yet
// exist, available space is checked on the nearest existing ancestor.
func Preflight(c Config) (PreflightReport, error) {
	p, e := MakePlan(c)
	if e != nil {
		return PreflightReport{}, e
	}
	report := PreflightReport{Plan: p}
	path := Namespace
	var root *os.File
	for {
		root, e = openDir(path, false)
		if e == nil {
			break
		}
		if !errors.Is(e, os.ErrNotExist) {
			return report, e
		}
		next := filepath.Dir(path)
		if next == path {
			return report, e
		}
		path = next
	}
	defer root.Close()
	report.NamespaceExists = path == Namespace
	if report.NamespaceExists {
		report.UsedBytes, e = diskUsage(root)
		if e != nil {
			return report, e
		}
	}
	var st unix.Statfs_t
	if e = unix.Fstatfs(int(root.Fd()), &st); e != nil {
		return report, e
	}
	report.AvailableBytes = int64(st.Bavail) * int64(st.Bsize)
	e = budgetCheck(report.UsedBytes, c.BudgetBytes, report.AvailableBytes, StageReserve)
	report.ReservationFits = e == nil
	if e != nil {
		report.Blocker = e.Error()
	}
	return report, nil
}
