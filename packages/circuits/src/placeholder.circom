pragma circom 2.1.6;

// Placeholder circuit only. The proving stack and concrete signals remain undecided.
template PlaceholderCommitment() {
    signal input value;
    signal output sameValue;

    sameValue <== value;
}

component main = PlaceholderCommitment();
