import { Command, InvalidArgumentError } from "commander";

export function subcommand(name: string, description: string): Command {
  return new Command(name)
    .description(description)
    .allowExcessArguments(false)
    .showHelpAfterError()
    .exitOverride();
}

export function positiveNumber(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidArgumentError("must be a positive number");
  }
  return value;
}
