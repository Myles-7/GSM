const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createAgyWorkspace, terminateAgyTree } = require('../electron/agyRuntime');

async function inspect(variant) {
  const cwd = await createAgyWorkspace();
  const agent = path.join(cwd, '.agents', 'agents', 'gsm-isolated.md');
  await fs.writeFile(agent, '---\nname: gsm-isolated\ndescription: Isolated text inference\nmainAgent: true\ntools: []\ninheritCustomizations: false\nexcludeDefaultComponents: true\n---\nUse supplied text only.\n');
  if (variant === 'directory') {
    await fs.mkdir(path.join(cwd, '.agents', 'agents', 'gsm-isolated'));
    await fs.rename(agent, path.join(cwd, '.agents', 'agents', 'gsm-isolated', 'agent.md'));
  }
  const executable = path.join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe');
  await new Promise(resolve => {
    const child = spawn(executable, ['--input-format', 'stream-json', '--output-format', 'stream-json', '--agent', 'gsm-isolated', '--add-dir', cwd, '--mode', 'plan', '--disable-slash-commands', '--log-file', 'NUL'], { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', termination = Promise.resolve();
    const timer = setTimeout(() => { termination = terminateAgyTree(child); }, 20000);
    child.stdout.on('data', data => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.event === 'init') {
            console.log(JSON.stringify({ variant, cwd, tools: event.init?.tools, agent: event.init?.agent }));
            termination = terminateAgyTree(child);
          }
        } catch { /* No prompt or raw output is printed. */ }
      }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-16000); });
    child.once('close', async code => {
      clearTimeout(timer); await termination;
      console.log(JSON.stringify({ variant, code, diagnosticFlags: { parse: /yaml|unmarshal|parse.*agent/i.test(stderr), notFound: /not found|unknown agent/i.test(stderr), trust: /trust/i.test(stderr) } }));
      resolve();
    });
  });
}
inspect('directory').then(() => inspect('add-dir')).catch(() => { process.exitCode = 1; });
