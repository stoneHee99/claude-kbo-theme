#!/usr/bin/env node

const fs = require("fs");
const { TEAMS } = require("../lib/teams");
const { findClaudeBinary } = require("../lib/patcher");
const { extractJS, writeJS } = require("../lib/binary");
const { patchJS } = require("../lib/hat-patch");

const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
  claude-kbo — KBO team hat & colors for Claude Code

  Usage:
    claude-kbo <team>       Apply team hat & colors
    claude-kbo --list       Show all teams
    claude-kbo --restore    Restore original Clawd
    claude-kbo --help       Show this help

  Teams:`);
  for (const [id, team] of Object.entries(TEAMS)) {
    console.log(`    ${id.padEnd(10)} ${team.name} (${team.nameEn})`);
  }
  console.log();
}

function main() {
  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "--list" || command === "-l") {
    console.log("\n  KBO Teams:\n");
    for (const [id, team] of Object.entries(TEAMS)) {
      console.log(`    ${id.padEnd(10)} ${team.name} (${team.nameEn})`);
    }
    console.log();
    return;
  }

  const binary = findClaudeBinary();
  if (!binary) {
    console.error("  Error: Could not find Claude Code binary.");
    process.exit(1);
  }

  const backupPath = binary + ".backup";
  if (!fs.existsSync(backupPath)) {
    console.log("  Creating backup...");
    fs.copyFileSync(binary, backupPath);
  }

  if (command === "--restore" || command === "-r") {
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, binary);
      try {
        require("child_process").execSync(
          `codesign --force --sign - "${binary}"`,
          { stdio: "ignore" }
        );
      } catch {}
      console.log("\n  Restored original Clawd. Restart Claude Code.\n");
    } else {
      console.log("\n  No backup found.\n");
    }
    return;
  }

  const teamId = command.toLowerCase();
  if (!TEAMS[teamId]) {
    console.error(`\n  Unknown team: "${command}". Use --list.\n`);
    process.exit(1);
  }

  try {
    // Always start from backup
    fs.copyFileSync(backupPath, binary);

    console.log("\n  Extracting JS...");
    const js = extractJS(binary);

    console.log("  Patching...");
    const result = patchJS(js, teamId);
    console.log(`  Color: ${result.colorCount} refs, Hat: ${result.hatCount} insertions`);

    console.log("  Repacking binary...");
    writeJS(binary, result.js);

    const team = TEAMS[teamId];
    console.log(`\n  ⚾ ${team.name} (${team.nameEn})`);
    console.log("  Done! Restart Claude Code.\n");
  } catch (err) {
    console.error(`\n  Error: ${err.message}\n`);
    // Restore on failure
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, binary);
      try {
        require("child_process").execSync(
          `codesign --force --sign - "${binary}"`,
          { stdio: "ignore" }
        );
      } catch {}
    }
    process.exit(1);
  }
}

main();
