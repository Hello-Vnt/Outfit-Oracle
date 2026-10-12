// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title OutfitOracle
/// @notice Stores AI-styled looks (four wardrobe item ids plus the mood tags that produced them).
///         No tokens, no payments, no admin, no personal data.
contract OutfitOracle {
    struct Look {
        address owner;
        uint8 occasion; // 0 Work, 1 Date, 2 Brunch, 3 Party, 4 Travel, 5 Campus
        uint8 weather; // 0 Hot, 1 Rainy, 2 Mild, 3 Cool
        uint8 style; // 0 Minimal, 1 Romantic, 2 Street, 3 Vintage, 4 Sporty
        uint16[4] items; // catalog ids: top, bottom, shoes, accessory
        uint64 timestamp;
    }

    uint8 public constant OCCASION_COUNT = 6;
    uint8 public constant WEATHER_COUNT = 4;
    uint8 public constant STYLE_COUNT = 5;

    Look[] public looks;
    mapping(address => uint256[]) private _looksOf;

    event LookSaved(uint256 indexed id, address indexed owner, uint16[4] items);

    error InvalidOccasion();
    error InvalidWeather();
    error InvalidStyle();
    error InvalidItem();
    error LookNotFound();

    function saveLook(uint8 occasion, uint8 weather, uint8 style, uint16[4] calldata items)
        external
        returns (uint256 id)
    {
        if (occasion >= OCCASION_COUNT) revert InvalidOccasion();
        if (weather >= WEATHER_COUNT) revert InvalidWeather();
        if (style >= STYLE_COUNT) revert InvalidStyle();
        for (uint256 i = 0; i < 4; i++) {
            if (items[i] == 0) revert InvalidItem();
        }

        id = looks.length;
        looks.push(Look(msg.sender, occasion, weather, style, items, uint64(block.timestamp)));
        _looksOf[msg.sender].push(id);
        emit LookSaved(id, msg.sender, items);
    }

    function getLook(uint256 id) external view returns (Look memory) {
        if (id >= looks.length) revert LookNotFound();
        return looks[id];
    }

    function looksOf(address owner) external view returns (uint256[] memory) {
        return _looksOf[owner];
    }

    function totalLooks() external view returns (uint256) {
        return looks.length;
    }
}
