import { expect, test } from 'bun:test';
import { StdioJsonRpc, nativeEnvironment, protocolRecord } from '../src/process';
const options = (source: string, timeoutMs = 1000) => ({
  executable: process.execPath,
  args: ['-e', source],
  cwd: process.cwd(),
  env: {},
  timeoutMs,
});
async function eventually(check: () => boolean) {
  for (let i = 0; i < 150; i++) {
    if (check()) return;
    await Bun.sleep(10);
  }
  throw new Error('Child process did not terminate');
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
test('native environment includes explicit secrets only', () => {
  const prior = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'ambient-fixture';
  try {
    expect(nativeEnvironment().OPENAI_API_KEY).toBeUndefined();
    expect(nativeEnvironment({ OPENAI_API_KEY: 'injected' }).OPENAI_API_KEY).toBe('injected');
  } finally {
    if (prior === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prior;
  }
});
test('JSON-RPC request and malformed native response propagate failure', async () => {
  const rpc = new StdioJsonRpc(
    options(
      `process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{for(const l of s.trim().split('\\n')){const m=JSON.parse(l);if(m.method==='bad')process.stdout.write('invalid\\n');else process.stdout.write(JSON.stringify({id:m.id,result:{pong:true}})+'\\n')}});`,
    ),
  );
  try {
    expect(protocolRecord(await rpc.request('ping'), 'fixture')).toEqual({ pong: true });
    await expect(rpc.request('bad')).rejects.toThrow();
  } finally {
    rpc.close();
  }
});
test('pending RPC requests have bounded timeout and close rejection', async () => {
  const rpc = new StdioJsonRpc(options('setInterval(()=>{},1000)', 20));
  await expect(rpc.request('never')).rejects.toThrow('timed out');
  const pending = rpc.request('pending');
  rpc.close();
  await expect(pending).rejects.toThrow('closed');
});
test('cancelling a native adapter terminates its ordinary subprocess tree', async () => {
  let descendant = 0;
  const rpc = new StdioJsonRpc(
    options(
      `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(JSON.stringify({method:'ready',params:{pid:child.pid}})+'\\n');setInterval(()=>{},1000);`,
    ),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      rpc.onMessage = (message) => {
        const pid = protocolRecord(message.params, 'fixture ready').pid;
        if (typeof pid !== 'number') {
          reject(new Error('Invalid child PID'));
          return;
        }
        descendant = pid;
        resolve();
      };
      rpc.onFailure = reject;
    });
    expect(alive(descendant)).toBe(true);
    rpc.close();
    await eventually(() => !alive(descendant));
  } finally {
    rpc.close();
    if (descendant && alive(descendant)) process.kill(descendant, 'SIGKILL');
  }
});

test('valid JSON with an invalid RPC envelope fails pending requests', async () => {
  const rpc = new StdioJsonRpc(
    options(`process.stdin.on('data',()=>process.stdout.write('[]\\n'));`),
  );
  try {
    await expect(rpc.request('malformed')).rejects.toThrow('Malformed native JSON-RPC message');
  } finally {
    rpc.close();
  }
});
