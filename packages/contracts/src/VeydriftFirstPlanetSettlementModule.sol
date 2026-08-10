// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {VeydriftResourceReserves} from "./VeydriftResourceReserves.sol";
import {VeydriftFormulas} from "./libraries/VeydriftFormulas.sol";
import {VeydriftPlanetGeneration} from "./libraries/VeydriftPlanetGeneration.sol";

interface IVeydriftReferralSystem {
    function redeemReferralInvite(
        address invitee,
        bytes32 commitment,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable returns (address inviter);
}

interface IVeydriftPaidAllianceInviteSystem {
    function redeemPaidInvite(
        address invitee,
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (address purchaser, uint256 allianceId);
}

/// @notice Delegatecall target for first-planet settlement and referral settlement.
contract VeydriftFirstPlanetSettlementModule is VeydriftResourceReserves {
    address private immutable _referralSystem;

    constructor(address referralSystemAddress) VeydriftResourceReserves(address(0)) {
        _referralSystem = referralSystemAddress;
    }

    /// @dev Kept on the Game proxy ABI but delegated here to leave upgrade bytecode headroom.
    ///      UpgradeGame deploys this module together with each new Game implementation.
    function setRandomnessEngine(address nextRandomnessEngine) external onlyOwner {
        address oldRandomnessEngine = _randomnessEngine;
        _randomnessEngine = nextRandomnessEngine;
        emit RandomnessEngineUpdated(oldRandomnessEngine, nextRandomnessEngine);
    }

    function setMigrationSettlement(address nextMigrationSettlement) external onlyOwner {
        _migrationSettlement = nextMigrationSettlement;
    }

    function setGamePaused(bool paused) external onlyOwner {
        _gamePaused = paused ? 1 : 0;
    }

    function startPlanet() external payable returns (uint256 planetId) {
        planetId = _startPlanet(msg.sender, msg.value, address(0));
    }

    function startPlanetWithReferral(bytes32 commitment, uint8 v, bytes32 r, bytes32 s)
        external
        payable
        returns (uint256 planetId)
    {
        uint256 inviterReward = (startPrice * REFERRAL_INVITER_FEE_BPS) / BPS;
        address inviter = IVeydriftReferralSystem(_referralSystem)
        .redeemReferralInvite{value: inviterReward}(
            msg.sender, commitment, v, r, s
        );
        planetId = _startPlanet(msg.sender, msg.value, inviter);
    }

    function settleFirstPlanet() external payable returns (FirstPlanet memory settledPlanet) {
        uint256 planetId = _startPlanet(msg.sender, msg.value, address(0));
        return _firstPlanetFrom(planetId);
    }

    function settleFirstPlanetWithReferral(bytes32 commitment, uint8 v, bytes32 r, bytes32 s)
        external
        payable
        returns (FirstPlanet memory settledPlanet)
    {
        uint256 inviterReward = (startPrice * REFERRAL_INVITER_FEE_BPS) / BPS;
        address inviter = IVeydriftReferralSystem(_referralSystem)
        .redeemReferralInvite{value: inviterReward}(
            msg.sender, commitment, v, r, s
        );
        uint256 planetId = _startPlanet(msg.sender, msg.value, inviter);
        return _firstPlanetFrom(planetId);
    }

    function firstPlanetOf(address player) external view returns (FirstPlanet memory) {
        uint256 planetId = homePlanetOf[player];
        if (planetId == 0) revert NoFirstPlanet(player);
        return _firstPlanetFrom(planetId);
    }

    function previewFirstPlanet(address player) external view returns (FirstPlanet memory) {
        uint256 planetId = homePlanetOf[player];
        if (planetId != 0) return _firstPlanetFrom(planetId);
        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) =
            _previewFirstPlanet(player);
        return FirstPlanet({
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            settledAt: 0,
            settledBlock: 0
        });
    }

    /// @dev Kept behind the Game facade fallback to conserve its EIP-170-limited runtime size.
    function hasFirstPlanet(address player) external view returns (bool) {
        return homePlanetOf[player] != 0;
    }

