import { Command } from "commander";
import { logger } from "../utils/logger.js";

const BASH_COMPLETION = `###-begin-rlusd-completion-###
_rlusd_completion() {
  local cur prev commands
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  commands="config wallet balance gas-balance send bridge price market tx faucet xrpl eth"

  case "\${prev}" in
    rlusd)
      COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
      return 0
      ;;
    config)
      COMPREPLY=( $(compgen -W "get set" -- "\${cur}") )
      return 0
      ;;
    wallet)
      COMPREPLY=( $(compgen -W "generate import list address use" -- "\${cur}") )
      return 0
      ;;
    tx)
      COMPREPLY=( $(compgen -W "status history" -- "\${cur}") )
      return 0
      ;;
    faucet)
      COMPREPLY=( $(compgen -W "fund" -- "\${cur}") )
      return 0
      ;;
    xrpl)
      COMPREPLY=( $(compgen -W "trustline dex amm pathfind" -- "\${cur}") )
      return 0
      ;;
    trustline)
      COMPREPLY=( $(compgen -W "setup status remove" -- "\${cur}") )
      return 0
      ;;
    dex)
      COMPREPLY=( $(compgen -W "buy sell cancel orderbook" -- "\${cur}") )
      return 0
      ;;
    amm)
      COMPREPLY=( $(compgen -W "info deposit withdraw vote swap" -- "\${cur}") )
      return 0
      ;;
    eth)
      COMPREPLY=( $(compgen -W "approve allowance revoke defi" -- "\${cur}") )
      return 0
      ;;
    defi)
      COMPREPLY=( $(compgen -W "aave" -- "\${cur}") )
      return 0
      ;;
    aave)
      COMPREPLY=( $(compgen -W "supply withdraw borrow repay status" -- "\${cur}") )
      return 0
      ;;
    bridge)
      COMPREPLY=( $(compgen -W "estimate status history" -- "\${cur}") )
      return 0
      ;;
    --chain)
      COMPREPLY=( $(compgen -W "xrpl ethereum base optimism" -- "\${cur}") )
      return 0
      ;;
    --network)
      COMPREPLY=( $(compgen -W "mainnet testnet devnet" -- "\${cur}") )
      return 0
      ;;
    --output)
      COMPREPLY=( $(compgen -W "table json json-compact" -- "\${cur}") )
      return 0
      ;;
  esac
}
complete -F _rlusd_completion rlusd
###-end-rlusd-completion-###`;

const ZSH_COMPLETION = `###-begin-rlusd-zsh-completion-###
if type compdef &>/dev/null; then
  _rlusd() {
    local -a commands
    commands=(
      'config:Configuration management'
      'wallet:Wallet generation and management'
      'balance:Query RLUSD balance'
      'gas-balance:Show native token balances for gas'
      'send:Send RLUSD'
      'bridge:Cross-chain RLUSD bridge (Wormhole NTT)'
      'price:Show RLUSD price'
      'market:Market overview'
      'tx:Transaction queries'
      'faucet:Testnet faucet'
      'xrpl:XRPL-specific operations'
      'eth:Ethereum-specific operations'
    )
    _describe 'rlusd commands' commands
  }
  compdef _rlusd rlusd
fi
###-end-rlusd-zsh-completion-###`;

const FISH_COMPLETION = `###-begin-rlusd-fish-completion-###
complete -c rlusd -n '__fish_use_subcommand' -a config -d 'Configuration management'
complete -c rlusd -n '__fish_use_subcommand' -a wallet -d 'Wallet management'
complete -c rlusd -n '__fish_use_subcommand' -a balance -d 'Query RLUSD balance'
complete -c rlusd -n '__fish_use_subcommand' -a send -d 'Send RLUSD'
complete -c rlusd -n '__fish_use_subcommand' -a bridge -d 'Cross-chain bridge'
complete -c rlusd -n '__fish_use_subcommand' -a price -d 'RLUSD price'
complete -c rlusd -n '__fish_use_subcommand' -a market -d 'Market overview'
complete -c rlusd -n '__fish_use_subcommand' -a tx -d 'Transaction queries'
complete -c rlusd -n '__fish_use_subcommand' -a faucet -d 'Testnet faucet'
complete -c rlusd -n '__fish_use_subcommand' -a xrpl -d 'XRPL operations'
complete -c rlusd -n '__fish_use_subcommand' -a eth -d 'Ethereum operations'
###-end-rlusd-fish-completion-###`;

export function registerCompletionCommand(program: Command): void {
  program
    .command("completion")
    .description("Generate shell completion scripts")
    .option("-s, --shell <shell>", "shell type: bash | zsh | fish", "bash")
    .action((opts) => {
      switch (opts.shell) {
        case "bash":
          logger.raw(BASH_COMPLETION);
          break;
        case "zsh":
          logger.raw(ZSH_COMPLETION);
          break;
        case "fish":
          logger.raw(FISH_COMPLETION);
          break;
        default:
          logger.error(`Unsupported shell: ${opts.shell}. Supported: bash, zsh, fish`);
          process.exitCode = 1;
      }
    });
}
