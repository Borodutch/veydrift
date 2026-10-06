// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// DEV ONLY genuine finite fixture from full-20261005-v1. Never a production registry.
library FinalProofFixture {
    function inputs() internal pure returns (uint256[22] memory p) {
        p[0] = 18395499706900017847;
        p[1] = 7967734143446093506;
        p[2] = 2524575188123157529;
        p[3] = 10865060596497800667;
        p[4] = 6229458217532788799;
        p[5] = 13365098583402300192;
        p[6] = 13333511352624175928;
        p[7] = 2449549484128514639;
        p[8] = 3;
        p[9] = 0;
        p[10] = 0;
        p[11] = 0;
        p[12] = 1;
        p[13] = 2;
        p[14] = 0;
        p[15] = 0;
        p[16] = 0;
        p[17] = 0;
        p[18] = 0;
        p[19] = 0;
        p[20] = 0;
        p[21] = 1;
    }

    function proof() internal pure returns (bytes memory) {
        return hex"11316d30d7697c3e478944987b8dea076c1f83470d7dfbbab5d8aae0f2efc5011f3a55e1aef270d717dcf147895e8c6f9d21e2857f825209fca4b554e411faca2a36ab892c640edeac13c43c0cdcddd13fa427e0c6ccadb164094b437ccd24c6226a8687a82da1094a0c375a55a9a4d1ab0659b1e47ec5fa4a586e6b22a3a91128bea86df47e239c2986adbab34500ad5e50771844a2fd0478faec9772609828110a2a65eec7595e14e9f371f2cdc15fd77280756a386e233753116d22325dd00d75c155c97a8e83dab4914556ad537f7887cff01265df69114ef99b0a233d620afe85749145dde40ce49aad8f7e7bd589c663d9d8010f49ef43e357870bc28a00c92ccb227f96c13bb9b076a25ec0dae15cfbb88cec6a6b6483226e8ee8bb0f22d4633979e2ac5743fc6a39a88bd84994b0d3ef6b76a09ff1c41f25811a57962047db2978156ab762d0a9e4848ca7db94531fd781f31760bce84a50ddf7e9343010d0b2079edaed0f6bb94854504643996c18a08413e09ab819605b880dca07";
    }
}
