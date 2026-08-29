import { pathToFileURL } from "node:url";

import {
  TABLES_TO_CLEAR,
  TABLES_TO_KEEP,
  clearApplicationData,
  resolveDemoDataPaths,
  type DemoDataPaths,
} from "./clear.js";
import {
  DEFAULT_DEMO_DATA_SEED,
  generateDemoData,
  type GenerateDemoDataSummary,
} from "./generate.js";

const HELP = `Usage:
  npm run demo-data:generate -- --months=6 --seed=123 --confirm-reset
  npm run demo-data:clear -- --confirm-reset

Commands:
  generate             Clear existing application data, then generate demo data
  clear                Clear application data and daily Markdown files

Options:
  --months=<1-24>      Number of months to generate (default: 6)
  --seed=<integer>     Deterministic random seed (default: ${DEFAULT_DEMO_DATA_SEED})
  --confirm-reset      Required destructive-operation confirmation
  --help               Show this help
`;

interface CliOptions {
  readonly args?: readonly string[];
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly now?: Date;
  readonly stdout?: (message: string) => void;
  readonly stderr?: (message: string) => void;
}

interface ParsedArguments {
  readonly command: "clear" | "generate";
  readonly months: number;
  readonly seed: number;
  readonly confirmReset: boolean;
  readonly help: boolean;
}

export async function runDemoDataCli(options: CliOptions = {}): Promise<number> {
  const args = options.args ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const now = options.now ?? new Date();
  const stdout = options.stdout ?? console.log;
  const stderr = options.stderr ?? console.error;

  try {
    if (args.length === 1 && args[0] === "--help") {
      stdout(HELP);
      return 0;
    }

    const parsed = parseArguments(args);
    if (parsed.help) {
      stdout(HELP);
      return 0;
    }

    assertDestructiveResetAllowed(environment, parsed.confirmReset);
    const paths = resolveDemoDataPaths(cwd, environment);
    stdout(formatPreflight(parsed.command, paths));

    if (parsed.command === "clear") {
      const result = await clearApplicationData(paths);
      if (!result.databaseExisted) stdout("Database does not exist; no database rows needed clearing.");
      stdout("Demo/application data cleared successfully");
      return 0;
    }

    const summary = await generateDemoData({
      paths,
      months: parsed.months,
      seed: parsed.seed,
      now,
    });
    stdout(formatSummary(summary));
    return 0;
  } catch (error) {
    stderr(`[demo-data] ERROR: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

export function assertDestructiveResetAllowed(
  environment: Readonly<Record<string, string | undefined>>,
  confirmReset: boolean,
): void {
  if (environment.ALLOW_DESTRUCTIVE_DEMO_DATA_RESET !== "true") {
    throw new Error(
      "Destructive demo-data reset is disabled. Set ALLOW_DESTRUCTIVE_DEMO_DATA_RESET=true and pass --confirm-reset.",
    );
  }
  if (!confirmReset) {
    throw new Error("Destructive demo-data reset requires --confirm-reset.");
  }
}

function parseArguments(args: readonly string[]): ParsedArguments {
  const [commandValue, ...flags] = args;
  if (commandValue !== "generate" && commandValue !== "clear") {
    throw new Error(`Expected command "generate" or "clear".\n\n${HELP}`);
  }

  let months = 6;
  let seed = DEFAULT_DEMO_DATA_SEED;
  let confirmReset = false;
  let help = false;
  let monthsSeen = false;
  let seedSeen = false;

  for (const flag of flags) {
    if (flag === "--confirm-reset") {
      confirmReset = true;
    } else if (flag === "--help") {
      help = true;
    } else if (flag.startsWith("--months=")) {
      if (monthsSeen) throw new Error("--months can only be provided once.");
      months = parseIntegerFlag(flag, "--months");
      monthsSeen = true;
    } else if (flag.startsWith("--seed=")) {
      if (seedSeen) throw new Error("--seed can only be provided once.");
      seed = parseIntegerFlag(flag, "--seed");
      seedSeen = true;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  if (commandValue === "clear" && (monthsSeen || seedSeen)) {
    throw new Error("--months and --seed are only valid for the generate command.");
  }
  if (!Number.isInteger(months) || months < 1 || months > 24) {
    throw new Error("--months must be an integer between 1 and 24.");
  }

  return { command: commandValue, months, seed, confirmReset, help };
}

function parseIntegerFlag(flag: string, name: string): number {
  const value = flag.slice(name.length + 1);
  if (!/^-?\d+$/u.test(value)) throw new Error(`${name} must be an integer.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer.`);
  return parsed;
}

function formatPreflight(command: "clear" | "generate", paths: DemoDataPaths): string {
  return [
    `⚠  DESTRUCTIVE — demo-data ${command}`,
    "",
    `Database : ${paths.databasePath}`,
    `Content  : ${paths.dailyContentPath}`,
    "",
    "Tables that will be cleared:",
    ...TABLES_TO_CLEAR.map((table) => table),
    "",
    "Kept:",
    ...TABLES_TO_KEEP.map((table) => table),
  ].join("\n");
}

function formatSummary(summary: GenerateDemoDataSummary): string {
  return [
    "Demo data generated successfully",
    "",
    `Period           : ${summary.months} months (${summary.firstDate} … ${summary.lastDate})`,
    `Daily briefs     : ${summary.dailyBriefs}`,
    `Published        : ${summary.published}`,
    `Ready            : ${summary.ready}`,
    `Draft            : ${summary.draft}`,
    `Failed           : ${summary.failed}`,
    `Developments     : ${summary.developments}`,
    `Worth watching   : ${summary.worthWatching}`,
    `Feedback tickets : ${summary.feedbackTickets}`,
    `System tickets   : ${summary.systemTickets}`,
  ].join("\n");
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runDemoDataCli();
}
