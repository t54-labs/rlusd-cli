import type { NetworkEnvironment, ChainConfig } from "../types/index.js";

export interface NetworkPreset {
  chains: Record<string, ChainConfig>;
}

const MAINNET_PRESET: NetworkPreset = {
  chains: {
    xrpl: {
      websocket: "wss://xrplcluster.com/",
      json_rpc: "https://xrplcluster.com/",
    },
    ethereum: {
      rpc: "https://eth.llamarpc.com",
    },
    base: {
      rpc: "https://mainnet.base.org",
    },
    optimism: {
      rpc: "https://mainnet.optimism.io",
    },
  },
};

const TESTNET_PRESET: NetworkPreset = {
  chains: {
    xrpl: {
      websocket: "wss://s.altnet.rippletest.net:51233/",
      json_rpc: "https://s.altnet.rippletest.net:51234/",
    },
    ethereum: {
      rpc: "https://rpc.sepolia.org",
    },
    base: {
      rpc: "https://sepolia.base.org",
    },
    optimism: {
      rpc: "https://sepolia.optimism.io",
    },
  },
};

const DEVNET_PRESET: NetworkPreset = {
  chains: {
    xrpl: {
      websocket: "wss://s.devnet.rippletest.net:51233/",
      json_rpc: "https://s.devnet.rippletest.net:51234/",
    },
    ethereum: {
      rpc: "https://rpc.sepolia.org",
    },
    base: {
      rpc: "https://sepolia.base.org",
    },
    optimism: {
      rpc: "https://sepolia.optimism.io",
    },
  },
};

const PRESETS: Record<NetworkEnvironment, NetworkPreset> = {
  mainnet: MAINNET_PRESET,
  testnet: TESTNET_PRESET,
  devnet: DEVNET_PRESET,
};

export function getNetworkPreset(env: NetworkEnvironment): NetworkPreset {
  return PRESETS[env];
}

export function isValidNetwork(value: string): value is NetworkEnvironment {
  return ["mainnet", "testnet", "devnet"].includes(value);
}
