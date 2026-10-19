import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

const source=fileURLToPath(new URL('../../',import.meta.url));
test('a running MCP keeps serving its UI after an update removes the HTML file',async()=>{
  const fixture=await fs.mkdtemp(path.join(os.tmpdir(),'skill-manager-ui-'));
  const client=new Client({name:'bundled-ui-regression',version:'1'});
  try {
    for(const file of ['server/server.bundle.mjs','.codex-plugin/plugin.json','ui/dist/client/index.html']) {
      const destination=path.join(fixture,file);
      await fs.mkdir(path.dirname(destination),{recursive:true});
      await fs.copyFile(path.join(source,file),destination);
    }
    await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(fixture,'server/server.bundle.mjs')],cwd:os.tmpdir(),stderr:'pipe'}));
    const initial=await client.readResource({uri:'ui://skill-manager/index.html'});
    assert.match(initial.contents[0].text,/skill_manager_inventory/);
    await fs.rename(path.join(fixture,'ui/dist/client/index.html'),path.join(fixture,'ui/dist/client/index.html.unavailable'));
    const afterUpdate=await client.readResource({uri:'ui://skill-manager/index.html'});
    assert.equal(afterUpdate.contents[0].text,initial.contents[0].text);
  } finally {
    await client.close();
    const target=path.resolve(fixture);
    assert.equal(path.dirname(target),path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('skill-manager-ui-'));
    if(process.env.SKILL_MANAGER_KEEP_TEST_FIXTURES!=='1')await fs.rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
