# Changelog

Generated from the commit history. Every entry links the commit that made the
change, because the commit message is where the reasoning is — this file is an
index to it, not a replacement for it.
## Unreleased


### Build and CI

- Drop npm version updates — Dependabot cannot maintain bun.lock ([`9e9e849`](https://github.com/ovurrsl/plugin-warehouse/commit/9e9e849910c5b4bdce037ec6f5617860f468b824))
- CI, CodeQL, changelog automation and repo scaffolding ([`a5f6e2b`](https://github.com/ovurrsl/plugin-warehouse/commit/a5f6e2bc0b941a7885a726477374f045d6176d3f))

### Documentation

- Refresh generated README blocks [skip ci] ([`24384d4`](https://github.com/ovurrsl/plugin-warehouse/commit/24384d4b75921919b56d1221943fec969eaa11b6))
- Refresh generated README blocks [skip ci] ([`22275af`](https://github.com/ovurrsl/plugin-warehouse/commit/22275aff7d6d898b74e22dd2d58fa1aabb016227))
- Refresh generated README blocks [skip ci] ([`747ff61`](https://github.com/ovurrsl/plugin-warehouse/commit/747ff6195f406d235d6c2fc770e3e7e44fbb3e41))
- Refresh generated README blocks [skip ci] ([`5644d5c`](https://github.com/ovurrsl/plugin-warehouse/commit/5644d5cf4bf11c3bcb76e04f41545f44410135fc))
- Record the git+ssh requirement for a private repo ([`4bfd580`](https://github.com/ovurrsl/plugin-warehouse/commit/4bfd580a5fc1008fc5e0490e1c665567118e97bf))
- Record the host clipboard limitation and its patch ([`a308a25`](https://github.com/ovurrsl/plugin-warehouse/commit/a308a252c1d10520ac59463398f6849b5221f283))

### Features

- One node is one bay ([`699764c`](https://github.com/ovurrsl/plugin-warehouse/commit/699764c851faf6dc5b06162fcd4baf16e716e96a))
- Shift-select bays, and a panel that only shows what applies ([`533cc0c`](https://github.com/ovurrsl/plugin-warehouse/commit/533cc0c8ded4dfb8636100b430433b287c7c5d54))
- Delete one bay, not the whole run ([`189715c`](https://github.com/ovurrsl/plugin-warehouse/commit/189715cab00f5f84fd6422eef440e92a82e2f180))
- Click a bay, configure that bay — and the tunnel finally has a UI ([`553491e`](https://github.com/ovurrsl/plugin-warehouse/commit/553491eda482abbd88645d0fd3eeafaa367b762b))
- The beam's endplate was in the post, and one bay by default ([`f75ecb4`](https://github.com/ovurrsl/plugin-warehouse/commit/f75ecb455e3f30d904c03081abc24185a04b1cdd))
- Back to back is a count too, not a two-value pattern ([`79beac0`](https://github.com/ovurrsl/plugin-warehouse/commit/79beac06393d52c71e0c8f67bcae6fe64a55e4dd))
- Rows multiply inside the node, and a layout card to set them ([`8d39106`](https://github.com/ovurrsl/plugin-warehouse/commit/8d39106f8229b7dbb872b8d9d761c5fd6c4369fc))
- Per-bay skips, tunnels and level counts ([`1806fdd`](https://github.com/ovurrsl/plugin-warehouse/commit/1806fddfeac67d27abc4ef3c325bbace80b10d32))
- Drop the Shift row gesture — it collided with the host's snap key ([`6c4dca1`](https://github.com/ovurrsl/plugin-warehouse/commit/6c4dca1863db4bae9d74d84dfdaa237024a2adc1))
- One part list for 3D, 2D and the tests — and fix beams cutting through posts ([`450d11b`](https://github.com/ovurrsl/plugin-warehouse/commit/450d11bc6763b53f3356de58aa3f2c8e115ce918))
- Definition, tool, floorplan and inspector — the rack is placeable ([`d79bfba`](https://github.com/ovurrsl/plugin-warehouse/commit/d79bfbac0b968df5e1f34f4e0acbb8198216dba3))
- Tidy the occupancy type guard ([`7e4cfda`](https://github.com/ovurrsl/plugin-warehouse/commit/7e4cfda5c5e7035fee0ad338dfb3486f463b6805))
- Renderer, ghost stock, and a self-checking cache key ([`90efce5`](https://github.com/ovurrsl/plugin-warehouse/commit/90efce5f39b4a85c9073843bf93fc1d0d34641cb))
- Merged geometry, shared per shape, with a far tier ([`ed86fe0`](https://github.com/ovurrsl/plugin-warehouse/commit/ed86fe0fe528d97334491d7fa310cd2925aedfeb))
- Picking levels, containers, and a decision on rowCount ([`f5fa15c`](https://github.com/ovurrsl/plugin-warehouse/commit/f5fa15cc9a72dc2d5f9867905eca620d155ba936))
- Double-deep positions and pallet support bars ([`958659c`](https://github.com/ovurrsl/plugin-warehouse/commit/958659c461543b6410356236647ce1991091e695))
- Encode the catalogue and EN 15620 data as tested tables ([`e4658b9`](https://github.com/ovurrsl/plugin-warehouse/commit/e4658b9b15df5451bfed2f8e0cf1364c3ae1266a))
- Schema and slot geometry for warehouse:pallet-rack ([`f66e3ef`](https://github.com/ovurrsl/plugin-warehouse/commit/f66e3ef4b249191e75e91eddaaec1ac90a8bd712))
- Warehouse:pallet — port the EPAL geometry with its defects fixed ([`217c0dd`](https://github.com/ovurrsl/plugin-warehouse/commit/217c0dd83fbe2aa438bdff518dcf9b28bbc37ccd))
- Rewrite against the plugin API v1 contract ([`af9ffbd`](https://github.com/ovurrsl/plugin-warehouse/commit/af9ffbd7e2051ee50e54848ed769a8023eb2ce14))

### Fixes

- The bay panel crashed — trailingSection is rendered with no props ([`162907b`](https://github.com/ovurrsl/plugin-warehouse/commit/162907b821e973db98a2417f65df11243c889eaf))
- Place pallets on the surface, and refuse overlapping drops ([`925252b`](https://github.com/ovurrsl/plugin-warehouse/commit/925252b983493bcc80809094aedfcb7f12025fa6))
- Render the rail panel as a plain container, not inspector chrome ([`210a7ed`](https://github.com/ovurrsl/plugin-warehouse/commit/210a7edccfec36ea0e47ff5022cab52f75a65b2c))
- Style the panel without depending on the host's Tailwind scan ([`158a158`](https://github.com/ovurrsl/plugin-warehouse/commit/158a158b5b2ef09438d6d75e12864fb1a21d80f5))

### Other

- Match built-in placement behaviour when first dropping a pallet ([`e693b0c`](https://github.com/ovurrsl/plugin-warehouse/commit/e693b0c035f03c5f56ea4601b571338b9a91f6ad))
- Remove geometry and texture caches to fix WebGPU disposal bugs ([`4a3df73`](https://github.com/ovurrsl/plugin-warehouse/commit/4a3df73b9ce10b7be85f18f721a5808b10e29cab))
- Fix geometry disposal issue causing pallets to disappear ([`03cb106`](https://github.com/ovurrsl/plugin-warehouse/commit/03cb1060dad3d79d3ca2ba44b875ceb1b451f60e))
- Bring over all objects and panel view from previous version ([`49c456b`](https://github.com/ovurrsl/plugin-warehouse/commit/49c456b2217488cb4e53c8193b8fd42e5731a16c))
- Memoize definitionDefaults to fix infinite re-render loop ([`2f90156`](https://github.com/ovurrsl/plugin-warehouse/commit/2f90156269a085ce95f569bda47c4735c613ba68))
- Fix capabilities undefined error ([`881e5f4`](https://github.com/ovurrsl/plugin-warehouse/commit/881e5f4f5ab689c3eaeedefc67651b50b70474df))
- Fix import paths ([`97f81a3`](https://github.com/ovurrsl/plugin-warehouse/commit/97f81a3f76d3ee4a740900a4b49e38f26d1951b9))
- Copy missing components for tools ([`09fa33f`](https://github.com/ovurrsl/plugin-warehouse/commit/09fa33ff83757d2f190b45fe535d1a1f739f5cb0))
- Port euro pallet ([`636c81b`](https://github.com/ovurrsl/plugin-warehouse/commit/636c81be53e2d2b792c90108c7374dd1f73be819))
- Add schemaVersion ([`4ac9ec0`](https://github.com/ovurrsl/plugin-warehouse/commit/4ac9ec055808493241857588639b7930e25112ce))
- Fix schema and jsx ([`e5fa603`](https://github.com/ovurrsl/plugin-warehouse/commit/e5fa6038dcb399569e00e14e6cb6b37af0616d7f))
- Initial commit of warehouse plugin ([`5eb1076`](https://github.com/ovurrsl/plugin-warehouse/commit/5eb107697e8bd21a9cbd2aab2a72be02ed8adf04))

### Tests

- Test simple red material ([`b611bce`](https://github.com/ovurrsl/plugin-warehouse/commit/b611bceef6a7c685834a704f355dfb673015bb52))

