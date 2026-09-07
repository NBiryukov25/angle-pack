import { getConfig } from './config.js';
import { createApp } from './app.js';
const config=getConfig();
const {app}=await createApp(config);
const server=app.listen(config.port,config.host,()=>console.log(`ANGLE PACK listening on port ${config.port}\n${config.mockOnly?'MOCK ONLY — no API charges':'LIVE enabled only on explicit submission'}\n${config.production?'Hosted / authentication required':'Local workspace'}`));
server.requestTimeout=120000;
