# Token and liquidity

This document records the live Base token setup: supplies, allocation, vesting, Uniswap v4 pools and
the liquidity lock. `packages/contracts/deployments/base.json` records the token addresses, and the
player-facing copy of these tables is the "Contracts And Tokens" section of
[the player manual](../apps/frontend/src/docs/content/docs.md).

## Tokens

All tokens were deployed with plain. None of them has an owner, minter, proxy, tax or pause switch, and
the whole supply of each was minted once at deployment.

| Token | Supply | Base address |
| --- | --- | --- |
| VEYDRIFT | 1,000,000,000 (18 decimals) | `0x442E9Ba64899d6B0bD25DF2558d3E804427bF448` |
| vMETAL | 50,000,000,000 (0 decimals) | `0x078b4EC3E7681D1A658c32eb806872FBCD922CFc` |
| vCRYSTAL | 50,000,000,000 (0 decimals) | `0x045627dc0b1A10289B53E23a5045aF7D470EF50f` |
| vDEUT | 50,000,000,000 (0 decimals) | `0x99FF0a1e24c3171132912D4703dF2c67b4Da6698` |

One resource token equals one in-game unit. The Game contract (`0xf397910F005151b09644228573a4353818D3755d`)
holds 2,000,000,000 of each resource as the Rift reserve that backs every in-game unit. The token
treasury (`0x2732e87c9b9A9Ce3C1C78968B12F56Ec74D1c9d7`, Vaultwarden "Veydrift Mainnet Token Treasury
(2026-10)") holds the rest of each resource that is not in the pools and tops up the game reserve with
a plain transfer when needed.

## VEYDRIFT allocation

| Purpose | VEYDRIFT | Share | Where |
| --- | ---: | ---: | --- |
| Development vesting | 250,000,000 | 25% | `0xB2554e9e2B201F299d8f0fF8A522FAd3057E87A4` |
| Contributor vesting | 200,000,000 | 20% | `0x4A55cff3006e87360285969dD366acBd79445BeD` |
| Ecosystem vesting | 200,000,000 | 20% | `0x64C323e8ef7D6df9730E64627d7755c9A1050162` |
| VEYDRIFT/ETH liquidity | 150,000,000 | 15% | Uniswap v4 pool, see below |
| Resource liquidity | 200,000,000 | 20% | About 66.67M in each resource pool, see below |
| Total | 1,000,000,000 | 100% | |

The vesting wallets are OpenZeppelin `VestingWallet` contracts owned by borodutch.eth
(`0xbf74483DB914192bb0a9577f3d8Fb29a6d4c08eE`), which receives every release. All three start on
2026-10-22 20:00 UTC and release linearly: development over 5 years, contributor over 4 years with a
1-year cliff, and ecosystem over 6 years.

## Uniswap v4 pools

All four pools are hookless and full range, with fee 9000 (0.9%) and tick spacing 90.

| Pool | Pool id | Position NFT | Opening price |
| --- | --- | --- | --- |
| VEYDRIFT/ETH | `0xa48cdc0e5f4612b2400ea20aad0df45cdd3f51e1f7584d318239d217cef45c51` | 3204128 | 150,000,000 VEYDRIFT + 0.5 ETH (1 ETH = 300,000,000 VEYDRIFT) |
| vMETAL/VEYDRIFT | `0x52254cbdbe214d5956d31250f750dac0cdad33b164c3636f28a49f969e1b7154` | 3204056 | 1 vMETAL = 0.005 VEYDRIFT |
| vCRYSTAL/VEYDRIFT | `0x09fddc405f13c6c802576601bd31824c4029825301753c17fad07b62aecfb64f` | 3204065 | 1 vCRYSTAL = 0.0075 VEYDRIFT |
| VEYDRIFT/vDEUT | `0x20aadf49294552454661fc8a57a7beb32b870dc4190a9466629816d8baa713b7` | 3204067 | 1 vDEUT = 0.015 VEYDRIFT |

The resource pools open at a 1 : 1.5 : 3 metal/crystal/deuterium price ratio. Each one holds about
66.67M VEYDRIFT against the matching resource amount (13,333,334,000 vMETAL, 8,888,889,000 vCRYSTAL
and 4,444,445,000 vDEUT on 2026-11-06). There are no protocol-seeded resource/ETH or
resource/stablecoin pools.

## Liquidity lock

All four position NFTs are held by `V4PositionLock` at `0x490e1952310c49D865F04ae3B70B06FC004cFb36`
(source: <https://git.borodutch.com/backmeupplz/locker>, `contracts/src/V4PositionLock.sol`; managed
at <https://locker.borodutch.com>). The lock has no owner, no rescue method and no early release:

- Nobody can remove liquidity before 2027-11-06 20:00 UTC. After that, anyone can call
  `approveBeneficiary`, which lets only borodutch.eth take the positions out.
- Anyone can call `collectFees(tokenId)` at any time. It collects only the accrued trading fees and
  always sends them to borodutch.eth.

## Pinned official Base deployments

| Component | Address | Runtime codehash |
| --- | --- | --- |
| WETH | `0x4200000000000000000000000000000000000006` | `0x8a3a1f6a9f9dce633117adee5b458245835a8645a8c8726a26382a4622508b1c` |
| v4 PoolManager | `0x498581fF718922c3f8e6A244956aF099B2652b2b` | `0x83b2af6e9f3158defc2811cbcb0db71ecf8b2ba2abea39c39e370ac5c6f43eb6` |
| v4 PositionManager | `0x7C5f5A4bBd8fD63184577525326123B519429bDc` | `0x243f9e091ddf11c7c04e28059fdbbf1bab82b72d414fafb8e096c097aaeb622a` |
| v4 StateView | `0xA3c0c9b65baD0b08107Aa264b0f3dB444b867A71` | `0xbbd5859677ef5491143133e8ed2b8faa0272f6fc2cbae94c53e79cc8c0538545` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | `0xa67739abc3ede9dbdc0491636c67d6a14ac07fab9030c3f509b1eb7b11dff8ed` |

Official v4 Base registry: <https://developers.uniswap.org/docs/protocols/v4/deployments>.

Price-dependent protocol accounting must never read an AMM spot price; it needs a separately reviewed
TWAP or oracle design. User swaps use user-selected slippage.
