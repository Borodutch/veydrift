//go:build linux || darwin

package processrunner

import (
	"golang.org/x/sys/unix"
	"os"
)

// Do not stat a pathname then reopen it: the opened descriptor itself is the
// authority. O_NONBLOCK prevents a configured/replaced FIFO waiting for a peer;
// O_NOCTTY also avoids acquiring a terminal before fstat rejects special files.
func openExecutable(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_RDONLY|unix.O_NONBLOCK|unix.O_NOCTTY, 0)
}
