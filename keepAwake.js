// Keeps Windows from idle-sleeping while timings are pending, by holding
// SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED) in a hidden
// PowerShell child. Closing the lid or choosing Sleep manually still sleeps.
const { spawn } = require('child_process');

let child = null;

function script(parentPid) {
  return [
    "$t = Add-Type -Name P -Namespace W -PassThru -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint f);'",
    '[void]$t::SetThreadExecutionState([uint32]2147483649)',
    // Exit with the app, even if it is killed without cleanup.
    `while (Get-Process -Id ${parentPid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 30 }`,
  ].join('; ');
}

function set(on) {
  if (process.platform !== 'win32') return;
  if (on && !child) {
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script(process.pid)], {
      windowsHide: true,
      stdio: 'ignore',
    });
    child.on('exit', () => {
      child = null;
    });
    child.on('error', (err) => {
      console.warn('[keepAwake] could not start:', err.message);
      child = null;
    });
    console.log('[keepAwake] PC will stay awake until pending timings are sent');
  } else if (!on && child) {
    child.kill();
    child = null;
    console.log('[keepAwake] released');
  }
}

function active() {
  return Boolean(child);
}

process.on('exit', () => set(false));

module.exports = { set, active };
