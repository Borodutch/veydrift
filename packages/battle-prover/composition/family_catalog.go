package composition

import "fmt"

// FamilyID is circuit identity, not battle identity. Kind is used ONLY at
// Level0/Arity0. Arity1=dispatch, Arity2=binary. A Close key must be
// compiled from CompleteClose. Dispatch0 normalizes the heterogeneous leaves.
type FamilyID struct{ Phase, Level, Kind, Arity int }

func (id FamilyID) Valid() bool {
	if id.Phase < 0 || id.Phase > Report || id.Level < 0 || id.Level > ProtocolRootHeight {
		return false
	}
	if id.Level == 0 && id.Arity == 0 {
		return id.Kind >= 0 && id.Kind < []int{5, 11, 4, 5, 2}[id.Phase]
	}
	return id.Kind == 0 && (id.Arity == 1 || (id.Arity == 2 && id.Level >= 1))
}

// KeyCatalog snapshots the identity map. Supplied key objects must be frozen
// until compilation; it contains public VK constants
// only, never proving keys. The supplied entries are a TRUSTED setup output:
// this host constructor cannot establish that an arbitrary VK proves its claimed
// relation. Only compile/setup of the corresponding audited circuit is approval.
// Production must persist/audit public source+CCS+VK identities, not accept this
// map from a prover. Circuit verification still authenticates the selected key.
type KeyCatalog struct{ entries map[FamilyID]Key }

func NewKeyCatalog(entries map[FamilyID]Key) (*KeyCatalog, error) {
	out := &KeyCatalog{entries: make(map[FamilyID]Key, len(entries))}
	for id, key := range entries {
		if !id.Valid() {
			return nil, fmt.Errorf("invalid family %+v", id)
		}
		if len(key.G1.K) != 4+len(key.CommitmentKeys) {
			return nil, fmt.Errorf("normalized VK schema")
		}
		out.entries[id] = key
	}
	return out, nil
}

// Dependencies is the acyclic dispatch-first graph. B_h verifies two D_(h-1)
// proofs under one fixed key. D_h verifies ONE selected proof from B_h or
// D_(h-1), implementing a binary merge or unary promotion at semantic height h.
func Dependencies(id FamilyID) ([]FamilyID, error) {
	if !id.Valid() || id.Arity == 0 {
		return nil, fmt.Errorf("not an aggregate family")
	}
	phase, h := id.Phase, id.Level
	if h == 0 {
		ids := []FamilyID{}
		for k := 0; k < []int{5, 11, 4, 5, 2}[phase]; k++ {
			ids = append(ids, FamilyID{Phase: phase, Kind: k})
		}
		return ids, nil
	}
	if id.Arity == 2 {
		return []FamilyID{{Phase: phase, Level: h - 1, Arity: 1}}, nil
	}
	return []FamilyID{{Phase: phase, Level: h, Arity: 2}, {Phase: phase, Level: h - 1, Arity: 1}}, nil
}
func (c *KeyCatalog) ForFamily(id FamilyID) ([]Key, error) {
	ids, e := Dependencies(id)
	if e != nil {
		return nil, e
	}
	keys := make([]Key, len(ids))
	for i, id := range ids {
		key, ok := c.entries[id]
		if !ok {
			return nil, fmt.Errorf("missing approved family %+v", id)
		}
		keys[i] = key
	}
	// gnark SwitchVerificationKey also checks exact commitment metadata; fail
	// before expensive compilation when catalogs have incompatible structures.
	first := keys[0]
	for _, k := range keys[1:] {
		if len(k.G1.K) != len(first.G1.K) || len(k.CommitmentKeys) != len(first.CommitmentKeys) || len(k.PublicAndCommitmentCommitted) != len(first.PublicAndCommitmentCommitted) {
			return nil, fmt.Errorf("incompatible key schemas")
		}
		for i, m := range k.PublicAndCommitmentCommitted {
			if len(m) != len(first.PublicAndCommitmentCommitted[i]) {
				return nil, fmt.Errorf("incompatible commitment metadata")
			}
			for j, v := range m {
				if v != first.PublicAndCommitmentCommitted[i][j] {
					return nil, fmt.Errorf("incompatible committed public layout")
				}
			}
		}
	}
	return keys, nil
}
