// macho-bun.js
// Pure-JS Mach-O + Bun blob manipulation for Claude Code binaries.
// Extracts, modifies, and repacks the embedded JS without external dependencies.
// macOS ARM64 / x86_64 supported.

const fs = require("fs");
const { execFileSync } = require("child_process");

// ── Constants ─────────────────────────────────────────────────────

const MH_MAGIC_64 = 0xfeedfacf;
const CPU_TYPE_ARM64 = 0x0100000c;

const LC_SEGMENT_64 = 0x19;
const LC_CODE_SIGNATURE = 0x1d;
const LC_SYMTAB = 0x2;
const LC_DYSYMTAB = 0xb;
const LC_DYLD_INFO = 0x22;
const LC_DYLD_INFO_ONLY = 0x80000022;
const LC_FUNCTION_STARTS = 0x26;
const LC_DATA_IN_CODE = 0x29;
const LC_DYLD_EXPORTS_TRIE = 0x80000033;
const LC_DYLD_CHAINED_FIXUPS = 0x80000034;
const LC_SEGMENT_SPLIT_INFO = 0x1e;

const BUN_TRAILER = Buffer.from("\n---- Bun! ----\n", "ascii"); // 16 bytes
const SIZEOF_OFFSETS = 32;
const SIZEOF_STRING_POINTER = 8;
const SIZEOF_MODULE_OLD = 36;
const SIZEOF_MODULE_NEW = 52;

// ── Mach-O parsing ────────────────────────────────────────────────

function parseMachO(buf) {
  if (buf.readUInt32LE(0) !== MH_MAGIC_64) {
    throw new Error("Not a Mach-O 64-bit little-endian binary");
  }
  const cputype = buf.readUInt32LE(4);
  const ncmds = buf.readUInt32LE(16);
  const sizeofcmds = buf.readUInt32LE(20);

  const commands = [];
  let cursor = 32;
  for (let i = 0; i < ncmds; i++) {
    const cmd = buf.readUInt32LE(cursor);
    const cmdsize = buf.readUInt32LE(cursor + 4);
    commands.push({ cmd, cmdsize, fileOff: cursor, index: i });
    cursor += cmdsize;
  }

  return { cputype, ncmds, sizeofcmds, commands };
}

function readFixedAscii(buf, off, len) {
  const end = buf.indexOf(0, off);
  const limit = end === -1 ? off + len : Math.min(end, off + len);
  return buf.slice(off, limit).toString("ascii");
}

function findSection(buf, macho, segName, secName) {
  for (const c of macho.commands) {
    if (c.cmd !== LC_SEGMENT_64) continue;
    const s = readFixedAscii(buf, c.fileOff + 8, 16);
    if (s !== segName) continue;
    const nsects = buf.readUInt32LE(c.fileOff + 64);
    for (let i = 0; i < nsects; i++) {
      const secOff = c.fileOff + 72 + i * 80;
      const sec = readFixedAscii(buf, secOff, 16);
      if (sec === secName) {
        return {
          segLoadCmdOff: c.fileOff,
          secStructOff: secOff,
          segFileOff: Number(buf.readBigUInt64LE(c.fileOff + 40)),
          segFileSize: Number(buf.readBigUInt64LE(c.fileOff + 48)),
          segVMAddr: Number(buf.readBigUInt64LE(c.fileOff + 24)),
          segVMSize: Number(buf.readBigUInt64LE(c.fileOff + 32)),
          secFileOff: Number(buf.readBigUInt64LE(secOff + 48)) >>> 0 || buf.readUInt32LE(secOff + 48),
          secSize: Number(buf.readBigUInt64LE(secOff + 40)),
          secVMAddr: Number(buf.readBigUInt64LE(secOff + 32)),
        };
      }
    }
  }
  throw new Error(`Section ${segName}.${secName} not found`);
}

// ── Bun blob parsing ──────────────────────────────────────────────

