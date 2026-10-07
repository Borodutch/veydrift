package devcatalog

import (
	"bytes"
	"encoding/binary"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/backend/groth16"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"io"
	"os"
	"testing"

	rt "github.com/Borodutch/veydrift/packages/battle-prover/runtime"
	"golang.org/x/sys/unix"
)

type consumeReader struct{ n int64 }

func (r *consumeReader) ReadFrom(src io.Reader) (int64, error) {
	n, e := io.Copy(io.Discard, src)
	r.n = n
	return n, e
}
func TestPinnedDependencyStreaming(t *testing.T) {
	d := testDir(t)
	payload := make([]byte, 64)
	binary.LittleEndian.PutUint64(payload, 32)
	binary.LittleEndian.PutUint64(payload[16:], 16)
	binary.LittleEndian.PutUint64(payload[24:], 3)
	a, e := writeArtifact(d, "ccs.bin", bytes.NewReader(payload), 100)
	if e != nil {
		t.Fatal(e)
	}
	f, e := openAt(d, "ccs.bin", unix.O_RDONLY)
	if e != nil {
		t.Fatal(e)
	}
	defer f.Close()
	reader := &consumeReader{}
	if e = decodePinned(f, a, true, reader); e != nil {
		t.Fatal(e)
	}
	if reader.n != 64 {
		t.Fatal("not fully consumed")
	}
	wrong := rt.Artifact{SHA256: digest([]byte("wrong")), Bytes: a.Bytes}
	reader.n = 0
	if decodePinned(f, wrong, true, reader) == nil || reader.n != 0 {
		t.Fatal("decoded unpinned bytes")
	}
}
func TestPendingAndUnknownRefuseResume(t *testing.T) {
	for _, name := range []string{"stage-0000.pending", "unrelated"} {
		t.Run(name, func(t *testing.T) {
			d := testDir(t)
			if e := unix.Mkdirat(int(d.Fd()), name, 0700); e != nil {
				t.Fatal(e)
			}
			if _, _, e := scan(d, testConfig()); e == nil {
				t.Fatal("conflicting namespace accepted")
			}
		})
	}
}

// Real serializers, not a valid CCS/VK pair or any setup/approval claim.
type tinyDependencyCircuit struct{ X frontend.Variable }

func (c *tinyDependencyCircuit) Define(api frontend.API) error {
	api.AssertIsEqual(api.Mul(c.X, c.X), 1)
	return nil
}
func TestPinnedActualGnarkRoundtrips(t *testing.T) {
	cs, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, &tinyDependencyCircuit{})
	if err != nil {
		t.Fatal(err)
	}
	d := testDir(t)
	a, err := writeArtifact(d, "ccs.bin", cs, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	f, err := openAt(d, "ccs.bin", unix.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	decoded := groth16.NewCS(ecc.BN254)
	if err = decodePinned(f, a, true, decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.GetNbConstraints() != cs.GetNbConstraints() {
		t.Fatal("constraint roundtrip")
	}
	vkBytes, err := os.ReadFile("../composition/staged-public/settlement-phases-v2/full-20261005-v1/adapters/final/receipt.vk")
	if err != nil {
		t.Fatal(err)
	}
	if digest(vkBytes) != "bb99dcb236243b696f0cb812ccc16df40e50659f769168a5458df861473d6505" {
		t.Fatal("historical test VK pin")
	}
	a, err = writeArtifact(d, "vk.bin", bytes.NewReader(vkBytes), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	vf, err := openAt(d, "vk.bin", unix.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	defer vf.Close()
	vk := groth16.NewVerifyingKey(ecc.BN254)
	if err = decodePinned(vf, a, false, vk); err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	if _, err = vk.WriteTo(&out); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out.Bytes(), vkBytes) {
		t.Fatal("VK canonical roundtrip")
	}
}
