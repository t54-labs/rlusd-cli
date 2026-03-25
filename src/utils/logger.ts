import chalk from "chalk";

let verboseEnabled = false;

export const logger = {
  setVerbose(enabled: boolean): void {
    verboseEnabled = enabled;
  },

  info(message: string): void {
    console.log(chalk.blue("ℹ"), message);
  },

  success(message: string): void {
    console.log(chalk.green("✔"), message);
  },

  warn(message: string): void {
    console.log(chalk.yellow("⚠"), message);
  },

  error(message: string): void {
    console.error(chalk.red("✖"), message);
  },

  dim(message: string): void {
    console.log(chalk.dim(message));
  },

  label(label: string, value: string): void {
    console.log(`${chalk.bold(label + ":")} ${value}`);
  },

  table(rows: Array<Record<string, string>>): void {
    console.table(rows);
  },

  raw(message: string): void {
    console.log(message);
  },

  debug(message: string): void {
    if (!verboseEnabled) return;
    console.log(chalk.gray("debug:"), chalk.gray(message));
  },
};
