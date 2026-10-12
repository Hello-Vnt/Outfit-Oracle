// Runs the compiled contract on an in-memory chain and checks the save → read round trip.
// Usage (from the project root): node tools/compile.mjs && node tools/test-contract.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { abi, bytecode } = JSON.parse(readFileSync(join(root, 'build/OutfitOracle.json'), 'utf8'));

const provider = new BrowserProvider(ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'merge' } }));
const [alice, bob] = await Promise.all([provider.getSigner(0), provider.getSigner(1)]);

const contract = await (await new ContractFactory(abi, bytecode, alice).deploy()).waitForDeployment();

const receipt = await (await contract.saveLook(2, 1, 1, [3, 14, 24, 35])).wait();
const saved = receipt.logs.map((l) => contract.interface.parseLog(l)).find((l) => l?.name === 'LookSaved');
assert.equal(saved.args.id, 0n);
assert.equal(saved.args.owner, alice.address);
console.log(`saveLook gas: ${receipt.gasUsed}`);

await (await contract.connect(bob).saveLook(5, 3, 4, [7, 17, 27, 32])).wait();
await (await contract.saveLook(0, 0, 0, [1, 11, 19, 28])).wait();

const look = await contract.getLook(0);
assert.equal(look.owner, alice.address);
assert.deepEqual([look.occasion, look.weather, look.style], [2n, 1n, 1n]);
assert.deepEqual([...look.items], [3n, 14n, 24n, 35n]);
assert.ok(look.timestamp > 0n);

assert.deepEqual([...(await contract.looksOf(alice.address))], [0n, 2n]);
assert.deepEqual([...(await contract.looksOf(bob.address))], [1n]);
assert.equal(await contract.totalLooks(), 3n);

const reverts = async (call, name) => {
  await assert.rejects(call, (e) => e.revert?.name === name, `expected ${name}`);
};
await reverts(contract.saveLook.staticCall(6, 0, 0, [1, 2, 3, 4]), 'InvalidOccasion');
await reverts(contract.saveLook.staticCall(0, 4, 0, [1, 2, 3, 4]), 'InvalidWeather');
await reverts(contract.saveLook.staticCall(0, 0, 5, [1, 2, 3, 4]), 'InvalidStyle');
await reverts(contract.saveLook.staticCall(0, 0, 0, [1, 0, 3, 4]), 'InvalidItem');
await reverts(contract.getLook(3), 'LookNotFound');

console.log('contract tests passed');
