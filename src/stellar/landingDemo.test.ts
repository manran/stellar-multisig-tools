import assert from 'node:assert/strict';
import test from 'node:test';
import { LANDING_SCENARIO_COUNT, landingDemoScenarioForCycle } from './landingDemo.js';

const AMOUNT_ASSET_PAIR_COUNT = 30;
const TEST_SEEDS = [0, 17, 0x7f31a9c2, 0xffffffff] as const;

test('landing demo derives a large combination space instead of a fixed scenario list', () => {
  assert.equal(LANDING_SCENARIO_COUNT, 5_040);

  const fingerprints = new Set(
    Array.from({ length: 128 }, (_, cycle) => JSON.stringify(landingDemoScenarioForCycle(cycle))),
  );
  assert.equal(fingerprints.size, 128);
});

test('seeded landing sequences visit every combination before repeating', () => {
  for (const seed of TEST_SEEDS) {
    const fingerprints = new Set(
      Array.from({ length: LANDING_SCENARIO_COUNT }, (_, cycle) => JSON.stringify(landingDemoScenarioForCycle(cycle, seed))),
    );
    assert.equal(fingerprints.size, LANDING_SCENARIO_COUNT, `seed ${seed}`);
  }
});

test('every 30-cycle window presents each amount and asset pair exactly once', () => {
  for (const seed of TEST_SEEDS) {
    for (let block = 0; block < LANDING_SCENARIO_COUNT / AMOUNT_ASSET_PAIR_COUNT; block += 1) {
      const pairs = new Set<string>();
      for (let slot = 0; slot < AMOUNT_ASSET_PAIR_COUNT; slot += 1) {
        const scenario = landingDemoScenarioForCycle(block * AMOUNT_ASSET_PAIR_COUNT + slot, seed);
        pairs.add(`${scenario.amount} ${scenario.asset}`);
      }
      assert.equal(pairs.size, AMOUNT_ASSET_PAIR_COUNT, `seed ${seed}, block ${block}`);
    }
  }
});

test('adjacent landing cycles change every visible scenario dimension', () => {
  for (const seed of TEST_SEEDS) {
    let previous = landingDemoScenarioForCycle(-1, seed);
    for (let cycle = 0; cycle < LANDING_SCENARIO_COUNT; cycle += 1) {
      const current = landingDemoScenarioForCycle(cycle, seed);
      assert.notEqual(current.amount, previous.amount, `amount repeated at seed ${seed}, cycle ${cycle}`);
      assert.notEqual(current.asset, previous.asset, `asset repeated at seed ${seed}, cycle ${cycle}`);
      assert.notEqual(current.treasury, previous.treasury, `treasury repeated at seed ${seed}, cycle ${cycle}`);
      assert.notEqual(current.destination, previous.destination, `destination repeated at seed ${seed}, cycle ${cycle}`);
      assert.notDeepEqual(current.signedIndexes, previous.signedIndexes, `signing pair repeated at seed ${seed}, cycle ${cycle}`);
      previous = current;
    }
  }
});

test('different landing seeds change the starting sequence while remaining deterministic', () => {
  const first = Array.from({ length: 6 }, (_, cycle) => landingDemoScenarioForCycle(cycle, 17));
  const same = Array.from({ length: 6 }, (_, cycle) => landingDemoScenarioForCycle(cycle, 17));
  const other = Array.from({ length: 6 }, (_, cycle) => landingDemoScenarioForCycle(cycle, 0x9e3779b9));

  assert.deepEqual(first, same);
  assert.notDeepEqual(first, other);
});

test('every landing demo scenario keeps Alice, Bob, Carol in fixed order', () => {
  for (let cycle = 0; cycle < 128; cycle += 1) {
    assert.deepEqual(landingDemoScenarioForCycle(cycle, 0x24f3a1).signers, ['Alice', 'Bob', 'Carol']);
  }
});

test('landing demo varies only which two of Alice, Bob, Carol satisfy quorum', () => {
  const pairs = new Set<string>();
  for (let cycle = 0; cycle < 128; cycle += 1) {
    const scenario = landingDemoScenarioForCycle(cycle, 0x5a17c9);
    assert.equal(new Set(scenario.signedIndexes).size, 2);
    assert.equal(scenario.signedIndexes.every((index) => index >= 0 && index < 3), true);
    pairs.add(scenario.signedIndexes.join(','));
  }
  assert.deepEqual([...pairs].sort(), ['0,1', '0,2', '1,2']);
});
