pragma circom 2.1.0;

template Placeholder() {
    signal input a;
    signal input b;
    signal output c;
    c <== a * b;
}

component main = Placeholder();
