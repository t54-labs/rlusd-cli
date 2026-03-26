// Verified against the CurveStableSwapNG source matched to
// 0xd001ae433f254283fece51d4acce8c53263aa186 on Etherscan.
export const CURVE_STABLESWAP_POOL_ABI = [
  {
    type: "function",
    name: "get_dy",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "dx", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "exchange",
    inputs: [
      { name: "i", type: "int128" },
      { name: "j", type: "int128" },
      { name: "_dx", type: "uint256" },
      { name: "_min_dy", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "add_liquidity",
    inputs: [
      { name: "_amounts", type: "uint256[]" },
      { name: "_min_mint_amount", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "calc_token_amount",
    inputs: [
      { name: "_amounts", type: "uint256[]" },
      { name: "_is_deposit", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "calc_withdraw_one_coin",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "int128" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "remove_liquidity_one_coin",
    inputs: [
      { name: "_burn_amount", type: "uint256" },
      { name: "i", type: "int128" },
      { name: "_min_received", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
] as const;