function parseHeader(sectionData) {
  const len = sectionData.length;
  if (len < 8) throw new Error("Section too small");

  const u32Size = sectionData.readUInt32LE(0);
  const u64Size = Number(sectionData.readBigUInt64LE(0));

  const totalU32 = 4 + u32Size;
  const totalU64 = 8 + u64Size;

  const matchU64 = u64Size >= 8 && totalU64 <= len && totalU64 >= len - 4096;
  const matchU32 = totalU32 <= len && totalU32 >= len - 4096;

  if (matchU64) {
    return { headerSize: 8, payloadLen: u64Size, payload: sectionData.slice(8, 8 + u64Size) };
  }
  if (matchU32) {
    return { headerSize: 4, payloadLen: u32Size, payload: sectionData.slice(4, 4 + u32Size) };
  }
  throw new Error("Cannot detect Bun header format");
}

function readStringPointer(buf, off) {
  return { offset: buf.readUInt32LE(off), length: buf.readUInt32LE(off + 4) };
}

function readString(payload, sp) {
  return payload.slice(sp.offset, sp.offset + sp.length);
}

function parseBlob(payload) {
  if (payload.length < SIZEOF_OFFSETS + BUN_TRAILER.length) {
    throw new Error("Payload too small");
  }
  const trailer = payload.slice(payload.length - BUN_TRAILER.length);
  if (!trailer.equals(BUN_TRAILER)) throw new Error("BUN_TRAILER missing");

  const offsetsStart = payload.length - BUN_TRAILER.length - SIZEOF_OFFSETS;
  const offsets = {
    byteCount: Number(payload.readBigUInt64LE(offsetsStart + 0)),
    modulesPtr: {
      offset: payload.readUInt32LE(offsetsStart + 8),
      length: payload.readUInt32LE(offsetsStart + 12),
    },
    entryPointId: payload.readUInt32LE(offsetsStart + 16),
    compileExecArgvPtr: {
      offset: payload.readUInt32LE(offsetsStart + 20),
      length: payload.readUInt32LE(offsetsStart + 24),
    },
    flags: payload.readUInt32LE(offsetsStart + 28),
  };

  const modsLen = offsets.modulesPtr.length;
  const fitsNew = modsLen % SIZEOF_MODULE_NEW === 0;
  const fitsOld = modsLen % SIZEOF_MODULE_OLD === 0;
  let moduleStructSize;
  if (fitsNew && !fitsOld) moduleStructSize = SIZEOF_MODULE_NEW;
  else if (fitsOld && !fitsNew) moduleStructSize = SIZEOF_MODULE_OLD;
  else moduleStructSize = SIZEOF_MODULE_NEW;

  return { offsets, moduleStructSize };
}

function walkModules(payload, offsets, moduleStructSize) {
  const modBlock = payload.slice(
    offsets.modulesPtr.offset,
    offsets.modulesPtr.offset + offsets.modulesPtr.length
  );
  const count = Math.floor(modBlock.length / moduleStructSize);
  const modules = [];
  for (let i = 0; i < count; i++) {
    const base = i * moduleStructSize;
    const isNew = moduleStructSize === SIZEOF_MODULE_NEW;
    const m = {
      name: readStringPointer(modBlock, base + 0),
      contents: readStringPointer(modBlock, base + 8),
      sourcemap: readStringPointer(modBlock, base + 16),
      bytecode: readStringPointer(modBlock, base + 24),
    };
    const flagsBase = isNew ? base + 48 : base + 32;
    if (isNew) {
      m.moduleInfo = readStringPointer(modBlock, base + 32);
      m.bytecodeOriginPath = readStringPointer(modBlock, base + 40);
    }
    m.encoding = modBlock.readUInt8(flagsBase + 0);
    m.loader = modBlock.readUInt8(flagsBase + 1);
    m.moduleFormat = modBlock.readUInt8(flagsBase + 2);
    m.side = modBlock.readUInt8(flagsBase + 3);
    m.nameStr = readString(payload, m.name).toString("utf8");
    modules.push(m);
  }
  return modules;
}

