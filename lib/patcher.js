const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Find the Claude Code binary (skips cmux wrapper)
function findClaudeBinary() {
  const candidates = [
    path.join(process.env.HOME, ".local/bin/claude"),
    "/usr/local/bin/claude",
  ];

  try {
    const which = execSync(
      'PATH=$(echo "$PATH" | tr \':\' \'\\n\' | grep -v cmux | tr \'\\n\' \':\') which claude 2>/dev/null',
      { encoding: "utf8", shell: "/bin/sh" }
    ).trim();
    if (which) candidates.unshift(which);
  } catch {}

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const file = execSync(`file "${p}"`, { encoding: "utf8" });
      if (file.includes("Mach-O") || file.includes("ELF")) {
        return p;
      }
    }
  }

  return null;
}

module.exports = { findClaudeBinary };
