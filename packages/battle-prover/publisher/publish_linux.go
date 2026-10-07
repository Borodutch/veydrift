package publisher

import "golang.org/x/sys/unix"

func noReplace(fd int, old, name string) error {
	return unix.Renameat2(fd, old, fd, name, unix.RENAME_NOREPLACE)
}