function isClaudeModule(name) {
  return (
    name === "claude" ||
    name.endsWith("/claude") ||
    name === "claude.exe" ||
    name.endsWith("/claude.exe") ||
    name === "src/entrypoints/cli.js" ||
    name.endsWith("/src/entrypoints/cli.js")
  );
}

// ── Blob rebuild ──────────────────────────────────────────────────

function rebuildBlob(payload, offsets, moduleStructSize, modules, newClaudeJs) {
  const isNew = moduleStructSize === SIZEOF_MODULE_NEW;
  const stringsPerModule = isNew ? 6 : 4;

  // Phase 1: collect all strings
  const stringsData = [];
  const moduleMeta = [];
  for (const m of modules) {
    const isClaude = isClaudeModule(m.nameStr);
    const contents = isClaude && newClaudeJs ? newClaudeJs : readString(payload, m.contents);
    const strs = [
      readString(payload, m.name),
      contents,
      readString(payload, m.sourcemap),
      readString(payload, m.bytecode),
    ];
    if (isNew) {
      strs.push(readString(payload, m.moduleInfo));
      strs.push(readString(payload, m.bytecodeOriginPath));
    }
    stringsData.push(...strs);
    moduleMeta.push({
      encoding: m.encoding,
      loader: m.loader,
      moduleFormat: m.moduleFormat,
      side: m.side,
    });
  }
  const compileExecArgv = payload.slice(
    offsets.compileExecArgvPtr.offset,
    offsets.compileExecArgvPtr.offset + offsets.compileExecArgvPtr.length
  );

  // Phase 2: calculate new offsets
  let cursor = 0;
  const stringOffsets = [];
  for (const s of stringsData) {
    stringOffsets.push({ offset: cursor, length: s.length });
    cursor += s.length + 1; // null terminator
  }
  const modulesListOffset = cursor;
  const modulesListSize = modules.length * moduleStructSize;
  cursor += modulesListSize;

  const compileExecArgvOffset = cursor;
  cursor += compileExecArgv.length + 1;

  const offsetsOffset = cursor;
  cursor += SIZEOF_OFFSETS;

  const trailerOffset = cursor;
  cursor += BUN_TRAILER.length;

  const totalLen = cursor;

  // Phase 3: serialize
  const buf = Buffer.alloc(totalLen);
  for (let i = 0; i < stringsData.length; i++) {
    stringsData[i].copy(buf, stringOffsets[i].offset);
  }
  compileExecArgv.copy(buf, compileExecArgvOffset);

  for (let i = 0; i < modules.length; i++) {
    const base = modulesListOffset + i * moduleStructSize;
    const sOff = i * stringsPerModule;
    // StringPointers
    buf.writeUInt32LE(stringOffsets[sOff + 0].offset, base + 0);
    buf.writeUInt32LE(stringOffsets[sOff + 0].length, base + 4);
    buf.writeUInt32LE(stringOffsets[sOff + 1].offset, base + 8);
    buf.writeUInt32LE(stringOffsets[sOff + 1].length, base + 12);
    buf.writeUInt32LE(stringOffsets[sOff + 2].offset, base + 16);
    buf.writeUInt32LE(stringOffsets[sOff + 2].length, base + 20);
    buf.writeUInt32LE(stringOffsets[sOff + 3].offset, base + 24);
    buf.writeUInt32LE(stringOffsets[sOff + 3].length, base + 28);
    let flagsBase;
    if (isNew) {
      buf.writeUInt32LE(stringOffsets[sOff + 4].offset, base + 32);
      buf.writeUInt32LE(stringOffsets[sOff + 4].length, base + 36);
      buf.writeUInt32LE(stringOffsets[sOff + 5].offset, base + 40);
      buf.writeUInt32LE(stringOffsets[sOff + 5].length, base + 44);
      flagsBase = base + 48;
    } else {
      flagsBase = base + 32;
    }
    buf.writeUInt8(moduleMeta[i].encoding, flagsBase + 0);
    buf.writeUInt8(moduleMeta[i].loader, flagsBase + 1);
    buf.writeUInt8(moduleMeta[i].moduleFormat, flagsBase + 2);
    buf.writeUInt8(moduleMeta[i].side, flagsBase + 3);
  }

  // OFFSETS
  buf.writeBigUInt64LE(BigInt(offsetsOffset), offsetsOffset + 0);
  buf.writeUInt32LE(modulesListOffset, offsetsOffset + 8);
  buf.writeUInt32LE(modulesListSize, offsetsOffset + 12);
  buf.writeUInt32LE(offsets.entryPointId, offsetsOffset + 16);
  buf.writeUInt32LE(compileExecArgvOffset, offsetsOffset + 20);
  buf.writeUInt32LE(compileExecArgv.length, offsetsOffset + 24);
  buf.writeUInt32LE(offsets.flags, offsetsOffset + 28);

  // TRAILER
  BUN_TRAILER.copy(buf, trailerOffset);

  return buf;
}

