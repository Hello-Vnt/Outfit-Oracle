// Compiles contracts/OutfitOracle.sol and writes build/ artifacts.
// Usage (from the project root): npm --prefix tools install && node tools/compile.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import solc from 'solc';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'contracts/OutfitOracle.sol'), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'contracts/OutfitOracle.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    evmVersion: 'paris',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((e) => e.severity === 'error');
for (const e of output.errors || []) console.error(e.formattedMessage);
if (errors.length) process.exit(1);

const contract = output.contracts['contracts/OutfitOracle.sol'].OutfitOracle;
mkdirSync(join(root, 'build'), { recursive: true });
writeFileSync(join(root, 'build/OutfitOracle.standard-input.json'), JSON.stringify(input, null, 2) + '\n');
writeFileSync(
  join(root, 'build/OutfitOracle.json'),
  JSON.stringify({ compiler: solc.version(), abi: contract.abi, bytecode: '0x' + contract.evm.bytecode.object }, null, 2) + '\n',
);
console.log(`compiled with ${solc.version()} — ${contract.evm.bytecode.object.length / 2} bytes`);
