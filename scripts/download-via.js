#!/usr/bin/env node

const { createWriteStream } = require("node:fs");
const { chmod, cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { get } = require("node:https");
const { tmpdir } = require("node:os");
const { basename, join } = require("node:path");
const { spawn } = require("node:child_process");

const OWNER = "si-view";
const REPO = "via";
const API_URL = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
const SUPPORTED_PACKAGE_TARGETS = [
  { platform: "linux", arch: "x64" },
  { platform: "linux", arch: "arm64" },
];

async function main() {
  if (process.env.VIA_SKIP_DOWNLOAD === "1" || process.env.VIA_SKIP_DOWNLOAD === "true") {
    console.log("Skipping via download because VIA_SKIP_DOWNLOAD is set.");
    return;
  }

  const targets = resolveTargets(process.argv.slice(2));
  if (targets.length === 0) {
    console.log(`Skipping via download for unsupported platform ${process.platform}.`);
    return;
  }

  const release = await fetchJson(API_URL);
  for (const target of targets) {
    await installTarget(release, target);
  }
}

async function installTarget(release, target) {
  const tag = release.tag_name;
  const outDir = getOutDir(target);
  const outFile = getOutFile(target);
  const versionFile = getVersionFile(target);
  const asset = selectAsset(release.assets || [], target);
  if (!asset) {
    throw new Error(`No via release asset found for ${target.platform}-${target.arch} in ${tag}.`);
  }

  if (await isCurrent(tag, outFile, versionFile)) {
    console.log(`via ${tag} is already present at ${outFile}.`);
    return;
  }

  await mkdir(outDir, { recursive: true });
  await downloadAndInstall(asset, tag, outFile, versionFile);
}

async function downloadAndInstall(asset, tag, outFile, versionFile) {
  const tempDir = await mkdtemp(join(tmpdir(), "via-release-"));
  const downloadPath = join(tempDir, asset.name);

  try {
    console.log(`Downloading via ${tag} from ${asset.browser_download_url}`);
    await download(asset.browser_download_url, downloadPath);
    await installAsset(downloadPath, asset.name, tempDir, outFile);
    await chmod(outFile, 0o755);
    await writeFile(versionFile, `${tag}\n`, "utf8");
    console.log(`Installed via ${tag} to ${outFile}.`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function resolveTargets(args) {
  if (args.includes("--all-linux")) {
    return SUPPORTED_PACKAGE_TARGETS;
  }

  const targetArg = args.find((arg) => arg.startsWith("--target="));
  if (targetArg) {
    return [parseTarget(targetArg.replace("--target=", ""))];
  }

  if (process.platform !== "linux") {
    return [];
  }

  return [{ platform: "linux", arch: normalizeArch(process.arch) }];
}

function parseTarget(value) {
  const match = value.match(/^([a-z0-9]+)-([a-z0-9_]+)$/i);
  if (!match) {
    throw new Error(`Invalid via download target: ${value}`);
  }

  return {
    platform: match[1],
    arch: normalizeArch(match[2]),
  };
}

function normalizeArch(arch) {
  switch (arch) {
    case "x64":
    case "amd64":
    case "x86_64":
      return "x64";
    case "arm64":
    case "aarch64":
      return "arm64";
    default:
      return arch;
  }
}

function selectAsset(assets, target) {
  const platformTokens = [target.platform];
  const archTokens = target.arch === "x64" ? ["x64", "amd64", "x86_64"] : [target.arch, "aarch64"];
  const candidates = assets
    .filter((asset) => typeof asset.name === "string" && typeof asset.browser_download_url === "string")
    .filter((asset) => {
      const name = asset.name.toLowerCase();
      return !name.endsWith(".sha256")
        && !name.endsWith(".sha256sum")
        && !name.endsWith(".sig")
        && !name.endsWith(".asc");
    });
  const platformCandidates = candidates.filter((asset) => {
    const name = asset.name.toLowerCase();
    return platformTokens.some((token) => name.includes(token))
      && archTokens.some((token) => name.includes(token));
  });

  return platformCandidates.find((asset) => /(\.tar\.gz|\.tgz|\.zip)$/i.test(asset.name))
    || platformCandidates.find((asset) => /(^|[-_.])via($|[-_.])/i.test(asset.name))
    || platformCandidates[0]
    || candidates.find((asset) => basename(asset.name).toLowerCase() === "via")
    || (candidates.length === 1 ? candidates[0] : undefined);
}

async function isCurrent(tag, outFile, versionFile) {
  try {
    const [binary, version] = await Promise.all([
      stat(outFile),
      readFile(versionFile, "utf8"),
    ]);
    return binary.isFile() && version.trim() === tag;
  } catch {
    return false;
  }
}

async function installAsset(downloadPath, assetName, tempDir, outFile) {
  if (/\.tar\.gz$|\.tgz$/i.test(assetName)) {
    const extractDir = join(tempDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await run("tar", ["-xzf", downloadPath, "-C", extractDir]);
    await cp(await findViaBinary(extractDir), outFile);
    return;
  }

  if (/\.zip$/i.test(assetName)) {
    const extractDir = join(tempDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await run("unzip", ["-q", downloadPath, "-d", extractDir]);
    await cp(await findViaBinary(extractDir), outFile);
    return;
  }

  await cp(downloadPath, outFile);
}

function getOutDir(target) {
  return join(__dirname, "..", "bin", `${target.platform}-${target.arch}`);
}

function getOutFile(target) {
  return join(getOutDir(target), target.platform === "win32" ? "via.exe" : "via");
}

function getVersionFile(target) {
  return join(getOutDir(target), ".release");
}

async function findViaBinary(root) {
  const entries = await readTree(root);
  const exact = entries.find((path) => basename(path) === "via");
  if (exact) {
    return exact;
  }

  const named = entries.find((path) => basename(path).startsWith("via"));
  if (named) {
    return named;
  }

  throw new Error("Downloaded release asset does not contain a via binary.");
}

async function readTree(root) {
  const { readdir } = require("node:fs/promises");
  const result = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await readTree(path));
    } else if (entry.isFile()) {
      result.push(path);
    }
  }
  return result;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const request = get(url, requestOptions(), (response) => {
      if (isRedirect(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error(`Redirect from ${url} did not include a Location header.`));
          return;
        }
        fetchJson(location).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub API request failed with HTTP ${response.statusCode}.`));
        return;
      }

      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
}

function download(url, destination) {
  return new Promise((resolve, reject) => {
    const request = get(url, requestOptions(), (response) => {
      if (isRedirect(response.statusCode)) {
        const location = response.headers.location;
        response.resume();
        if (!location) {
          reject(new Error(`Redirect from ${url} did not include a Location header.`));
          return;
        }
        download(location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function requestOptions() {
  return {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": `${REPO}-vscode-build`,
    },
  };
}

function isRedirect(statusCode) {
  return statusCode && statusCode >= 300 && statusCode < 400;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
