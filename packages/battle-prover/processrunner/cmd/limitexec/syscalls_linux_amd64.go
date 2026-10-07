//go:build linux && amd64

package main

import "golang.org/x/sys/unix"

const auditArch = unix.AUDIT_ARCH_X86_64

func deniedSyscalls() []int {
	return []int{unix.SYS_FORK, unix.SYS_VFORK, unix.SYS_EXECVE, unix.SYS_SETSID, unix.SYS_SETPGID, unix.SYS_UNSHARE, unix.SYS_SETNS, unix.SYS_SETRLIMIT, unix.SYS_PRLIMIT64, unix.SYS_SCHED_SETAFFINITY}
}
