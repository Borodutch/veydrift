# Veydrift Game Art Assets

Veydrift gameplay assets, including the retained first-pass artwork and later style passes.

- `buildings/`: building artwork with visual tiers for upgrade progression.
- `ships/`: retained spacecraft artwork.
- `planets/`: planet temperature/resource variants.
- `concepts/`: original concept sheets used to establish the art direction.
- [manifest.json](manifest.json): asset metadata.
- `style-pass/generated/`: planet, building, ship, defense, research and moon previews.
- [Small Cargo direction anchor](style-pass/high-res/small-cargo-alive-fullship-2k.webp): high-resolution reference.

Check [gameAssets.ts](../../../src/gameAssets.ts) and the consuming components for actual UI mappings.
An asset's presence here does not mean it is used in the application. Keep filenames linked in these
notes so the documentation checker can detect removed or renamed assets.
