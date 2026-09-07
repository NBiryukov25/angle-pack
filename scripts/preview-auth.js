// Isolated local authentication + mobile QA. No keys and no real generation.
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
const config=getConfig({APP_PASSWORD:'local-test-passphrase-only',ANGLE_PACK_DATA_DIR:await mkdtemp(path.join(os.tmpdir(),'angle-pack-mobile-')),PORT:'3211'});
const {app}=await createApp(config,()=>{throw new Error('No live transport in QA');});
app.listen(config.port,'127.0.0.1',()=>console.log('Local mock authentication QA: http://127.0.0.1:3211 (password: local-test-passphrase-only). Never use these test credentials for deployment.'));
