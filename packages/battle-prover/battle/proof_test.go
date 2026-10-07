package battle

import (
	"bytes"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"os"
	"testing"
	"time"
)

func TestCompleteBattleProof(t *testing.T) {
	if os.Getenv("BATTLE_PROOF") != "1" {
		t.Skip("opt-in BATTLE_PROOF=1 GOMAXPROCS=2 go test ./battle -run TestCompleteBattleProof -timeout 10m -v")
	}
	started := time.Now()
	c := fixture()
	seed := [32]byte{}
	ss := trace(t, c, seed)
	var systems [2]constraint.ConstraintSystem
	var pk [2]groth16.ProvingKey
	var vk Keys
	for i := 0; i < 2; i++ {
		var err error
		systems[i], err = frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &CommittedStep{Config: c, RNG: i == 1})
		if err != nil {
			t.Fatal(err)
		}
		pk[i], vk[i], err = groth16.Setup(systems[i])
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("test-only setup kind=%d constraints=%d elapsed=%s", i, systems[i].GetNbConstraints(), time.Since(started))
	}
	chunks := make([]Chunk, 0, len(ss)-1)
	proofBytes := 0
	for i := 0; i < len(ss)-1; i++ {
		kind := 0
		if IsRandom(c, ss[i]) {
			kind = 1
		}
		full, err := frontend.NewWitness(CommittedAssignment(c, seed, ss[i], ss[i+1], kind == 1), ecc.BN254.ScalarField())
		if err != nil {
			t.Fatal(err)
		}
		p, err := groth16.Prove(systems[kind], pk[kind], full)
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		var buf bytes.Buffer
		if _, err = p.WriteTo(&buf); err != nil {
			t.Fatal(err)
		}
		proofBytes += buf.Len()
		restored := groth16.NewProof(ecc.BN254)
		if _, err = restored.ReadFrom(&buf); err != nil {
			t.Fatal(err)
		}
		chunks = append(chunks, Chunk{ss[i], ss[i+1], restored})
	}
	result, err := VerifyComplete(c, vk, seed, chunks)
	if err != nil {
		t.Fatal(err)
	}
	if result.Outcome != 1 || result.Allocation[0].Lost != 1 || result.Allocation[1].Survivors != 1 || result.Allocation[2].Lost != 1 || result.Allocation[3].Lost != 1 {
		t.Fatalf("wrong full allocation %+v", result)
	}
	for _, name := range []string{"truncate", "skip", "reorder", "stale-memory", "result", "seed", "genesis", "proof-swap"} {
		t.Run(name, func(t *testing.T) {
			bad := append([]Chunk(nil), chunks...)
			badSeed := seed
			switch name {
			case "truncate":
				bad = bad[:len(bad)-1]
			case "skip":
				bad = append(bad[:8], bad[9:]...)
			case "reorder":
				bad[8], bad[9] = bad[9], bad[8]
			case "stale-memory":
				bad[12].Before.Hull[2]++
			case "result":
				bad[len(bad)-1].After.Outcome = 2
			case "seed":
				badSeed[31] = 1
			case "genesis":
				bad[0].Before.Hull[0] = 1
			case "proof-swap":
				bad[10].Proof = bad[11].Proof
			}
			if _, err := VerifyComplete(c, vk, badSeed, bad); err == nil {
				t.Fatal("forged bundle accepted")
			}
		})
	}
	t.Logf("COMPLETE battle proof: chunks=%d proofBytes=%d counter=%d rounds=%d allocation=%+v elapsed=%s", len(chunks), proofBytes, ss[len(ss)-1].Counter, result.Rounds, result.Allocation, time.Since(started))
}
