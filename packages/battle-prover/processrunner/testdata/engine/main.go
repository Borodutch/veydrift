// This is an adversarial process/limit fixture, NOT a proof engine.
package main

import (
	"encoding/json"
	"fmt"
	"golang.org/x/sys/unix"
	"os"
	"os/exec"
	"strings"
	"time"
)

type request struct {
	Protocol, Identity, Attempt, ManifestSHA256 string
	Input, Checkpoint                           []byte
}
type message struct {
	Type, Identity, Attempt string
	Data                    []byte
}

func main() {
	var r request
	if e := json.NewDecoder(os.Stdin).Decode(&r); e != nil {
		os.Exit(90)
	}
	send := func(typ string, b []byte) {
		if e := json.NewEncoder(os.Stdout).Encode(message{typ, r.Identity, r.Attempt, b}); e != nil {
			os.Exit(91)
		}
	}
	switch string(r.Input) {
	case "probe":
		limits, e := os.ReadFile("/proc/self/limits")
		if e != nil {
			os.Exit(92)
		}
		var cpus unix.CPUSet
		if e = unix.SchedGetaffinity(0, &cpus); e != nil {
			os.Exit(93)
		}
		denials := map[string]bool{}
		denials["setpgid"] = unix.Setpgid(0, 0) == unix.EPERM
		denials["setsid"] = func() bool { _, e := unix.Setsid(); return e == unix.EPERM }()
		denials["affinity"] = unix.SchedSetaffinity(0, &cpus) == unix.EPERM
		denials["rlimit"] = unix.Setrlimit(unix.RLIMIT_CPU, &unix.Rlimit{Cur: 999, Max: 999}) == unix.EPERM
		denials["fork"] = exec.Command("/proc/self/exe").Run() != nil
		b, e := unix.Mmap(-1, 0, 3<<30, unix.PROT_READ|unix.PROT_WRITE, unix.MAP_PRIVATE|unix.MAP_ANON)
		denials["memory"] = e == unix.ENOMEM
		if e == nil {
			unix.Munmap(b)
		}
		output, _ := json.Marshal(struct {
			Limits  string
			CPUs    int
			Env     []string
			Denials map[string]bool
		}{string(limits), cpus.Count(), os.Environ(), denials})
		send("result", output)
	case "cpu":
		for {
			_ = time.Now()
		}
	case "sleep":
		time.Sleep(time.Minute)
	case "crash":
		os.Exit(7)
	case "stdout":
		fmt.Print(strings.Repeat("x", 100000))
		time.Sleep(time.Minute)
	case "checkpoint":
		send("checkpoint", []byte("opaque validated-by-runner-state"))
		send("result", []byte("UNVERIFIED fixture"))
	default:
		os.Exit(94)
	}
}
