export const RLUSD_XRPL_ISSUER = "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De";
export const RLUSD_XRPL_CURRENCY = "RLUSD";
export const RLUSD_XRPL_CURRENCY_HEX = "524C555344000000000000000000000000000000";

export const RLUSD_ETH_CONTRACT = "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD";
export const RLUSD_ETH_DECIMALS = 18;

export const CHAINLINK_RLUSD_USD_ORACLE = "0x26C46B7aD0012cA71F2298ada567dC9Af14E7f2A";

export const AAVE_V3_POOL_ETHEREUM = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";

export const CONFIG_DIR = ".config/rlusd-cli";
export const CONFIG_FILE = "config.yml";
export const WALLETS_DIR = "wallets";

export const XRPL_TESTNET_FAUCET = "https://faucet.altnet.rippletest.net/accounts";
export const XRPL_DEVNET_FAUCET = "https://faucet.devnet.rippletest.net/accounts";

export const UNISWAP_V3_SWAP_ROUTER = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
export const UNISWAP_V3_QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

export const DEFAULT_PRICE_API = {
  provider: "coingecko",
  base_url: "https://api.coingecko.com/api/v3",
};

export const DEFAULT_CONTRACTS: Record<string, { uniswap_router?: string; uniswap_quoter?: string; aave_v3_pool?: string }> = {
  ethereum: {
    uniswap_router: UNISWAP_V3_SWAP_ROUTER,
    uniswap_quoter: UNISWAP_V3_QUOTER_V2,
    aave_v3_pool: AAVE_V3_POOL_ETHEREUM,
  },
};

export const DEFAULT_FAUCET = {
  xrpl_testnet: XRPL_TESTNET_FAUCET,
  xrpl_devnet: XRPL_DEVNET_FAUCET,
};

export const WELL_KNOWN_TOKENS: Record<string, { address: string; decimals: number; name: string }> = {
  WETH:  { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, name: "Wrapped Ether" },
  USDC:  { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  name: "USD Coin" },
  USDT:  { address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  name: "Tether USD" },
  DAI:   { address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, name: "Dai Stablecoin" },
  WBTC:  { address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  name: "Wrapped BTC" },
  RLUSD: { address: "0x8292Bb45bf1Ee4d140127049757C2E0fF06317eD", decimals: 18, name: "Ripple USD" },
};
