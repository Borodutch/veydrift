// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {VeydriftCombatRaidModule} from "../src/VeydriftCombatRaidModule.sol";
import {VeydriftStagedCombatModule} from "../src/VeydriftStagedCombatModule.sol";
import {
    VeydriftLegacyCombatModule,
    VeydriftLegacyCombatRapidfire
} from "../src/VeydriftLegacyCombatModule.sol";

import {Test} from "forge-std/Test.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {
    ITransparentUpgradeableProxy
} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {VeydriftAttackProtectionModule} from "../src/VeydriftAttackProtectionModule.sol";
import {VeydriftAcsAttackModule} from "../src/VeydriftAcsAttackModule.sol";
import {VeydriftCombatModule, VeydriftCombatRapidfire} from "../src/VeydriftCombatModule.sol";
import {VeydriftColonizationModule} from "../src/VeydriftColonizationModule.sol";
import {VeydriftShipProductionModule} from "../src/VeydriftShipProductionModule.sol";
import {VeydriftDefenseHoldModule} from "../src/VeydriftDefenseHoldModule.sol";
import {VeydriftFirstPlanetSettlementModule} from "../src/VeydriftFirstPlanetSettlementModule.sol";
import {VeydriftGame} from "../src/VeydriftGame.sol";
import {VeydriftGameplayModule} from "../src/VeydriftGameplayModule.sol";
import {IVeydriftDelegation} from "../src/interfaces/IVeydriftDelegation.sol";
import {VeydriftPlanetManagementModule} from "../src/VeydriftPlanetManagementModule.sol";
import {VeydriftReferralSystem} from "../src/VeydriftReferralSystem.sol";
import {VeydriftStateMigrationModule} from "../src/VeydriftStateMigrationModule.sol";
import {VeydriftLiveUpgradePolicy} from "../src/libraries/VeydriftLiveUpgradePolicy.sol";
import {Ship} from "../src/libraries/VeydriftTypes.sol";

