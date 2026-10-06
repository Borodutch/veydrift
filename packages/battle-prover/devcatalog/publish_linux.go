package devcatalog

import "golang.org/x/sys/unix"

func publish(fd int, old, new string) error {
	return unix.Renameat2(fd, old, fd, new, unix.RENAME_NOREPLACE)
}
