import { totalmem } from 'node:os';

const GIB = 1024 ** 3;

// Publisher metadata, including LFS SHA-256 digests, verified October 27, 2026.
// Revisions are immutable inputs; onboarding never follows a moving model tag.
export const LOCAL_MODEL_CATALOG = Object.freeze([
  {
    id: 'qwen-coder-small', label: 'Qwen2.5 Coder 1.5B',
    description: 'Small experimental model; did not complete the observed Koto coding task.',
    repository: 'Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF',
    revision: 'f86cb2c1fa58255f8052cc32aeede1b7482d4361',
    filename: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
    bytes: 1117320768, sha256: 'cc324af070c2ecbfd324a30884d2f951a7ff756aba85cb811a6ec436933bb046',
    minimumMemoryBytes: 8 * GIB, license: 'Apache-2.0', contextSize: 4096,
  },
  {
    id: 'qwen-compact', label: 'Qwen3 4B',
    description: 'Compact general assistant; Koto coding tool use has not been verified.',
    repository: 'Qwen/Qwen3-4B-GGUF', revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
    filename: 'Qwen3-4B-Q4_K_M.gguf', bytes: 2497280256,
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    minimumMemoryBytes: 12 * GIB, license: 'Apache-2.0', contextSize: 4096,
  },
  {
    id: 'qwen-coder', label: 'Qwen2.5 Coder 7B',
    description: 'Larger experimental coding model; memory fit does not establish task quality.',
    repository: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF', revision: '13fb94bfda8c8cf22497dc57b78f391a9acb426a',
    filename: 'qwen2.5-coder-7b-instruct-q4_k_m.gguf', bytes: 4683073536,
    sha256: '509287f78cb4d4cf6b3843734733b914b2c158e43e22a7f4bf5e963800894d3c',
    minimumMemoryBytes: 16 * GIB, license: 'Apache-2.0', contextSize: 4096,
  },
].map(model => Object.freeze({ ...model,
  url: `https://huggingface.co/${model.repository}/resolve/${model.revision}/${model.filename}`,
  sourceUrl: `https://huggingface.co/${model.repository}/tree/${model.revision}`,
  licenseUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
})));

/** Memory recommendations are conservative selection guidance, not model qualification. */
export function listLocalModelChoices({ memoryBytes = totalmem(), availableDiskBytes } = {}) {
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes < 0 || availableDiskBytes !== undefined
    && (!Number.isSafeInteger(availableDiskBytes) || availableDiskBytes < 0)) {
    throw new TypeError('Model choices need non-negative safe-integer memory and optional free-disk bytes.');
  }
  return LOCAL_MODEL_CATALOG.map(model => {
    const reasons = [];
    if (memoryBytes < model.minimumMemoryBytes) reasons.push(`Recommended system memory: ${model.minimumMemoryBytes / GIB} GiB.`);
    if (availableDiskBytes !== undefined && availableDiskBytes < model.bytes + 256 * 1024 ** 2) {
      reasons.push('Not enough free storage for the model and installation reserve.');
    }
    return { ...model, suitable: reasons.length === 0, reasons };
  });
}

export const LLAMA_RELEASE = Object.freeze({
  version: 'b11935', commit: '7ecb57f7adbea2928aa468ad2aecf05b10725ad4',
  sourceUrl: 'https://github.com/ggml-org/llama.cpp/releases/tag/b11935',
  license: 'MIT',
});

export const LLAMA_RUNTIME_CATALOG = Object.freeze(Object.fromEntries([
  ['darwin-arm64', 'macos-arm64.tar.gz', 16331842, '091ff7288f405685d9f81548e0ca5c7e357b85c510c9deec799038bdb128172c'],
  ['darwin-x64', 'macos-x64.tar.gz', 12066889, '0e4b8236c206b4d8b5c13cb470f6871fbc9d27912d89b4960043b1bdee458c0d'],
  ['linux-arm64', 'ubuntu-arm64.tar.gz', 18253015, 'a1c7641fe04578f121d00836fdacea1f8ee58521560ec88f8d1c0b0cc25402b9'],
  ['linux-x64', 'ubuntu-x64.tar.gz', 22510930, '292803ab33750b8fee028df2b988b146f1f96d75ee7570c86f2eff01479bff55'],
  ['win32-arm64', 'win-cpu-arm64.zip', 12872705, 'fe9db0136dd8f7e39240c90cd1c1107ff59a8ef27c5517472e9d2c4c0dc9511f'],
  ['win32-x64', 'win-cpu-x64.zip', 24255768, 'd13e3d617a724eef10a533b18d1178b5292f7f1395965adf4e83b1ab4e9fc4b6'],
].map(([host, suffix, bytes, sha256]) => [host, Object.freeze({
  ...LLAMA_RELEASE, filename: `llama-b11935-bin-${suffix}`, bytes, sha256,
  url: `https://github.com/ggml-org/llama.cpp/releases/download/b11935/llama-b11935-bin-${suffix}`,
})])));
