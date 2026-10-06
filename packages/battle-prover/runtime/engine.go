package runtime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"sort"

	"github.com/Borodutch/veydrift/packages/battle-prover/chainsource"
	comp "github.com/Borodutch/veydrift/packages/battle-prover/composition"
	out "github.com/Borodutch/veydrift/packages/battle-prover/outputbridge"
	p "github.com/Borodutch/veydrift/packages/battle-prover/protocol"
	raw "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/resultbridge"
	"github.com/Borodutch/veydrift/packages/battle-prover/service"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend"
	"github.com/consensys/gnark/backend/groth16"
	bn "github.com/consensys/gnark/backend/groth16/bn254"
	"github.com/consensys/gnark/backend/solidity"
	"github.com/consensys/gnark/backend/witness"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bn254"
	rec "github.com/consensys/gnark/std/recursion/groth16"
)

const engineSchema = "veydrift-approved-engine-v1"
const maxEngineCheckpointBytes = 64 << 20

var engineRoles = []string{"qualification", "prepared-combat", "bridge-report", "pipeline", "raw-qualified", "output-pipeline", "final"}

type engineGroup struct {
	Phase int
	Group string
}
type engineSavedFrontier struct {
	Group engineGroup
	Bytes []byte
}
type engineState struct {
	Schema, CatalogSHA256 string
	Trace                 TraceCheckpoint
	Pending               bool
	Frontiers             []engineSavedFrontier
	Adapters              []NativeReceipt
}

// Engine owns deterministic native advice and verified public receipts. It is
// single-threaded. Persist Checkpoint through the fenced store after every call.
// No key setup, private witness serialization or filesystem mutation occurs here.
type Engine struct {
	snapshot  service.Snapshot
	catalog   *Catalog
	trace     *Trace
	pending   *TraceEvent
	frontiers map[engineGroup]*Frontier
	adapters  map[string]NativeReceipt
	poisoned  bool // A native transition error may have mutated private advice.
}

func NewEngine(s service.Snapshot, release chainsource.Release, limits WitnessLimits, c *Catalog) (*Engine, error) {
	if c == nil || s.Identity.Verifier != c.SHA256() || s.Identity.Rules != c.manifest.RulesSHA256 {
		return nil, errors.New("engine catalog authority mismatch")
	}
	t, err := NewTrace(s, release, limits)
	if err != nil {
		return nil, err
	}
	s.Input = bytes.Clone(s.Input)
	return &Engine{snapshot: s, catalog: c, trace: t, frontiers: map[engineGroup]*Frontier{}, adapters: map[string]NativeReceipt{}}, nil
}
func engineEventGroup(ev *TraceEvent) engineGroup {
	g := "0"
	if ev.Phase == comp.Attribution {
		g = ev.Group
	}
	return engineGroup{ev.Phase, g}
}
func (e *Engine) binding(g engineGroup) FrontierBinding {
	b := FrontierBinding{Identity: e.snapshot.Identity, Anchor: e.snapshot.Anchor, Phase: g.Phase, Group: g.Group}
	// Hash all authoritative inputs, not a self-asserted group digest from disk.
	data, _ := json.Marshal(struct {
		Schema  string
		Binding FrontierBinding
		Catalog string
	}{engineSchema, b, e.catalog.SHA256()})
	b.SourceSHA256 = service.Hash(data)
	return b
}
func (e *Engine) group(g engineGroup) (*Frontier, error) {
	if f := e.frontiers[g]; f != nil {
		return f, nil
	}
	f, err := NewFrontier(e.catalog, e.binding(g))
	if err != nil {
		return nil, err
	}
	e.frontiers[g] = f
	return f, nil
}
func (e *Engine) groups() []engineGroup {
	gs := make([]engineGroup, 0, len(e.frontiers))
	for g := range e.frontiers {
		gs = append(gs, g)
	}
	sort.Slice(gs, func(i, j int) bool {
		if gs[i].Phase != gs[j].Phase {
			return gs[i].Phase < gs[j].Phase
		}
		a, _ := new(big.Int).SetString(gs[i].Group, 10)
		b, _ := new(big.Int).SetString(gs[j].Group, 10)
		return a.Cmp(b) < 0
	})
	return gs
}
func (e *Engine) Checkpoint() ([]byte, error) {
	if e.poisoned {
		return nil, errors.New("native transition failed; restore last checkpoint")
	}
	cp, err := e.trace.Checkpoint()
	if err != nil {
		return nil, err
	}
	s := engineState{Schema: engineSchema, CatalogSHA256: e.catalog.SHA256(), Trace: cp, Pending: e.pending != nil, Frontiers: []engineSavedFrontier{}, Adapters: []NativeReceipt{}}
	for _, g := range e.groups() {
		b, err := e.frontiers[g].Checkpoint()
		if err != nil {
			return nil, err
		}
		s.Frontiers = append(s.Frontiers, engineSavedFrontier{g, b})
	}
	for _, r := range engineRoles {
		if a, ok := e.adapters[r]; ok {
			s.Adapters = append(s.Adapters, a)
		}
	}
	b, err := json.Marshal(s)
	if len(b) > maxEngineCheckpointBytes {
		return nil, errors.New("engine checkpoint size")
	}
	return b, err
}

