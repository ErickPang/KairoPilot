import { PermissionGuard } from './permissions';
import path from 'path';
import fs from 'fs';

// Helper function to run tests and log results
function runTest(testName: string, guard: PermissionGuard, targetPath: string, mode: 'read' | 'write', expected: boolean) {
  const result = guard.checkFileSystem(targetPath, mode);
  const passed = result === expected;
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} [${testName}] -> Target: ${targetPath} | Expected: ${expected} | Result: ${result}`);
  if (!passed) {
    console.error(`   Failed! Expected ${expected} but got ${result}.`);
  }
}

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log("==========================================");
  console.log("Starting Security Validation (PermissionGuard)");
  console.log("==========================================\n");

  const projectDir = path.resolve(__dirname, '../../../../');
  const allowedWorkspace = path.join(projectDir, 'test-workspace');

  // Ensure test workspace exists
  if (!fs.existsSync(allowedWorkspace)) {
    fs.mkdirSync(allowedWorkspace, { recursive: true });
  }

  // Create a dummy permission guard setup
  const guard = new PermissionGuard({
    fileSystem: {
      read: true,
      write: true,
      allowedPaths: [allowedWorkspace],
    },
    network: { enabled: false },
    shell: { enabled: false, allowedCommands: [] }
  });

  console.log(`Current Allowed Workspace: ${allowedWorkspace}\n`);

  // --- Test Case 1: Normal Access ---
  const safeFile = path.join(allowedWorkspace, 'safe.txt');
  fs.writeFileSync(safeFile, 'safe content');
  runTest("1. Allow safe file access inside workspace", guard, safeFile, 'read', true);

  // --- Test Case 2: Block Directory Traversal ---
  // Try to go up from workspace to the project root
  const traversalPath = path.join(allowedWorkspace, '../package.json');
  runTest("2. Block directory traversal (../) outside workspace", guard, traversalPath, 'read', false);

  // --- Test Case 3: Block Absolute Path Outside Workspace ---
  const absoluteOutside = '/etc/passwd';
  runTest("3. Block absolute path outside workspace", guard, absoluteOutside, 'read', false);

  // --- Test Case 4: Block Sensitive Directory Blacklist ---
  // Even if .ssh is inside the allowed workspace, it should be blocked
  const sshDir = path.join(allowedWorkspace, '.ssh');
  if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir);
  const sshKey = path.join(sshDir, 'id_rsa');
  fs.writeFileSync(sshKey, 'fake key');
  runTest("4. Block sensitive directory (.ssh) even inside workspace", guard, sshKey, 'read', false);

  // --- Test Case 5: Prevent Prefix Spoofing ---
  // Example: Allowed is /test-workspace, attacker tries /test-workspace-evil
  const evilWorkspace = allowedWorkspace + '-evil';
  runTest("5. Block prefix spoofing (e.g. /workspace-evil)", guard, path.join(evilWorkspace, 'file.txt'), 'read', false);

  // --- Test Case 6: Block File System Root ---
  const rootDir = path.parse(projectDir).root;
  runTest("6. Block filesystem root access", guard, rootDir, 'read', false);

  // --- Test Case 7: Block Symlink Escape ---
  // Create a symlink inside workspace that points to a sensitive file outside
  const targetSecret = path.join(projectDir, 'package.json'); // Simulate a secret outside workspace
  const symlinkPath = path.join(allowedWorkspace, 'fake-link.txt');
  
  try {
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    fs.symlinkSync(targetSecret, symlinkPath);
    runTest("7. Block symlink escape to outside file", guard, symlinkPath, 'read', false);
  } catch (e) {
    if (e instanceof Error) {
      console.log(`⚠️  [7. Block symlink escape] Skipped due to symlink creation error: ${e.message}`);
    } else {
      console.log(`⚠️  [7. Block symlink escape] Skipped due to symlink creation error: ${String(e)}`);
    }
  }

  // Cleanup
  console.log("\nCleaning up test files...");
  try {
    fs.unlinkSync(safeFile);
    fs.unlinkSync(sshKey);
    fs.rmdirSync(sshDir);
    if (fs.existsSync(symlinkPath)) fs.unlinkSync(symlinkPath);
    fs.rmdirSync(allowedWorkspace);
    console.log("Cleanup done.");
  } catch(e) {
    console.log("Cleanup encountered an issue:", e);
  }
}

main();
