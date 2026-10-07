//go:build !linux && !darwin

package processrunner

import "os"

func openExecutable(string) (*os.File, error) { return nil, ErrUnsupported }