/// @notice Live-fork verification of the VeydriftGame proxy upgrade.
/// @dev Runs ONLY when BASE_MAINNET_RPC is set, so it is inert in the default `forge test` suite:
///        BASE_MAINNET_RPC=<base-mainnet-rpc> forge test --match-contract UpgradeGameFork -vv
///      Also requires MOON_PROXY_ADDRESS, VEYDRIFT_REFERRAL_SYSTEM_ADDRESS and
///      VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS from the reviewed release configuration; optional
///      ADMIN_ADDRESS has the same default as the script. No placeholder dependency is accepted.
///      Mirrors UpgradeGame.s.sol preflight, referral wiring and empty-calldata Game switch using
///      prank (no private key). This is not execution of the canonical script or a launch/legacy
///      completion proof: a separate canonical-script dry run and fork behavior proof are required.
contract UpgradeGameForkTest is Test {
    // EIP-1967 implementation slot.
    bytes32 internal constant IMPL_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address internal constant PROXY = 0xf397910F005151b09644228573a4353818D3755d;
    address internal constant PROXY_ADMIN = 0xc81609E77b5ea79d0CdA9794b75B65D567535cb9;
    address internal constant PROXY_ADMIN_OWNER = 0x4755D28078442cb7E7Ac2409868fb3Ff1B9fA73B;

    function _addrFromSlot(bytes32 slot) private view returns (address) {
        return address(uint160(uint256(vm.load(PROXY, slot))));
    }

    function _requireScriptPreflight(
        address moonProxy,
        address referralAddress,
        address sourceAddress
    ) private view {
        // Keep these checks aligned with UpgradeGame.run(); never repair prerequisites here.
        require(
            ProxyAdmin(PROXY_ADMIN).owner() == PROXY_ADMIN_OWNER,
            "BROADCASTER_NOT_PROXY_ADMIN_OWNER"
        );
        require(VeydriftGame(PROXY).owner() == PROXY_ADMIN_OWNER, "BROADCASTER_NOT_GAME_OWNER");
        VeydriftLiveUpgradePolicy.requireGameUpgradeReady(PROXY);
        (bool generationOk, bytes memory generationData) =
            moonProxy.staticcall(abi.encodeWithSignature("moonGeneration(uint256)", 0));
        require(generationOk && generationData.length >= 32, "MOON_PARITY_NOT_UPGRADED");
        (bool gameOk, bytes memory gameData) =
            moonProxy.staticcall(abi.encodeWithSignature("game()"));
        require(
            gameOk && gameData.length >= 32 && abi.decode(gameData, (address)) == PROXY,
            "MOON_GAME_MISMATCH"
        );
        // Extra fixture guard: the supplied Moon must also be the Game's actual stored pointer.
        // _moonSystem is slot 21 in the checked-in live storage prefix.
        require(_addrFromSlot(bytes32(uint256(21))) == moonProxy, "GAME_MOON_MISMATCH");
        require(referralAddress.code.length > 0, "REFERRAL_SYSTEM_NOT_CONTRACT");
        require(
            sourceAddress != referralAddress && sourceAddress.code.length > 0,
            "REFERRAL_REPLACEMENT_REQUIRED"
        );
        VeydriftReferralSystem referral = VeydriftReferralSystem(referralAddress);
        VeydriftReferralSystem source = VeydriftReferralSystem(sourceAddress);
        require(source.owner() == PROXY_ADMIN_OWNER, "BROADCASTER_NOT_SOURCE_REFERRAL_OWNER");
        require(source.game() == address(0), "SOURCE_REFERRAL_NOT_FROZEN");
        require(sourceAddress.balance == 0, "SOURCE_REFERRAL_ESCROW_NONZERO");
        require(referral.owner() == PROXY_ADMIN_OWNER, "BROADCASTER_NOT_REFERRAL_OWNER");
        require(referral.referralMigrationFinalized(), "REFERRAL_MIGRATION_PENDING");
        require(referral.referralRewardMigrationConfigured(), "REFERRAL_REWARD_MIGRATION_REQUIRED");
        require(
            referral.referralRewardClaimMigrationConfigured(), "REFERRAL_CLAIM_HISTORY_REQUIRED"
        );
        require(referral.referralSigner() != address(0), "REFERRAL_SIGNER_REQUIRED");
        require(source.referralSigner() == referral.referralSigner(), "REFERRAL_SIGNER_MISMATCH");
        address configuredGame = referral.game();
        require(configuredGame == address(0) || configuredGame == PROXY, "REFERRAL_GAME_MISMATCH");
    }

    function testForkUpgradePreservesStateAndFlipsImplementation() external {
        string memory rpc = vm.envOr("BASE_MAINNET_RPC", string(""));
        if (bytes(rpc).length == 0) {
            emit log("BASE_MAINNET_RPC unset - skipping live fork upgrade verification");
            vm.skip(true);
            return;
        }
        uint256 forkBlock = vm.envOr("BASE_MAINNET_FORK_BLOCK", uint256(0));
        if (forkBlock == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, forkBlock);

        assertEq(block.chainid, 8453, "fork must be Base mainnet");
        address moonProxy = vm.envAddress("MOON_PROXY_ADDRESS");
        address referralAddress = vm.envAddress("VEYDRIFT_REFERRAL_SYSTEM_ADDRESS");
        address sourceAddress = vm.envAddress("VEYDRIFT_SOURCE_REFERRAL_SYSTEM_ADDRESS");
        address moduleAdmin = vm.envOr("ADMIN_ADDRESS", PROXY_ADMIN_OWNER);
        _requireScriptPreflight(moonProxy, referralAddress, sourceAddress);
        bytes32 moonImplBefore = vm.load(moonProxy, IMPL_SLOT);

        address oldImpl = _addrFromSlot(IMPL_SLOT);
        address ownerBefore = VeydriftGame(PROXY).owner();
        uint32 shipBefore = VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo);
        uint256 nextFleetBefore = VeydriftGame(PROXY).nextFleetId();
        assertGt(nextFleetBefore, 1, "no allocated legacy mission to preserve");
        (bool missionRead, bytes memory latestMissionBefore) =
            PROXY.staticcall(abi.encodeWithSignature("fleetMission(uint256)", nextFleetBefore - 1));
        require(missionRead, "latest legacy mission unavailable");
        bytes32 legacyRegistrationSlot = keccak256(abi.encode(nextFleetBefore - 1, uint256(86)));
        // After 905, existing records may already be registered. An ordinary later upgrade
        // must preserve either generation, not assume that every current record is legacy.
        bytes32 registrationBefore = vm.load(PROXY, legacyRegistrationSlot);
        assertFalse(VeydriftGame(PROXY).gamePaused(), "game unexpectedly paused before upgrade");

        // The only dependency write performed by the canonical script, fork-local and owner-only.
        VeydriftReferralSystem referral = VeydriftReferralSystem(referralAddress);
        if (referral.game() == address(0)) {
            vm.prank(PROXY_ADMIN_OWNER);
            referral.setGame(PROXY);
        }
        assertEq(referral.game(), PROXY, "referral Game wiring not applied");

        // Mirror the script's fresh module graph and constructor inputs, not broadcast execution.
        VeydriftCombatRapidfire rapidfire = new VeydriftCombatRapidfire();
        VeydriftCombatModule combatModule = new VeydriftCombatModule(
            address(rapidfire),
            address(new VeydriftStagedCombatModule(address(rapidfire))),
            address(new VeydriftLegacyCombatModule(address(new VeydriftLegacyCombatRapidfire())))
        );
        VeydriftGameplayModule gameplayModule = new VeydriftGameplayModule(address(combatModule));
        VeydriftPlanetManagementModule planetManagementModule = new VeydriftPlanetManagementModule();
        VeydriftAttackProtectionModule attackProtectionModule = new VeydriftAttackProtectionModule();
        VeydriftAcsAttackModule acsAttackModule = new VeydriftAcsAttackModule();
        VeydriftColonizationModule colonizationModule =
            new VeydriftColonizationModule(address(new VeydriftShipProductionModule()));
        VeydriftDefenseHoldModule defenseHoldModule = new VeydriftDefenseHoldModule();
        VeydriftStateMigrationModule stateMigrationModule = new VeydriftStateMigrationModule(
            referralAddress, address(new VeydriftCombatRaidModule())
        );
        VeydriftFirstPlanetSettlementModule firstPlanetSettlementModule =
            new VeydriftFirstPlanetSettlementModule(referralAddress, address(colonizationModule));
        VeydriftGame newImpl = new VeydriftGame(
            moduleAdmin,
            address(firstPlanetSettlementModule),
            address(gameplayModule),
            address(planetManagementModule),
            address(attackProtectionModule),
            address(colonizationModule),
            address(defenseHoldModule),
            address(stateMigrationModule),
            address(acsAttackModule)
        );

        // Perform the upgrade as the real ProxyAdmin owner.
        vm.prank(PROXY_ADMIN_OWNER);
        ProxyAdmin(PROXY_ADMIN)
            .upgradeAndCall(ITransparentUpgradeableProxy(PROXY), address(newImpl), "");

        // Implementation flipped to the new code.
        address implAfter = _addrFromSlot(IMPL_SLOT);
        assertEq(implAfter, address(newImpl), "impl slot not updated");
        assertTrue(implAfter != oldImpl, "impl unchanged");

        // Proxy storage (owner + a real planet's ship count) survives the upgrade unchanged.
        assertEq(VeydriftGame(PROXY).owner(), ownerBefore, "owner not preserved");
        assertEq(VeydriftGame(PROXY).shipCount(1, Ship.SmallCargo), shipBefore, "ship count drift");
        assertFalse(VeydriftGame(PROXY).gamePaused(), "game paused by upgrade");
        assertEq(_addrFromSlot(bytes32(uint256(21))), moonProxy, "Moon pointer changed");
        assertEq(vm.load(moonProxy, IMPL_SLOT), moonImplBefore, "Moon implementation changed");
        assertEq(referral.game(), PROXY, "referral Game wiring changed");
        assertEq(VeydriftReferralSystem(sourceAddress).game(), address(0), "source unfrozen");

        // Delegation-aware consumers must only be upgraded after Game exposes effectivePlayer.
        assertEq(IVeydriftDelegation(PROXY).effectivePlayer(address(this)), address(this));
        // This Game-only upgrade must not silently upgrade the unrelated Moon proxy.
        (,, bool orderingReady) = VeydriftGame(PROXY).fleetMissionEligibility(1);
        assertTrue(orderingReady, "upgrade must need no backfill or initialization");
        assertEq(VeydriftGame(PROXY).nextFleetId(), nextFleetBefore, "allocation boundary changed");
        (bool missionReadAfter, bytes memory latestMissionAfter) =
            PROXY.staticcall(abi.encodeWithSignature("fleetMission(uint256)", nextFleetBefore - 1));
        assertTrue(missionReadAfter);
        assertEq(
            keccak256(latestMissionAfter), keccak256(latestMissionBefore), "legacy mission changed"
        );
        assertEq(
            vm.load(PROXY, legacyRegistrationSlot),
            registrationBefore,
            "mission generation relabeled"
        );
    }
}
