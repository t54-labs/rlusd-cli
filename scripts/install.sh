#!/usr/bin/env bash
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

info()  { echo -e "${BOLD}${GREEN}[info]${RESET} $*"; }
warn()  { echo -e "${BOLD}${YELLOW}[warn]${RESET} $*"; }
error() { echo -e "${BOLD}${RED}[error]${RESET} $*"; exit 1; }

check_node() {
  if ! command -v node &>/dev/null; then
    error "Node.js is not installed. Please install Node.js 20+ from https://nodejs.org/"
  fi

  local version
  version=$(node -v | sed 's/^v//')
  local major
  major=$(echo "$version" | cut -d. -f1)

  if [ "$major" -lt 20 ]; then
    error "Node.js $version detected. RLUSD CLI requires Node.js 20 or later."
  fi

  info "Node.js $version detected"
}

check_npm() {
  if ! command -v npm &>/dev/null; then
    error "npm is not installed. It usually ships with Node.js."
  fi
  info "npm $(npm -v) detected"
}

install_cli() {
  info "Installing RLUSD CLI globally..."
  npm install -g @rlusd/cli

  if command -v rlusd &>/dev/null; then
    info "RLUSD CLI installed successfully!"
    echo ""
    echo -e "${BOLD}Quick start:${RESET}"
    echo "  rlusd config set --network testnet"
    echo "  rlusd wallet generate --chain xrpl"
    echo "  rlusd wallet generate --chain ethereum"
    echo "  rlusd faucet fund --chain xrpl"
    echo "  rlusd balance --all"
    echo ""
    echo "Run 'rlusd --help' for all available commands."
  else
    warn "Installation completed but 'rlusd' command not found in PATH."
    warn "You may need to restart your terminal or add npm global bin to your PATH."
  fi
}

main() {
  echo ""
  echo -e "${BOLD}RLUSD CLI Installer${RESET}"
  echo "Multi-chain CLI for Ripple USD (RLUSD) stablecoin operations"
  echo ""

  check_node
  check_npm
  install_cli
}

main