function wrapSection(payload, headerSize) {
  const sec = Buffer.alloc(headerSize + payload.length);
  if (headerSize === 8) sec.writeBigUInt64LE(BigInt(payload.length), 0);
  else sec.writeUInt32LE(payload.length, 0);
  payload.copy(sec, headerSize);
  return sec;
}

// ── Mach-O section writing ────────────────────────────────────────

// LC commands that point into __LINKEDIT via (dataoff, datasize) pair
const LINKEDIT_DATA_CMDS = new Set([
  LC_CODE_SIGNATURE,
  LC_FUNCTION_STARTS,
  LC_DATA_IN_CODE,
  LC_DYLD_EXPORTS_TRIE,
  LC_DYLD_CHAINED_FIXUPS,
  LC_SEGMENT_SPLIT_INFO,
]);

function shiftLoadCommands(buf, macho, oldSegFileOff, oldSegVMAddr, delta) {
  for (const c of macho.commands) {
    if (c.cmd === LC_SEGMENT_64) {
      const fileoff = Number(buf.readBigUInt64LE(c.fileOff + 40));
      const vmaddr = Number(buf.readBigUInt64LE(c.fileOff + 24));
      if (fileoff > oldSegFileOff) {
        buf.writeBigUInt64LE(BigInt(fileoff + delta), c.fileOff + 40);
      }
      if (vmaddr > oldSegVMAddr) {
        buf.writeBigUInt64LE(BigInt(vmaddr + delta), c.fileOff + 24);
      }
      const nsects = buf.readUInt32LE(c.fileOff + 64);
      for (let i = 0; i < nsects; i++) {
        const secOff = c.fileOff + 72 + i * 80;
        const sFileOff = buf.readUInt32LE(secOff + 48);
        const sAddr = Number(buf.readBigUInt64LE(secOff + 32));
        if (sFileOff > oldSegFileOff) {
          buf.writeUInt32LE(sFileOff + delta, secOff + 48);
        }
        if (sAddr > oldSegVMAddr) {
          buf.writeBigUInt64LE(BigInt(sAddr + delta), secOff + 32);
        }
      }
    } else if (c.cmd === LC_SYMTAB) {
      const symoff = buf.readUInt32LE(c.fileOff + 8);
      const stroff = buf.readUInt32LE(c.fileOff + 16);
      if (symoff > oldSegFileOff) buf.writeUInt32LE(symoff + delta, c.fileOff + 8);
      if (stroff > oldSegFileOff) buf.writeUInt32LE(stroff + delta, c.fileOff + 16);
    } else if (c.cmd === LC_DYSYMTAB) {
      // offsets at fixed positions in LC_DYSYMTAB
      const fields = [32, 40, 48, 56, 64, 72]; // tocoff, modtaboff, extrefsymoff, indirectsymoff, extreloff, locreloff
      for (const f of fields) {
        const v = buf.readUInt32LE(c.fileOff + f);
        if (v > oldSegFileOff) buf.writeUInt32LE(v + delta, c.fileOff + f);
      }
    } else if (c.cmd === LC_DYLD_INFO || c.cmd === LC_DYLD_INFO_ONLY) {
      // rebase_off, bind_off, weak_bind_off, lazy_bind_off, export_off at offsets 8, 16, 24, 32, 40
      for (const f of [8, 16, 24, 32, 40]) {
        const v = buf.readUInt32LE(c.fileOff + f);
        if (v > oldSegFileOff) buf.writeUInt32LE(v + delta, c.fileOff + f);
      }
    } else if (LINKEDIT_DATA_CMDS.has(c.cmd)) {
      // dataoff at offset 8
      const v = buf.readUInt32LE(c.fileOff + 8);
      if (v > oldSegFileOff) buf.writeUInt32LE(v + delta, c.fileOff + 8);
    }
  }
}

