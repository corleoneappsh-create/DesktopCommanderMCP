import { runThreeModeBenchmark } from './performance/run-three-modes.js';
await runThreeModeBenchmark({ enforce: true, repetitions: process.env.CI ? 5 : 7 });
console.log('PASS three-mode functional and performance comparison');
