package publisher

import "golang.org/x/sys/unix"

func noReplace(fd int, old, name string) error {
	return unix.RenameatxNp(fd, old, fd, name, unix.RENAME_EXCL)
}
