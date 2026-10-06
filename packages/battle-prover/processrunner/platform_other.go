//go:build !linux

package processrunner

import (
	"context"
	"os"
	"os/exec"
)

func supported() error                { return ErrUnsupported }
func sealed([]byte) (*os.File, error) { return nil, ErrUnsupported }

// Non-Linux lifecycle tests exercise only individual child cancellation;
// New rejects non-Linux production execution without exception.
func group(cmd *exec.Cmd) {}
func killGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// macOS is lifecycle-test-only. os.Process.Kill handles exit races internally;
// actual process-group termination is proved by the Linux integration tests.
func waitProcess(_ context.Context, cmd *exec.Cmd, finished chan struct{}, watchDone chan struct{}) error {
	err := cmd.Wait()
	close(finished)
	<-watchDone
	return err
}