function writeSection(binaryPath, newSectionBytes) {
  let buf = fs.readFileSync(binaryPath);
  let macho = parseMachO(buf);
  const sec = findSection(buf, macho, "__BUN", "__bun");

  // Step 0: remove code signature load command if present
  buf = removeCodeSignature(buf, macho);
  macho = parseMachO(buf); // re-parse after signature removal

  const sec2 = findSection(buf, macho, "__BUN", "__bun");
  const PAGE = macho.cputype === CPU_TYPE_ARM64 ? 16384 : 4096;

  const oldSegFileOff = sec2.segFileOff;
  const oldSegVMAddr = sec2.segVMAddr;
  const oldSegFileSize = sec2.segFileSize;

  const newLen = newSectionBytes.length;

  if (newLen <= oldSegFileSize) {
    // Same or smaller — write in place, zero-pad the rest
    newSectionBytes.copy(buf, sec2.secFileOff);
    if (newLen < oldSegFileSize) {
      buf.fill(0, sec2.secFileOff + newLen, sec2.secFileOff + oldSegFileSize);
    }
    // Update section.size to actual new length
    buf.writeBigUInt64LE(BigInt(newLen), sec2.secStructOff + 40);
  } else {
    // Need to extend
    const sizeDiff = newLen - oldSegFileSize;
    const alignedDelta = Math.ceil(sizeDiff / PAGE) * PAGE;

    // Create new buffer with room
    const newBuf = Buffer.alloc(buf.length + alignedDelta);
    // Copy everything up to end of BUN segment
    buf.copy(newBuf, 0, 0, oldSegFileOff + oldSegFileSize);
    // Copy everything after BUN segment, shifted by alignedDelta
    buf.copy(newBuf, oldSegFileOff + oldSegFileSize + alignedDelta, oldSegFileOff + oldSegFileSize);
    // Zero-fill the gap (implicit since newBuf starts as zero — Buffer.alloc)

    // Update load commands in newBuf
    const machoNew = parseMachO(newBuf);
    shiftLoadCommands(newBuf, machoNew, oldSegFileOff, oldSegVMAddr, alignedDelta);

    // Update BUN segment's size
    buf = newBuf;
    const sec3 = findSection(buf, parseMachO(buf), "__BUN", "__bun");
    buf.writeBigUInt64LE(BigInt(oldSegFileSize + alignedDelta), sec3.segLoadCmdOff + 48); // filesize
    buf.writeBigUInt64LE(BigInt(sec3.segVMSize + alignedDelta), sec3.segLoadCmdOff + 32); // vmsize

    // Write new section content
    newSectionBytes.copy(buf, sec3.secFileOff);
    // Zero-fill remaining space in the segment
    buf.fill(0, sec3.secFileOff + newLen, sec3.secFileOff + oldSegFileSize + alignedDelta);

    // Update section.size
    buf.writeBigUInt64LE(BigInt(newLen), sec3.secStructOff + 40);
  }

  fs.writeFileSync(binaryPath, buf);
}

