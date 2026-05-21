pragma circom 2.1.6;

// Retired placeholder only. Veydrift gameplay state is public onchain state.
template PlaceholderSignal() {
    signal input value;
    signal output sameValue;

    sameValue <== value;
}

component main = PlaceholderSignal();
