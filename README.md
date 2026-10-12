# OutfitOracle

Tell the Oracle the occasion, the weather and your style. AI styles a full look (top, bottom, shoes, accessory) from a curated wardrobe, and you save your favourite looks on BOT Chain.

*For fun and inspiration. No tokens, no payments, no admin, no personal data.*

## Status

| | |
|---|---|
| Live site | https://hello-vnt.github.io/Outfit-Oracle/ |
| AI proxy | _not deployed yet_ |
| Contract (BOT Chain mainnet, chain ID 677) | [`0x60212D0c456F2984De30Da507B6Bb0c9A13f0655`](https://scan.botchain.ai/address/0x60212D0c456F2984De30Da507B6Bb0c9A13f0655) |
| Contract (testnet, chain ID 968) | _not deployed yet_ |

## Project layout

- `index.html` — the whole frontend (ethers.js v6 from CDN, no build step)
- `catalog.json` + `images/` — the 36-item wardrobe, its photos and the home page hero (credits in `images/CREDITS.md`)
- `contracts/OutfitOracle.sol` — the contract (Solidity ^0.8.20)
- `deploy.html` — one-click deploy from MetaMask
- `build/` — compiled ABI and bytecode, plus the standard JSON input for explorer verification
- `worker/` — the AI proxy (Cloudflare Worker, `POST /style`)
- `tools/` — scripts that compile the contract and test it

## Run locally

```bash
python3 -m http.server 4578
```

Then open http://localhost:4578. Two things are switched off until you configure them, and the site stays fully usable without either:

- **No contract address** → *preview mode*: looks are saved in this browser's localStorage, so every screen can be reviewed before deploying.
- **No AI proxy URL** → looks come from the built-in rule-based picker and carry a small "classic pick" label.

Both are set in the `CONFIG` block at the top of the script in `index.html`.

## 1. Deploy the contract

Compiled with Solidity 0.8.20, optimizer 200 runs, EVM `paris`.

1. Run the site locally and open http://localhost:4578/deploy.html in a browser with MetaMask.
2. Click **Deploy to Testnet (968)**, confirm in MetaMask, then try the app at http://localhost:4578/?net=testnet. On localhost the app picks up the address you just deployed.
3. Click **Deploy to Mainnet (677)**.
4. Paste each address into the matching `contract: ''` field in `CONFIG.networks` in `index.html`, and into the Status table above.

Or use Remix: paste `contracts/OutfitOracle.sol` into https://remix.ethereum.org, compile with 0.8.20 and EVM version `paris`, deploy with *Injected Provider – MetaMask*.

| Network | Chain ID | RPC | Explorer |
|---|---|---|---|
| Testnet | 968 | https://rpc.bohr.life | https://scan.bohr.life |
| Mainnet | 677 | https://rpc.botchain.ai | https://scan.botchain.ai |

To verify the source on the explorer, use "Standard JSON input" with `build/OutfitOracle.standard-input.json` and compiler `v0.8.20+commit.a1b79de6`.

## 2. Deploy the AI proxy

The Worker holds the Anthropic API key as a secret, so it never reaches the browser.

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Before deploying, edit `worker/wrangler.toml`:

- `ALLOWED_ORIGINS` — your live site origin(s), comma-separated, no trailing slash (for example `https://outfitoracle.example,https://you.github.io`). Requests from any other origin get a 403.
- `MODEL` — the Claude model that styles the look. The default is `claude-opus-5-5`; `claude-haiku-5-5` is the cheapest option.

Then paste the Worker URL into `CONFIG.proxyUrl` in `index.html`.

The Worker limits each IP to 20 requests per hour. By default the count is kept in memory per Worker instance; bind a KV namespace as `RATE_KV` (see the comment in `wrangler.toml`) to make it hold across instances.

## 3. Publish the site

GitHub Pages serves the `gh-pages` branch, so publish with `git push origin main:gh-pages` after pushing `main` (or switch the Pages source to `main` under Settings → Pages). For a custom domain, add it under Settings → Pages, which creates the `CNAME` file. Remember to add the final origin to `ALLOWED_ORIGINS` and redeploy the Worker.

## How it works

- The site sends the occasion, weather, style and the catalog item list to `POST /style`. The model must answer with JSON `{ items: [id, id, id, id], note: "..." }` and may only use ids from the catalog, so every result shows a real card.
- The answer is validated in the Worker and again in the browser: ids must exist and cover one top, one bottom, one pair of shoes and one accessory. If the call fails, is invalid, or takes longer than 8 seconds, the rule-based picker takes over.
- `saveLook` stores the three mood tags and the four item ids and emits `LookSaved`. The styling note is not stored on-chain; shared looks show a short caption generated from the tags.
- `?look=N` loads a look straight from the contract over the public RPC, no wallet needed. Look ids start at 0.
- "Saved Looks" lists what the connected wallet has saved, newest first.

## Changing the wardrobe

Edit `catalog.json` directly: each item has an id, name, type, colour, style / weather / occasion tags and an `image` path. Photos live in `images/` as 3:4 portrait JPEGs (900 × 1200). The current photos are free-licence Unsplash photos; add a line to `images/CREDITS.md` when you swap one. Item ids are stored on-chain, so add new items at the end rather than renumbering.

## Tests

```bash
npm --prefix tools install
node tools/compile.mjs && node tools/test-contract.mjs   # contract, on an in-memory chain
npm --prefix worker install && npm --prefix worker test   # proxy, with the model stubbed
```