// ── Code signature ────────────────────────────────────────────────

function removeCodeSignature(buf, macho) {
  const sigCmd = macho.commands.find((c) => c.cmd === LC_CODE_SIGNATURE);
  if (!sigCmd) return buf;

  const sigOff = buf.readUInt32LE(sigCmd.fileOff + 8);
  const sigSize = buf.readUInt32LE(sigCmd.fileOff + 12);

  // Remove load command: shift remaining commands up, zero the tail
  const loadCmdsEnd = 32 + macho.sizeofcmds;
  const tailStart = sigCmd.fileOff + sigCmd.cmdsize;
  const tailLen = loadCmdsEnd - tailStart;

  if (tailLen > 0) {
    buf.copy(buf, sigCmd.fileOff, tailStart, tailStart + tailLen);
  }
  // Zero the freed region
  buf.fill(0, loadCmdsEnd - sigCmd.cmdsize, loadCmdsEnd);

  // Update header
  buf.writeUInt32LE(macho.ncmds - 1, 16);
  buf.writeUInt32LE(macho.sizeofcmds - sigCmd.cmdsize, 20);

  // Truncate signature bytes if at EOF
  if (sigOff + sigSize === buf.length) {
    buf = buf.slice(0, sigOff);
    // Update __LINKEDIT filesize
    const mNew = parseMachO(buf);
    for (const c of mNew.commands) {
      if (c.cmd !== LC_SEGMENT_64) continue;
      const segName = readFixedAscii(buf, c.fileOff + 8, 16);
      if (segName === "__LINKEDIT") {
        const filesize = Number(buf.readBigUInt64LE(c.fileOff + 48));
        buf.writeBigUInt64LE(BigInt(filesize - sigSize), c.fileOff + 48);
        break;
      }
    }
  }

  return buf;
}

function codesign(binaryPath) {
  try {
    execFileSync("codesign", ["-s", "-", "-f", binaryPath], { stdio: "ignore" });
  } catch (err) {
    console.warn("  Warning: codesign failed:", err.message);
  }
}

// ── Public API ────────────────────────────────────────────────────

function extractJS(binaryPath) {
  const buf = fs.readFileSync(binaryPath);
  const macho = parseMachO(buf);
  const sec = findSection(buf, macho, "__BUN", "__bun");
  const sectionData = buf.slice(sec.secFileOff, sec.secFileOff + sec.secSize);
  const { payload } = parseHeader(sectionData);
  const { offsets, moduleStructSize } = parseBlob(payload);
  const modules = walkModules(payload, offsets, moduleStructSize);
  const claude = modules.find((m) => isClaudeModule(m.nameStr));
  if (!claude) throw new Error("Claude module not found");
  return readString(payload, claude.contents).toString("utf8");
}

function writeJS(binaryPath, newJs) {
  const buf = fs.readFileSync(binaryPath);
  const macho = parseMachO(buf);
  const sec = findSection(buf, macho, "__BUN", "__bun");
  const sectionData = buf.slice(sec.secFileOff, sec.secFileOff + sec.secSize);
  const { headerSize, payload } = parseHeader(sectionData);
  const { offsets, moduleStructSize } = parseBlob(payload);
  const modules = walkModules(payload, offsets, moduleStructSize);

  const newPayload = rebuildBlob(
    payload,
    offsets,
    moduleStructSize,
    modules,
    Buffer.from(newJs, "utf8")
  );
  const newSection = wrapSection(newPayload, headerSize);

  writeSection(binaryPath, newSection);
  codesign(binaryPath);
}

module.exports = { extractJS, writeJS };
