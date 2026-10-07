//go:build linux

package processrunner

import (
	"context"
	"errors"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"runtime"
	"syscall"
)

func supported() error {
	if runtime.GOARCH != "amd64" && runtime.GOARCH != "arm64" {
		return ErrUnsupported
	}
	return nil
}
func group(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true, Pdeathsig: syscall.SIGKILL}
}
func killGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
func sealed(ctx context.Context, b []byte) (*os.File, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	fd, err := unix.MemfdCreate("veydrift-pinned-executable", unix.MFD_CLOEXEC|unix.MFD_ALLOW_SEALING)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "pinned-executable")
	for len(b) > 0 {
		if err = ctx.Err(); err != nil {
			f.Close()
			return nil, err
		}
		n := min(len(b), 64<<10)
		if _, err = f.Write(b[:n]); err != nil {
			f.Close()
			return nil, err
		}
		b = b[n:]
	}
	if err = ctx.Err(); err != nil {
		f.Close()
		return nil, err
	}
	if _, err = unix.FcntlInt(f.Fd(), unix.F_ADD_SEALS, unix.F_SEAL_SEAL|unix.F_SEAL_SHRINK|unix.F_SEAL_GROW|unix.F_SEAL_WRITE); err != nil {
		f.Close()
		return nil, err
	}
	if _, err = f.Seek(0, 0); err != nil {
		f.Close()
		return nil, err
	}
	if err = ctx.Err(); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

// Waitid WNOWAIT keeps the leader PID reserved until every group signal and
// cancellation watcher finishes. cmd.Wait then reaps exactly once.
func waitProcess(_ context.Context, cmd *exec.Cmd, finished chan struct{}, watchDone chan struct{}) error {
	var info unix.Siginfo
	var err error
	for {
		err = unix.Waitid(unix.P_PID, cmd.Process.Pid, &info, unix.WEXITED|unix.WNOWAIT, nil)
		if !errors.Is(err, unix.EINTR) {
			break
		}
	}
	if err != nil {
		killGroup(cmd)
	}
	close(finished)
	<-watchDone
	killGroup(cmd)
	return errors.Join(err, cmd.Wait())
}
