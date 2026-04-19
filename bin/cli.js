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

// Check if the binary is a stock (unpatched) Claude Code.
// Instead of checking for a specific color (which may change in future
// versions), we check if any of our team colors are present. If none,
// it's stock (whatever Claude Code version/Clawd style Anthropic ships).
function isStockBinary(binary) {
  try {
    const js = extractJS(binary);
    for (const team of Object.values(TEAMS)) {
      if (js.includes(team.color)) return false; // our team color = patched
    }
    return true;
  } catch {
    return false;
  }
}

// Ensure backup is up-to-date with current stock Claude Code
// - If current binary is stock: update backup (handles Claude Code updates)
// - If current binary is patched: keep existing backup
function ensureBackup(binary, backupPath) {
  if (isStockBinary(binary)) {
    // Current binary is stock — sync backup to current version
    if (!fs.existsSync(backupPath)) {
      console.log("  Creating backup...");
    } else {
      const curSize = fs.statSync(binary).size;
      const bakSize = fs.statSync(backupPath).size;
      if (curSize !== bakSize) {
        console.log("  Claude Code updated — refreshing backup...");
      }
    }
    fs.copyFileSync(binary, backupPath);
    return;
  }

  // Binary is already patched — backup must exist from a previous run
  if (!fs.existsSync(backupPath)) {
    throw new Error(
      "Binary is patched but no backup found. Reinstall Claude Code with the native installer."
    );
  }
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
    // Make sure backup reflects the current stock Claude Code version
    ensureBackup(binary, backupPath);

    // Start patching from the known-stock backup
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
