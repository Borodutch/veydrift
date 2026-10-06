package qualification

import (
	"encoding/hex"
	rb "github.com/Borodutch/veydrift/packages/battle-prover/rawbridge"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/frontend"
	"os/exec"
	"strings"
	"testing"
)

func TestLinkedPublicLayoutAndSolidityHash(t *testing.T) {
	c := linkedFixture(t)
	w, e := frontend.NewWitness(c, ecc.BN254.ScalarField())
	if e != nil {
		t.Fatal(e)
	}
	pub, e := w.Public()
	if e != nil {
		t.Fatal(e)
	}
	v := pub.Vector().(fr.Vector)
	s := c.Statement()
	if len(v) != len(s) {
		t.Fatal("public width")
	}
	for i, x := range s {
		n, e := scalar(x)
		if e != nil {
			t.Fatal(e)
		}
		var z fr.Element
		z.SetBigInt(n)
		if !z.Equal(&v[i]) {
			t.Fatalf("public order %d", i)
		}
	}
	if _, e := exec.LookPath("cast"); e != nil {
		t.Skip("cast unavailable")
	}
	words := c.ChainWords()
	args := []string{"abi-encode", "f(bytes32,uint256,address,uint256,uint32,bytes32,bytes32,address,bytes32,address,uint256,bytes32,bytes32,bytes32,uint256,uint256,uint8)"}
	for i, w := range words {
		b := rb.Encode(w)
		switch i {
		case 0, 5, 6, 8, 11, 12, 13:
			args = append(args, "0x"+hex.EncodeToString(b))
		case 2, 7, 9:
			args = append(args, "0x"+hex.EncodeToString(b[12:]))
		default:
			args = append(args, rb.Integer(w).String())
		}
	}
	out, e := exec.Command("cast", args...).CombinedOutput()
	if e != nil {
		t.Fatal(e, string(out))
	}
	encoded := strings.TrimSpace(string(out))
	if encoded != "0x"+hex.EncodeToString(rb.Encode(words...)) {
		t.Fatal("chain record Solidity ABI")
	}
	out, e = exec.Command("cast", "keccak", encoded).CombinedOutput()
	if e != nil {
		t.Fatal(e, string(out))
	}
	if strings.TrimSpace(string(out)) != "0x"+hex.EncodeToString(rb.Encode(c.ChainRecord)) {
		t.Fatal("chain record digest")
	}
	t.Logf("independent chain record=%s", strings.TrimSpace(string(out)))
}
