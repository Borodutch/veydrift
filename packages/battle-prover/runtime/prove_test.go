package runtime

import (
	"context"
	"errors"
	"testing"
)

func TestApprovedProofRequiresCatalogAndWitness(t *testing.T) {
	if _, err := ProveApproved(context.Background(), nil, AdapterKeyID("final"), nil); err == nil {
		t.Fatal("accepted missing approval/witness")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ProveApproved(ctx, nil, AdapterKeyID("final"), nil); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
