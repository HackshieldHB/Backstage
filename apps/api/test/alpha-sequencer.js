const Sequencer = require('@jest/test-sequencer').default;

/** Deterministic alphabetical order — used to reproduce/prevent order-dependent failures. */
class AlphabeticalSequencer extends Sequencer {
  sort(tests) {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
}

module.exports = AlphabeticalSequencer;
