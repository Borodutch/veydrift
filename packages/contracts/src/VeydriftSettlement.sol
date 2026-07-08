// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

/// @notice Compact first-planet settlement contract for the Veydrift Base Sepolia MVP.
contract VeydriftSettlement is Initializable, OwnableUpgradeable, UUPSUpgradeable {
    struct FirstPlanet {
        uint16 galaxy;
        uint16 system;
        uint8 position;
        bytes32 coordinateKey;
        bytes32 planetSeed;
        uint64 settledAt;
        uint64 settledBlock;
    }

    uint16 public constant GALAXY_COUNT = 9;
    uint16 public constant SYSTEM_COUNT = 499;
    uint8 public constant PLANET_SLOTS = 15;
    uint32 public constant TOTAL_COORDINATES =
        uint32(GALAXY_COUNT) * uint32(SYSTEM_COUNT) * uint32(PLANET_SLOTS);

    bytes32 public constant FIRST_PLANET_DOMAIN = keccak256("veydrift.first-planet.v1");
    bytes32 public constant COORDINATE_DOMAIN = keccak256("veydrift.coordinate.v1");
    bytes32 public constant PLANET_DOMAIN = keccak256("veydrift.planet.v1");

    address public deployer;
    bytes32 public universeSalt;

    mapping(address player => bool settled) public hasFirstPlanet;
    mapping(address player => FirstPlanet planet) private _firstPlanets;
    mapping(bytes32 coordinateKey => address owner) public coordinateOwner;

    event FirstPlanetSettled(
        address indexed player,
        uint16 indexed galaxy,
        uint16 indexed system,
        uint8 position,
        bytes32 coordinateKey,
        bytes32 planetSeed
    );

    error AlreadySettled(address player);
    error InvalidCoordinate(uint16 galaxy, uint16 system, uint8 position);
    error NoFirstPlanet(address player);
    error UniverseFull();

    constructor(bytes32 initialUniverseSalt) {
        initialize(msg.sender, initialUniverseSalt);
        _disableInitializers();
    }

    function initialize(address initialOwner, bytes32 initialUniverseSalt) public initializer {
        __Ownable_init(initialOwner);
        deployer = msg.sender;
        universeSalt = initialUniverseSalt;
    }

    function settleFirstPlanet() external returns (FirstPlanet memory settledPlanet) {
        if (hasFirstPlanet[msg.sender]) {
            revert AlreadySettled(msg.sender);
        }

        settledPlanet = _deriveAvailableFirstPlanet(msg.sender);
        settledPlanet.settledAt = uint64(block.timestamp);
        settledPlanet.settledBlock = uint64(block.number);

        hasFirstPlanet[msg.sender] = true;
        _firstPlanets[msg.sender] = settledPlanet;
        coordinateOwner[settledPlanet.coordinateKey] = msg.sender;

        emit FirstPlanetSettled(
            msg.sender,
            settledPlanet.galaxy,
            settledPlanet.system,
            settledPlanet.position,
            settledPlanet.coordinateKey,
            settledPlanet.planetSeed
        );
    }

    function firstPlanetOf(address player) external view returns (FirstPlanet memory planet) {
        if (!hasFirstPlanet[player]) {
            revert NoFirstPlanet(player);
        }

        return _firstPlanets[player];
    }

    function previewFirstPlanet(address player) external view returns (FirstPlanet memory planet) {
        if (hasFirstPlanet[player]) {
            return _firstPlanets[player];
        }

        return _deriveAvailableFirstPlanet(player);
    }

    function ownerOfCoordinate(uint16 galaxy, uint16 system, uint8 position)
        external
        view
        returns (address)
    {
        return coordinateOwner[coordinateKey(galaxy, system, position)];
    }

    function coordinateKey(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        _validateCoordinate(galaxy, system, position);
        return keccak256(
            abi.encode(COORDINATE_DOMAIN, block.chainid, universeSalt, galaxy, system, position)
        );
    }

    function planetSeed(uint16 galaxy, uint16 system, uint8 position)
        public
        view
        returns (bytes32)
    {
        _validateCoordinate(galaxy, system, position);
        return keccak256(abi.encode(PLANET_DOMAIN, universeSalt, galaxy, system, position));
    }

    function _deriveAvailableFirstPlanet(address player)
        private
        view
        returns (FirstPlanet memory planet)
    {
        bytes32 entropy = keccak256(
            abi.encode(
                FIRST_PLANET_DOMAIN,
                universeSalt,
                player,
                block.chainid,
                block.number,
                block.timestamp,
                block.prevrandao
            )
        );
        uint256 startIndex = uint256(entropy) % TOTAL_COORDINATES;

        for (uint32 attempt = 0; attempt < TOTAL_COORDINATES; attempt++) {
            (uint16 galaxy, uint16 system, uint8 position) =
                _coordinatesFromIndex((startIndex + attempt) % TOTAL_COORDINATES);
            bytes32 key = coordinateKey(galaxy, system, position);

            if (coordinateOwner[key] == address(0)) {
                return FirstPlanet({
                    galaxy: galaxy,
                    system: system,
                    position: position,
                    coordinateKey: key,
                    planetSeed: planetSeed(galaxy, system, position),
                    settledAt: 0,
                    settledBlock: 0
                });
            }
        }

        revert UniverseFull();
    }

    function _coordinatesFromIndex(uint256 index)
        private
        pure
        returns (uint16 galaxy, uint16 system, uint8 position)
    {
        uint256 slotIndex = index % PLANET_SLOTS;
        uint256 systemIndex = (index / PLANET_SLOTS) % SYSTEM_COUNT;
        uint256 galaxyIndex = index / (uint256(PLANET_SLOTS) * uint256(SYSTEM_COUNT));

        // forge-lint: disable-next-line(unsafe-typecast)
        galaxy = uint16(galaxyIndex + 1);
        // forge-lint: disable-next-line(unsafe-typecast)
        system = uint16(systemIndex + 1);
        // forge-lint: disable-next-line(unsafe-typecast)
        position = uint8(slotIndex + 1);
    }

    function _validateCoordinate(uint16 galaxy, uint16 system, uint8 position) private pure {
        if (
            galaxy == 0 || galaxy > GALAXY_COUNT || system == 0 || system > SYSTEM_COUNT
                || position == 0 || position > PLANET_SLOTS
        ) {
            revert InvalidCoordinate(galaxy, system, position);
        }
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
