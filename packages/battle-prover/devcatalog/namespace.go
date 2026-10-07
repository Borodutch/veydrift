package devcatalog

import (
	"errors"
	"os"
	"strings"
)

// Unknown files and abandoned staging are explicit conflicts. No cleanup is
// implicit, and a second configuration cannot silently adopt a partial run.
func validateNamespace(root *os.File, count int) error {
	allowed := map[string]bool{"builder.lock": true}
	for i := 0; i < count; i++ {
		allowed[stageName(i)] = true
	}
	entries, e := root.ReadDir(-1)
	if e != nil {
		return e
	}
	if _, e = root.Seek(0, 0); e != nil {
		return e
	}
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".pending") {
			return errors.New("interrupted pending stage requires explicit operator review/removal before resume")
		}
		if !allowed[entry.Name()] {
			return errors.New("unexpected namespace entry: " + entry.Name())
		}
	}
	return nil
}