    function startPlanetWithAllianceInvite(
        bytes32 commitment,
        uint64 expiresAt,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external payable returns (uint256 planetId) {
        // The alliance paid the separate recruitment fee when it bought this single-use invite.
        // A valid redemption therefore starts the invitee for free; accepting ETH here would be an
        // accidental second settlement charge.
        if (msg.value != 0 || _allianceSystem == address(0)) {
            revert BadStartPayment();
        }
        (address purchaser,) = IVeydriftPaidAllianceInviteSystem(_allianceSystem)
            .redeemPaidInvite(msg.sender, commitment, expiresAt, v, r, s);
        planetId = _startPlanetFromPaidAllianceInvite(msg.sender, purchaser);
    }

    function _startPlanetFromPaidAllianceInvite(address player, address inviter)
        private
        returns (uint256 planetId)
    {
        // `_startPlanet`'s payment argument is an authorization invariant for the regular paid
        // settlement entrypoints. The paid-invite entrypoint has already authenticated its separate
        // purchase through `redeemPaidInvite`, so it intentionally supplies the canonical price
        // without receiving a second payment from the invited wallet.
        planetId = _startPlanet(player, startPrice, inviter);
    }

    function _startPlanet(address player, uint256 payment, address inviter)
        private
        returns (uint256 planetId)
    {
        if (homePlanetOf[player] != 0) revert AlreadyStarted();
        if (payment != startPrice) revert BadStartPayment();
        _touchPlayer(player);

        Resources memory startingResources = Resources({metal: 500, crystal: 500, deuterium: 0});
        if (inviter != address(0)) {
            startingResources.metal *= 2;
            startingResources.crystal *= 2;
        }
        _increaseInternalResources(startingResources);

        planetId = nextPlanetId++;
        (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature) =
            _previewFirstPlanet(player);
        occupiedCoordinates[coordinateKey(galaxy, system, position)] = true;

        (uint16 metalMultiplier, uint16 crystalMultiplier, uint16 deuteriumMultiplier) =
            VeydriftFormulas.planetMultipliers(temperature, fields);

        homePlanetOf[player] = planetId;
        planetCountOf[player] = 1;
        _registerOwnedPlanet(player, planetId);
        _planets[planetId] = Planet({
            owner: player,
            galaxy: galaxy,
            system: system,
            position: position,
            fields: fields,
            temperature: temperature,
            metalMultiplierBps: metalMultiplier,
            crystalMultiplierBps: crystalMultiplier,
            deuteriumMultiplierBps: deuteriumMultiplier,
            lastSettledAt: uint64(block.timestamp),
            resources: startingResources
        });

        emit PlanetStarted(player, planetId, galaxy, system, position, fields, temperature);
        emit FirstPlanetSettled(
            player,
            planetId,
            galaxy,
            system,
            position,
            coordinateKey(galaxy, system, position),
            planetSeed(galaxy, system, position)
        );
        _emitPlanetSettled(planetId);
    }

    function _firstPlanetFrom(uint256 planetId) private view returns (FirstPlanet memory) {
        Planet storage planetRef = _planets[planetId];
        return FirstPlanet({
            galaxy: planetRef.galaxy,
            system: planetRef.system,
            position: planetRef.position,
            fields: planetRef.fields,
            temperature: planetRef.temperature,
            settledAt: planetRef.lastSettledAt,
            settledBlock: 0
        });
    }

    function _previewFirstPlanet(address player)
        private
        view
        returns (uint16 galaxy, uint16 system, uint8 position, uint16 fields, int16 temperature)
    {
        for (uint256 attempt = 0; attempt < 64; attempt++) {
            (galaxy, system, position, fields, temperature) =
                VeydriftPlanetGeneration.firstPlanetCandidate(
                    FIRST_PLANET_DOMAIN,
                    block.chainid,
                    player,
                    block.number,
                    block.timestamp,
                    block.prevrandao,
                    attempt,
                    MAX_GALAXY,
                    MAX_SYSTEM,
                    MAX_POSITION
                );
            if (!occupiedCoordinates[coordinateKey(galaxy, system, position)]) {
                return (galaxy, system, position, fields, temperature);
            }
        }
        revert CoordinatesExhausted();
    }

    function coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.coordinateKey(
            block.chainid, galaxy, system, position, MAX_GALAXY, MAX_SYSTEM, MAX_POSITION
        );
    }

    function planetSeed(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        return VeydriftPlanetGeneration.planetSeed(
            PLANET_SEED_DOMAIN,
            block.chainid,
            galaxy,
            system,
            position,
            MAX_GALAXY,
            MAX_SYSTEM,
            MAX_POSITION
        );
    }
}
