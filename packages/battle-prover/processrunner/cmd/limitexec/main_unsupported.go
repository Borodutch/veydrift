//go:build !linux || (!amd64 && !arm64)

package main

import "os"

func main() { os.Exit(125) }
