// Local-only mock preview. Does not load .env or contact fal.ai.
import express from 'express';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getConfig} from '../server/config.js';
import {createApp} from '../server/app.js';
const directory=process.argv[2];if(!directory)throw new Error('Provide the Joyce gallery folder path.');
const config={...getConfig({APP_PASSWORD:'local-preview-password'}),dataDir:await mkdtemp(path.join(os.tmpdir(),'angle-pages-preview-'))};
const {app}=await createApp(config,{upload:()=>{throw new Error('Mock preview must not upload to provider');}});
app.listen(3210,'127.0.0.1');
express().use(express.static(path.resolve(directory))).listen(8080,'127.0.0.1',()=>console.log('Open http://127.0.0.1:8080/portrait.html — password: local-preview-password — mock only.'));
