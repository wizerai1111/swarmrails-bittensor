#!/usr/bin/env -S deno run --allow-env --allow-net --allow-read
// =============================================================================
// SWARMRAILS — Agent Onboarding CLI
// USAGE:
//   deno run -A scripts/onboard.ts <agent_id> <display_name> <schema_name>
//
// EXAMPLE:
//   deno run -A scripts/onboard.ts "agent_008" "Alpha Squad" "agent_alpha"
//
// ENV (set in .env or shell):
//   SUPABASE_URL              — e.g. https://<ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY — service_role JWT from Supabase dashboard
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { load as loadEnv } from "https://deno.land/std@0.224.0/dotenv/mod.ts";

// ---------------------------------------------------------------------------
// ANSI colour helpers (no external dep)
// ---------------------------------------------------------------------------
const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  green:  "\x1b[32m",
  yellow: "\x1b[33m",
  red:    "\x1b[31m",
  cyan:   "\x1b[36m",
  grey:   "\x1b[90m",
};

const fmt = {
  success: (s: string) => `${c.green}${c.bold}✔${c.reset}  ${s}`,
  warn:    (s: string) => `${c.yellow}${c.bold}⚠${c.reset}  ${s}`,
  error:   (s: string) => `${c.red}${c.bold}✖${c.reset}  ${s}`,
  info:    (s: string) => `${c.cyan}${c.bold}→${c.reset}  ${s}`,
  detail:  (s: string) => `   ${c.grey}${s}${c.reset}`,
  header:  (s: string) => `\n${c.bold}${c.cyan}${s}${c.reset}`,
};

// ---------------------------------------------------------------------------
// USAGE / HELP
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${c.bold}${c.cyan}Swarmrails Agent Onboarding CLI${c.reset}

${c.bold}USAGE${c.reset}
  deno run -A scripts/onboard.ts <agent_id> <display_name> <schema_name>

${c.bold}ARGUMENTS${c.reset}
  agent_id       Unique identifier for the agent   (e.g. "agent_008")
  display_name   Human-readable label              (e.g. "Alpha Squad")
  schema_name    Postgres schema to create         (e.g. "agent_alpha")
                 ${c.yellow}Must begin with "agent_"${c.reset}

${c.bold}ENV VARS${c.reset}
  SUPABASE_URL               Your Supabase project URL
  SUPABASE_SERVICE_ROLE_KEY  Service role key (from project settings)
  ${c.grey}Both can be set in a .env file in the project root.${c.reset}

${c.bold}EXAMPLE${c.reset}
  deno run -A scripts/onboard.ts "agent_008" "Alpha Squad" "agent_alpha"
`);
}

// ---------------------------------------------------------------------------
// ARGUMENT PARSING
// ---------------------------------------------------------------------------

const args = Deno.args.filter(a => a !== "--help" && a !== "-h");
const helpRequested = Deno.args.includes("--help") || Deno.args.includes("-h");

if (helpRequested) {
  printHelp();
  Deno.exit(0);
}

if (args.length !== 3) {
  console.error(fmt.error("Expected exactly 3 arguments."));
  printHelp();
  Deno.exit(1);
}

const [agentId, displayName, schemaName] = args;

// Schema name must begin with "agent_" — mirror the DB-level guard so we
// catch the error locally before making a round-trip.
if (!schemaName.startsWith("agent_")) {
  console.error(
    fmt.error(`schema_name must begin with "agent_". Got: "${schemaName}"`),
  );
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// ENVIRONMENT SETUP
// ---------------------------------------------------------------------------

// Attempt to load .env from the project root (two levels up from scripts/).
try {
  const envPath = new URL("../.env", import.meta.url).pathname
    // On Windows Deno gives us a /C:/... path — strip leading slash.
    .replace(/^\/([A-Za-z]:)/, "$1");
  await loadEnv({ envPath, export: true });
} catch {
  // .env not found — rely on shell environment, that's fine.
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL) {
  console.error(fmt.error("SUPABASE_URL is not set."));
  console.error(fmt.detail("Add it to your .env file or export it in your shell."));
  Deno.exit(1);
}
if (!SERVICE_KEY) {
  console.error(fmt.error("SUPABASE_SERVICE_ROLE_KEY is not set."));
  console.error(fmt.detail("Find it in your Supabase dashboard → Project Settings → API."));
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// SUPABASE CLIENT
// ---------------------------------------------------------------------------

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

console.log(fmt.header("Swarmrails — Provisioning Agent Environment"));
console.log();
console.log(fmt.info(`Agent ID     : ${c.bold}${agentId}${c.reset}`));
console.log(fmt.info(`Display Name : ${c.bold}${displayName}${c.reset}`));
console.log(fmt.info(`Schema Name  : ${c.bold}${schemaName}${c.reset}`));
console.log(fmt.info(`Project URL  : ${c.grey}${SUPABASE_URL}${c.reset}`));
console.log();

const t0 = performance.now();

const { data, error } = await supabase.rpc("provision_new_agent", {
  p_agent_id:     agentId,
  p_display_name: displayName,
  p_schema_name:  schemaName,
});

const elapsed = (performance.now() - t0).toFixed(0);

// ---------------------------------------------------------------------------
// RESULT HANDLING
// ---------------------------------------------------------------------------

if (error) {
  // Parse the Postgres error message to surface actionable guidance.
  const msg: string = error.message ?? String(error);

  if (msg.includes("AGENT_EXISTS")) {
    console.error(fmt.error(`Agent already registered.`));
    console.error(fmt.detail(`agent_id "${agentId}" exists in shared_services.projects.`));
    console.error(fmt.detail("Choose a different agent_id or query the registry to inspect it."));
  } else if (msg.includes("SCHEMA_EXISTS")) {
    console.error(fmt.error(`Schema already exists.`));
    console.error(fmt.detail(`"${schemaName}" is already a Postgres schema in this project.`));
    console.error(fmt.detail("Choose a different schema_name."));
  } else if (msg.includes("INVALID_SCHEMA_NAME")) {
    console.error(fmt.error(`Invalid schema name.`));
    console.error(fmt.detail(msg));
  } else if (msg.includes("INVALID_INPUT")) {
    console.error(fmt.error(`Invalid input.`));
    console.error(fmt.detail(msg));
  } else {
    // Unknown / unexpected error — show full detail for debugging.
    console.error(fmt.error(`Provisioning failed.`));
    console.error(fmt.detail(msg));
    console.error();
    console.error(fmt.detail("Full error object:"));
    console.error(fmt.detail(JSON.stringify(error, null, 2)));
  }

  console.error();
  console.error(fmt.detail(`Failed in ${elapsed} ms.`));
  Deno.exit(1);
}

// ---------------------------------------------------------------------------
// SUCCESS
// ---------------------------------------------------------------------------

console.log(fmt.success(`Agent environment provisioned in ${elapsed} ms!\n`));
console.log(fmt.detail(`Schema        : ${c.bold}${data.schema_name}${c.reset}`));
console.log(fmt.detail(`Tables        : ${(data.tables_created as string[]).join(", ")}`));
console.log(fmt.detail(`Indexes       : ${(data.indexes_created as string[]).join(" | ")}`));
console.log(fmt.detail(`Registry row  : shared_services.projects → agent_id = "${data.agent_id}"`));
console.log();
console.log(fmt.info(`${c.bold}${c.green}Ready.${c.reset} The agent is registered and its schema is live.`));
console.log();
