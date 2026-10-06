//go:build linux && (amd64 || arm64)

// limitexec is a pinned, static Linux trampoline, not a general shell launcher.
// fd4 must contain the sealed, hash-verified engine supplied by Supervisor.Run.
package main

import (
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"runtime"
	"strconv"
	"syscall"
	"unsafe"
)

func die(err error) { fmt.Fprintln(os.Stderr, "resource launcher:", err); os.Exit(125) }
func main() {
	runtime.LockOSThread()
	if len(os.Args) != 5 {
		die(fmt.Errorf("expected CPU count, address-space bytes, CPU seconds, file bytes"))
	}
	n, e := strconv.Atoi(os.Args[1])
	if e != nil || n < 1 || n > 1024 {
		die(fmt.Errorf("invalid CPUs"))
	}
	mem, e := strconv.ParseUint(os.Args[2], 10, 64)
	if e != nil || mem == 0 || mem > 1<<62 {
		die(fmt.Errorf("invalid memory"))
	}
	cpu, e := strconv.ParseUint(os.Args[3], 10, 64)
	if e != nil || cpu == 0 || cpu > uint64(n)*3600 {
		die(fmt.Errorf("invalid CPU time"))
	}
	files, e := strconv.ParseUint(os.Args[4], 10, 64)
	if e != nil || files == 0 || files > 256<<20 {
		die(fmt.Errorf("invalid file bound"))
	}
	// Engine cannot relax hard limits or fork new processes after seccomp below.
	for resource, limit := range map[int]uint64{unix.RLIMIT_AS: mem, unix.RLIMIT_CPU: cpu, unix.RLIMIT_CORE: 0, unix.RLIMIT_FSIZE: files, unix.RLIMIT_NOFILE: 64} {
		if e = unix.Setrlimit(resource, &unix.Rlimit{Cur: limit, Max: limit}); e != nil {
			die(e)
		}
	}
	var allowed, selected unix.CPUSet
	if e = unix.SchedGetaffinity(0, &allowed); e != nil {
		die(e)
	}
	count := 0
	for i := 0; i < 1024 && count < n; i++ {
		if allowed.IsSet(i) {
			selected.Set(i)
			count++
		}
	}
	if count != n {
		die(fmt.Errorf("CPU reservation exceeds available affinity"))
	}
	if e = unix.SchedSetaffinity(0, &selected); e != nil {
		die(e)
	}
	seals, e := unix.FcntlInt(4, unix.F_GET_SEALS, 0)
	if e != nil || seals&(unix.F_SEAL_SEAL|unix.F_SEAL_WRITE|unix.F_SEAL_GROW|unix.F_SEAL_SHRINK) != (unix.F_SEAL_SEAL|unix.F_SEAL_WRITE|unix.F_SEAL_GROW|unix.F_SEAL_SHRINK) {
		die(fmt.Errorf("engine is not sealed"))
	}
	// Close launcher FD. Engine FD closes atomically at exec. All hard limits
	// and seccomp restrictions survive any later exec by the trusted engine.
	_ = unix.Close(3)
	unix.CloseOnExec(4)
	if e = unix.Prctl(unix.PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0); e != nil {
		die(e)
	}
	path, _ := syscall.BytePtrFromString("")
	arg, _ := syscall.BytePtrFromString("veydrift-prover-engine")
	argv := []*byte{arg, nil}
	env := os.Environ()
	envp := make([]*byte, len(env)+1)
	for i, v := range env {
		envp[i], e = syscall.BytePtrFromString(v)
		if e != nil {
			die(e)
		}
	}
	filter := filters()
	prog := unix.SockFprog{Len: uint16(len(filter)), Filter: &filter[0]}
	if e = unix.Prctl(unix.PR_SET_SECCOMP, unix.SECCOMP_MODE_FILTER, uintptr(unsafe.Pointer(&prog)), 0, 0); e != nil {
		die(e)
	}
	_, _, errno := syscall.RawSyscall6(unix.SYS_EXECVEAT, 4, uintptr(unsafe.Pointer(path)), uintptr(unsafe.Pointer(&argv[0])), uintptr(unsafe.Pointer(&envp[0])), unix.AT_EMPTY_PATH, 0)
	die(errno)
}
func filters() []unix.SockFilter {
	const load = unix.BPF_LD | unix.BPF_W | unix.BPF_ABS
	const eq = unix.BPF_JMP | unix.BPF_JEQ | unix.BPF_K
	const ret = unix.BPF_RET | unix.BPF_K
	deny := uint32(unix.SECCOMP_RET_ERRNO | uint32(unix.EPERM))
	f := []unix.SockFilter{
		{Code: load, K: 4}, // seccomp_data.arch
		{Code: eq, K: auditArch, Jt: 1},
		{Code: ret, K: unix.SECCOMP_RET_KILL_PROCESS},
		{Code: load, K: 0}, // syscall number
	}
	// Reject x32 ABI too: alternate syscall numbers cannot bypass the denylist.
	if runtime.GOARCH == "amd64" {
		f = append(f, unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JSET | unix.BPF_K, K: 0x40000000, Jf: 1}, unix.SockFilter{Code: ret, K: unix.SECCOMP_RET_KILL_PROCESS})
	}
	for _, nr := range deniedSyscalls() {
		f = append(f, unix.SockFilter{Code: eq, K: uint32(nr), Jf: 1}, unix.SockFilter{Code: ret, K: deny})
	}
	// clone3 has pointer arguments which BPF cannot inspect. ENOSYS makes Go/glibc
	// fall back to clone, whose flags can be checked without dereferencing memory.
	f = append(f, unix.SockFilter{Code: eq, K: unix.SYS_CLONE3, Jf: 1}, unix.SockFilter{Code: ret, K: unix.SECCOMP_RET_ERRNO | uint32(unix.ENOSYS)})
	f = append(f,
		unix.SockFilter{Code: eq, K: unix.SYS_CLONE, Jf: 4},
		unix.SockFilter{Code: load, K: 16}, // flags lower word
		unix.SockFilter{Code: unix.BPF_JMP | unix.BPF_JSET | unix.BPF_K, K: unix.CLONE_THREAD, Jt: 1},
		unix.SockFilter{Code: ret, K: deny},
		unix.SockFilter{Code: ret, K: unix.SECCOMP_RET_ALLOW},
		unix.SockFilter{Code: eq, K: unix.SYS_EXECVEAT, Jf: 4},
		unix.SockFilter{Code: load, K: 16},
		unix.SockFilter{Code: eq, K: 4, Jt: 1},
		unix.SockFilter{Code: ret, K: deny},
		unix.SockFilter{Code: ret, K: unix.SECCOMP_RET_ALLOW},
		unix.SockFilter{Code: ret, K: unix.SECCOMP_RET_ALLOW},
	)
	return f
}