// Advance executes zero or one actual proof. Native transitions and sealing may
// also progress; errors retain the pending event so retry cannot skip a leaf.
func (e *Engine) Advance(ctx context.Context) (bool, error) {
	if e.poisoned {
		return false, errors.New("native transition failed; restore last checkpoint")
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	// Drain every pending carry/promotion before consuming another source event.
	for _, g := range e.groups() {
		worked, err := e.frontiers[g].Advance(ctx)
		if worked || err != nil {
			return worked, err
		}
	}
	if e.pending == nil && !e.trace.Done() {
		ev, err := e.trace.Next(ctx)
		if err != nil && err != io.EOF {
			e.poisoned = true
			return false, err
		}
		e.pending = ev
	}
	if ev := e.pending; ev != nil {
		if ev.Phase == TraceQualification {
			n, err := ProveApproved(ctx, e.catalog, AdapterKeyID("qualification"), ev.Step)
			if err != nil {
				return false, err
			}
			if _, err = e.verifyAdapter(ctx, "qualification", n); err != nil {
				return false, err
			}
			e.adapters["qualification"] = n
			e.pending = nil
			return true, nil
		}
		var a frontend.Circuit
		var r comp.FamilyRange
		if ev.Phase == comp.Bridge && ev.Kind == rb.Close {
			f := e.frontiers[engineGroup{comp.Attribution, ev.Group}]
			if f == nil {
				return false, errors.New("missing actual attribution")
			}
			if err := f.Finish(); err != nil {
				return false, err
			}
			root, ok := f.Root()
			if !ok {
				worked, err := f.Advance(ctx)
				return worked, err
			}
			env, err := VerifyFamilyReceipt(ctx, e.catalog, root)
			if err != nil {
				return false, err
			}
			close, err := comp.NewCloseWitness(ev.Step.(*rb.Step), env.Range, env.Auth)
			if err != nil {
				return false, err
			}
			a = close
			r = close.Range
		} else {
			leaf, err := comp.NewLeafWitness(ev.Step)
			if err != nil {
				return false, err
			}
			a = leaf
			r = leaf.Range
		}
		f, err := e.group(engineEventGroup(ev))
		if err != nil {
			return false, err
		}
		id := comp.FamilyID{Phase: ev.Phase, Kind: ev.Kind}
		// Capacity is approved before paying for a proof.
		n := new(big.Int).Add(artifactWord(f.state.Cursor[:]), big.NewInt(1))
		if n.BitLen() > 256 || n.Cmp(new(big.Int).Lsh(big.NewInt(1), uint(f.state.Height))) > 0 {
			return false, errors.New("approved phase capacity exhausted")
		}
		native, err := ProveApproved(ctx, e.catalog, FamilyKeyID(id), a)
		if err != nil {
			return false, err
		}
		receipt, err := NewFamilyReceipt(id, r, native)
		if err != nil {
			return false, err
		}
		if err = f.PushLeaf(ctx, f.Cursor(), receipt); err != nil {
			return false, err
		}
		e.pending = nil
		return true, nil
	}
	// Source exhaustion, not a saved flag, authorizes all remaining roots.
	for _, g := range e.groups() {
		f := e.frontiers[g]
		if err := f.Finish(); err != nil {
			return false, err
		}
		if _, ok := f.Root(); !ok {
			return f.Advance(ctx)
		}
	}
	for _, role := range engineRoles {
		if _, ok := e.adapters[role]; ok {
			continue
		}
		a, err := e.adapterWitness(ctx, role)
		if err != nil {
			return false, err
		}
		n, err := ProveApproved(ctx, e.catalog, AdapterKeyID(role), a)
		if err != nil {
			return false, err
		}
		if _, err = e.verifyAdapter(ctx, role, n); err != nil {
			return false, err
		}
		e.adapters[role] = n
		return true, nil
	}
	return false, nil
}

func (e *Engine) claims() (comp.RawQualifiedClaims, comp.OutputPipelineClaims, error) {
	var a comp.RawQualifiedClaims
	var b comp.OutputPipelineClaims
	t, err := e.trace.Result()
	if err != nil {
		return a, b, err
	}
	a.RawFirst = t.Endpoints[comp.RawJournal].First.(*raw.Step).Statement()
	a.RawLast = t.Endpoints[comp.RawJournal].Last.(*raw.Step).Statement()
	a.Qualified = t.Qualification.Statement()
	b.First = t.Endpoints[comp.SettlementOutput].First.(*out.Step).Statement()
	b.Last = t.Endpoints[comp.SettlementOutput].Last.(*out.Step).Statement()
	b.Pipeline = t.Manifest.Pipeline
	return a, b, nil
}
func (e *Engine) adapterValues(role string) ([]frontend.Variable, error) {
	if role == "qualification" {
		q := e.trace.result.Qualification
		if q == nil {
			return nil, errors.New("qualification source missing")
		}
		v := q.Statement()
		return v[:], nil
	}
	a, b, err := e.claims()
	if err != nil {
		return nil, err
	}
	v := b.Pipeline
	switch role {
	case "prepared-combat":
		return []frontend.Variable{v[0], v[1], v[2], v[3], 0, 0, 0, 0}, nil
	case "bridge-report":
		return []frontend.Variable{0, v[1], v[2], v[3], v[4], v[5], v[6], v[7]}, nil
	case "pipeline":
		return v[:], nil
	case "raw-qualified":
		d, err := comp.RawQualifiedDigest(a)
		return []frontend.Variable{d}, err
	case "output-pipeline":
		d, err := comp.OutputPipelineDigest(b)
		return []frontend.Variable{d}, err
	case "final":
		v := e.trace.result.Manifest.Settlement()
		return v[:], nil
	default:
		return nil, errors.New("unknown adapter")
	}
}
func engineAsAuth(a comp.CatalogAuth) comp.Auth {
	return comp.Auth{Proof: a.Proof, Witness: a.Witness, Key: a.Keys[0]}
}
func (e *Engine) root(ctx context.Context, phase int) (comp.FamilyEnvelope, error) {
	f := e.frontiers[engineGroup{phase, "0"}]
	if f == nil {
		return comp.FamilyEnvelope{}, errors.New("missing phase frontier")
	}
	r, ok := f.Root()
	if !ok {
		return comp.FamilyEnvelope{}, errors.New("phase root not complete")
	}
	return VerifyFamilyReceipt(ctx, e.catalog, r)
}
func (e *Engine) auth(ctx context.Context, role string) (comp.Auth, error) {
	r, ok := e.adapters[role]
	if !ok {
		return comp.Auth{}, fmt.Errorf("missing adapter %s", role)
	}
	return e.verifyAdapter(ctx, role, r)
}
func (e *Engine) adapterWitness(ctx context.Context, role string) (frontend.Circuit, error) {
	if role == "qualification" {
		if e.trace.result.Qualification == nil {
			return nil, errors.New("missing qualification")
		}
		return e.trace.result.Qualification, nil
	}
	a, b, err := e.claims()
	if err != nil {
		return nil, err
	}
	values, err := e.adapterValues(role)
	if err != nil {
		return nil, err
	}
	switch role {
	case "prepared-combat", "bridge-report":
		phases := [2]int{comp.Preparation, comp.Combat}
		mode := 0
		if role == "bridge-report" {
			phases = [2]int{comp.Bridge, comp.Report}
			mode = 1
		}
		l, err := e.root(ctx, phases[0])
		if err != nil {
			return nil, err
		}
		r, err := e.root(ctx, phases[1])
		if err != nil {
			return nil, err
		}
		c := &comp.FamilyPhaseJoin{Mode: mode, Children: [2]comp.CatalogAuth{l.Auth, r.Auth}, Ranges: [2]comp.FamilyRange{l.Range, r.Range}}
		copy(c.Public[:], values)
		return c, nil
	case "pipeline":
		l, err := e.auth(ctx, "prepared-combat")
		if err != nil {
			return nil, err
		}
		r, err := e.auth(ctx, "bridge-report")
		if err != nil {
			return nil, err
		}
		c := &comp.Join{Mode: 2, Children: [2]comp.Auth{l, r}}
		copy(c.Public[:], values)
		x, _ := e.adapterValues("prepared-combat")
		y, _ := e.adapterValues("bridge-report")
		copy(c.ChildrenPublic[0][:], x)
		copy(c.ChildrenPublic[1][:], y)
		return c, nil
	case "raw-qualified":
		r, err := e.root(ctx, comp.RawJournal)
		if err != nil {
			return nil, err
		}
		q, err := e.auth(ctx, "qualification")
		if err != nil {
			return nil, err
		}
		return &comp.RawQualified{Digest: values[0], Claims: a, Raw: engineAsAuth(r.Auth), RawRange: r.Range, Qualification: q}, nil
	case "output-pipeline":
		r, err := e.root(ctx, comp.SettlementOutput)
		if err != nil {
			return nil, err
		}
		q, err := e.auth(ctx, "pipeline")
		if err != nil {
			return nil, err
		}
		return &comp.OutputPipeline{Digest: values[0], Claims: b, Output: engineAsAuth(r.Auth), OutputRange: r.Range, Pipeline: q}, nil
	case "final":
		l, err := e.auth(ctx, "raw-qualified")
		if err != nil {
			return nil, err
		}
		r, err := e.auth(ctx, "output-pipeline")
		if err != nil {
			return nil, err
		}
		return &comp.SettlementFinal{Public: e.trace.result.Manifest.Settlement(), Provenance: l, Results: r, RawQualified: a, OutputPipeline: b, Manifest: e.trace.result.Manifest}, nil
	}
	return nil, errors.New("unknown adapter")
}

// Decode only after independently approved VK bytes and allocation headers have
// been checked. Exact expected public bytes are rebuilt from native replay.
func engineVerifyNative(ctx context.Context, c *Catalog, role string, n NativeReceipt, values []frontend.Variable) (auth comp.Auth, err error) {
	defer func() {
		if x := recover(); x != nil {
			auth = comp.Auth{}
			err = fmt.Errorf("adapter encoding: %v", x)
		}
	}()
	if err = ctx.Err(); err != nil {
		return
	}
	if c == nil || n.CatalogSHA256 != c.SHA256() || n.KeyID != AdapterKeyID(role) {
		return auth, errors.New("adapter catalog/key mismatch")
	}
	entry, ok := c.entries[n.KeyID]
	if !ok || entry.Node.Role != role || entry.Node.PublicInputs != len(values) {
		return auth, errors.New("adapter role/schema")
	}
	kb, err := c.readArtifact(ctx, entry.Approval.VK, c.cfg.MaxArtifactBytes, true)
	if err != nil {
		return auth, err
	}
	vk := new(bn.VerifyingKey)
	if err = artifactBinary(kb, vk); err != nil {
		return auth, err
	}
	count := len(vk.CommitmentKeys)
	if count > (maxFamilyProofBytes-164)/32 || len(vk.G1.K) != len(values)+1+count || len(vk.PublicAndCommitmentCommitted) != count {
		return auth, errors.New("adapter VK schema")
	}
	for i, is := range vk.PublicAndCommitmentCommitted {
		for _, x := range is {
			if x < 1 || x > len(values)+i {
				return auth, errors.New("adapter commitment schema")
			}
		}
	}
	if len(n.Proof) != 164+32*count || binary.BigEndian.Uint32(n.Proof[128:132]) != uint32(count) {
		return auth, errors.New("adapter proof allocation header")
	}
	for _, off := range []int{0, 32, 96} {
		if n.Proof[off]&0xc0 == 0 {
			return auth, errors.New("adapter uncompressed point")
		}
	}
	proof := new(bn.Proof)
	if err = artifactBinary(n.Proof, proof); err != nil {
		return auth, err
	}
	pub, err := witness.New(ecc.BN254.ScalarField())
	if err != nil {
		return auth, err
	}
	ch := make(chan any, len(values))
	for _, v := range values {
		s, err := frontierScalar(v)
		if err != nil {
			return auth, err
		}
		x, _ := new(big.Int).SetString(s, 10)
		ch <- x
	}
	close(ch)
	if err = pub.Fill(len(values), 0, ch); err != nil {
		return auth, err
	}
	var buf bytes.Buffer
	if _, err = pub.WriteTo(&buf); err != nil {
		return auth, err
	}
	if !bytes.Equal(n.Public, buf.Bytes()) {
		return auth, errors.New("adapter exact native public mismatch")
	}
	option := rec.GetNativeVerifierOptions(ecc.BN254.ScalarField(), ecc.BN254.ScalarField())
	if role == "final" {
		option = solidity.WithVerifierTargetSolidityVerifier(backend.GROTH16)
	}
	if err = groth16.Verify(proof, vk, pub, option); err != nil {
		return auth, err
	}
	auth.Proof, err = rec.ValueOfProof[sw_bn254.G1Affine, sw_bn254.G2Affine](proof)
	if err != nil {
		return auth, err
	}
	auth.Witness, err = rec.ValueOfWitness[sw_bn254.ScalarField](pub)
	if err != nil {
		return auth, err
	}
	auth.Key, err = rec.ValueOfVerifyingKeyFixed[sw_bn254.G1Affine, sw_bn254.G2Affine, sw_bn254.GTEl](vk)
	if err != nil {
		return auth, err
	}
	return auth, ctx.Err()
}
func (e *Engine) verifyAdapter(ctx context.Context, role string, n NativeReceipt) (comp.Auth, error) {
	v, err := e.adapterValues(role)
	if err != nil {
		return comp.Auth{}, err
	}
	return engineVerifyNative(ctx, e.catalog, role, n, v)
}

// Result never returns a stage checkpoint as a completed settlement. It rebuilds
// output solely from replayed native execution, then verifies the final artifact.
func (e *Engine) Result(ctx context.Context, limits ArtifactLimits) (FinalArtifact, error) {
	zero := FinalArtifact{}
	n, ok := e.adapters["final"]
	if !ok || e.poisoned || e.pending != nil || !e.trace.Done() {
		return zero, errors.New("engine final proof not complete")
	}
	if _, err := e.verifyAdapter(ctx, "final", n); err != nil {
		return zero, err
	}
	a, err := e.finalArtifact(n)
	if err != nil {
		return zero, err
	}
	entry := e.catalog.entries[AdapterKeyID("final")]
	kb, err := e.catalog.readArtifact(ctx, entry.Approval.VK, int64(limits.MaxVKBytes), true)
	if err != nil {
		return zero, err
	}
	v, err := NewArtifactVerifier(kb, ArtifactApproval{VKHash: entry.Approval.VK.SHA256, Rules: e.snapshot.Identity.Rules, VerifierManifest: e.catalog.SHA256()}, limits)
	if err != nil {
		return zero, err
	}
	data, err := json.Marshal(a)
	if err != nil {
		return zero, err
	}
	if err = v.Verify(ctx, e.snapshot, data); err != nil {
		return zero, err
	}
	return a, nil
}
func (e *Engine) finalArtifact(n NativeReceipt) (FinalArtifact, error) {
	r, err := e.trace.Result()
	if err != nil {
		return FinalArtifact{}, err
	}
	m := r.Manifest
	a := FinalArtifact{Schema: FinalArtifactSchema, Public: []string{}, Proof: bytes.Clone(n.Proof), Leaves: []AllocationLeaf{}}
	for _, v := range m.Settlement() {
		s, err := frontierScalar(v)
		if err != nil {
			return FinalArtifact{}, err
		}
		a.Public = append(a.Public, s)
	}
	for _, l := range r.Leaves {
		v := []frontend.Variable{l.Side, l.Unit, l.Count, l.Lost, l.Survivors}
		var ss [5]string
		for i, x := range v {
			ss[i], err = frontierScalar(x)
			if err != nil {
				return FinalArtifact{}, err
			}
		}
		a.Leaves = append(a.Leaves, AllocationLeaf{Index: raw.Integer(l.Index).String(), Cohort: raw.Integer(l.Cohort).String(), Owner: raw.Integer(l.Owner).String(), Source: raw.Integer(l.Source).String(), Side: ss[0], Unit: ss[1], Count: ss[2], Lost: ss[3], Survivors: ss[4], Next: raw.Integer(l.Next).String()})
	}
	a.Manifest = ArtifactManifest{VKHash: e.catalog.entries[AdapterKeyID("final")].Approval.VK.SHA256, InputHash: e.snapshot.Identity.InputHash, ProofHash: service.Hash(a.Proof), ChainRecord: raw.Integer(m.ChainRecord).String(), OutputRoot: raw.Integer(m.Root).String(), MemberCount: raw.Integer(m.Context.Prepared.Members).String(), Rounds: raw.Integer(m.Context.Combat.Round).String(), FinalSide0: raw.Integer(m.Context.Combat.Count0).String(), FinalSide1: raw.Integer(m.Context.Combat.Count1).String(), Outcome: raw.Integer(m.Context.Combat.Outcome).String()}
	return a, nil
}

// RestoreEngine verifies every stored receipt and replays every consumed native
// instruction before accepting a cursor. Replay is linear and context checked;
// run inside the process-level time/memory envelope for large prefixes.
func RestoreEngine(ctx context.Context, snap service.Snapshot, release chainsource.Release, limits WitnessLimits, c *Catalog, data []byte) (*Engine, error) {
	if len(data) == 0 || len(data) > maxEngineCheckpointBytes {
		return nil, errors.New("engine checkpoint size")
	}
	var s engineState
	if err := artifactJSON(data, &s); err != nil {
		return nil, err
	}
	e, err := NewEngine(snap, release, limits, c)
	if err != nil {
		return nil, err
	}
	if s.Schema != engineSchema || s.CatalogSHA256 != c.SHA256() || s.Frontiers == nil || s.Adapters == nil {
		return nil, errors.New("engine checkpoint schema/catalog")
	}
	// Validate trace metadata without adopting its unverified cursor.
	if _, err = RestoreTrace(snap, release, limits, s.Trace); err != nil {
		return nil, err
	}
	for _, x := range s.Frontiers {
		if _, ok := e.frontiers[x.Group]; ok {
			return nil, errors.New("duplicate frontier")
		}
		if x.Group.Phase != comp.Attribution && x.Group.Group != "0" {
			return nil, errors.New("unexpected phase group")
		}
		f, err := RestoreFrontier(ctx, c, e.binding(x.Group), x.Bytes)
		if err != nil {
			return nil, err
		}
		e.frontiers[x.Group] = f
	}
	for _, n := range s.Adapters {
		found := ""
		for _, role := range engineRoles {
			if n.KeyID == AdapterKeyID(role) {
				found = role
			}
		}
		if found == "" {
			return nil, errors.New("unknown stored adapter")
		}
		if _, ok := e.adapters[found]; ok {
			return nil, errors.New("duplicate adapter")
		}
		e.adapters[found] = n
	}
	target, _ := new(big.Int).SetString(s.Trace.Events, 10)
	counts := map[engineGroup]*big.Int{}
	closed := map[string]bool{}
	// At most O(frontier height) native endpoints are retained, never a full trace.
	expected := map[engineGroup][]comp.FamilyRange{}
	for g, f := range e.frontiers {
		expected[g] = make([]comp.FamilyRange, len(f.state.Segments))
	}
	for i := new(big.Int); i.Cmp(target) < 0; i.Add(i, big.NewInt(1)) {
		ev, err := e.trace.Next(ctx)
		if err != nil {
			return nil, fmt.Errorf("native replay: %w", err)
		}
		last := new(big.Int).Add(i, big.NewInt(1)).Cmp(target) == 0
		if last && s.Pending {
			e.pending = ev
			continue
		}
		if ev.Phase == TraceQualification {
			if _, ok := e.adapters["qualification"]; !ok {
				return nil, errors.New("skipped qualification proof")
			}
			continue
		}
		if ev.Phase == comp.Bridge && ev.Kind == rb.Close {
			closed[ev.Group] = true
			f := e.frontiers[engineGroup{comp.Attribution, ev.Group}]
			if f == nil {
				return nil, errors.New("Close omitted attribution")
			}
			if _, ok := f.Root(); !ok {
				return nil, errors.New("Close before attribution root")
			}
		}
		g := engineEventGroup(ev)
		f := e.frontiers[g]
		if f == nil {
			return nil, errors.New("skipped native phase/group")
		}
		if counts[g] == nil {
			counts[g] = new(big.Int)
		}
		idx := counts[g]
		st := traceStatement(ev.Step)
		matched := false
		for j, seg := range f.state.Segments {
			start := artifactWord(seg.Start[:])
			end := new(big.Int).Add(start, artifactWord(seg.Receipt.Count[:]))
			if idx.Cmp(start) >= 0 && idx.Cmp(end) < 0 {
				matched = true
				r := &expected[g][j]
				if idx.Cmp(start) == 0 {
					*r = comp.Normalize(g.Phase, comp.Range{First: st, Last: st}, p.MustValue(artifactWord(seg.Receipt.Count[:])))
				}
				copy(r.Last[:comp.Width(g.Phase)], st)
				if seg.Receipt.ID.Arity == 0 && seg.Receipt.ID.Kind != ev.Kind {
					return nil, errors.New("replayed leaf kind mismatch")
				}
				break
			}
		}
		if !matched {
			return nil, errors.New("native prefix exceeds verified frontier")
		}
		idx.Add(idx, big.NewInt(1))
	}
	cp, err := e.trace.Checkpoint()
	if err != nil || cp != s.Trace {
		return nil, errors.New("native transcript mismatch")
	}
	if s.Pending && e.pending == nil {
		return nil, errors.New("pending event missing")
	}
	if e.pending != nil && e.pending.Phase == TraceQualification {
		if _, ok := e.adapters["qualification"]; ok {
			return nil, errors.New("qualification both pending and proved")
		}
	}
	for g, f := range e.frontiers {
		count := counts[g]
		if count == nil {
			// Only the current pending leaf may have allocated an empty frontier.
			if e.pending == nil || e.pending.Phase == TraceQualification || engineEventGroup(e.pending) != g {
				return nil, errors.New("frontier has no native source")
			}
			count = new(big.Int)
		}
		cursor := f.Cursor()
		if count.Cmp(artifactWord(cursor[:])) != 0 {
			return nil, errors.New("frontier/native cursor mismatch")
		}
		for j, seg := range f.state.Segments {
			r, err := NewFamilyReceipt(seg.Receipt.ID, expected[g][j], seg.Receipt.Native)
			if err != nil || r.First != seg.Receipt.First || r.Last != seg.Receipt.Last || r.Count != seg.Receipt.Count {
				return nil, errors.New("frontier/native range mismatch")
			}
		}
		if f.state.Finishing {
			allowed := e.trace.Done() && e.pending == nil
			if g.Phase == comp.Attribution {
				allowed = allowed || closed[g.Group] || (e.pending != nil && e.pending.Phase == comp.Bridge && e.pending.Kind == rb.Close && e.pending.Group == g.Group)
			}
			if !allowed {
				return nil, errors.New("frontier sealed before source exhaustion")
			}
		}
	}
	// Adapter order is a prefix, never arbitrary valid proofs under matching keys.
	gap := false
	for _, role := range engineRoles {
		n, ok := e.adapters[role]
		if !ok {
			gap = true
			continue
		}
		if gap {
			return nil, errors.New("skipped adapter stage")
		}
		if role != "qualification" {
			if !e.trace.Done() || e.pending != nil {
				return nil, errors.New("adapter before native completion")
			}
			for _, f := range e.frontiers {
				if _, ok := f.Root(); !ok {
					return nil, errors.New("adapter before phase roots")
				}
			}
		}
		if _, err = e.verifyAdapter(ctx, role, n); err != nil {
			return nil, err
		}
	}
	// Canonical ordering and no ignored/extra state, independently reconstructed.
	rebuilt, err := e.Checkpoint()
	if err != nil {
		return nil, err
	}
	if !bytes.Equal(data, rebuilt) {
		return nil, errors.New("noncanonical engine state order")
	}
	return e, ctx.Err()
}
