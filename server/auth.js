import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
export function createAuth(config) {
  // Single owner / single instance. Bounded server-side sessions intentionally expire on restart.
  const sessions=new Map(), attempts=new Map();
  const cookieName=config.production?'__Host-anglepack':'anglepack-local';
  const digest=s=>createHash('sha256').update(s).digest('hex');
  function session(req) {
    const raw=req.headers.authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1] || (req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    if(!raw || !/^[a-f0-9]{64}$/.test(raw))return null;
    const key=digest(raw),item=sessions.get(key);
    if(!item || item.expires<Date.now()){sessions.delete(key);return null;}return {...item,key};
  }
  const cookie=(value,maxAge)=>`${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.production?'; Secure':''}`;
  return {
    session,
    async login(req,res) {
      if(!config.authEnabled)return res.status(404).end();
      const time=Date.now();for(const [ip,a] of attempts)if(a.until<time)attempts.delete(ip);
      // The global bucket also bounds work if an attacker spoofs proxy addresses.
      for(const [key,limit] of [[req.ip,10],['global',100]]) {
        const bucket=attempts.get(key)||{count:0,until:time+15*60000};
        if(bucket.count>=limit || attempts.size>2000)return res.status(429).set('Retry-After','900').json({error:'Too many sign-in attempts. Try again in 15 minutes.'});
        bucket.count++;attempts.set(key,bucket);
      }
      const {password}=req.body||{};
      if(typeof password!=='string'||password.length>256)return res.status(401).json({error:'Incorrect password.'});
      if(!timingSafeEqual(Buffer.from(digest(password),'hex'),Buffer.from(digest(config.password),'hex')))return res.status(401).json({error:'Incorrect password.'});
      for(const [key,item] of sessions)if(item.expires<time)sessions.delete(key);
      if(sessions.size>=100)sessions.delete(sessions.keys().next().value);
      const previous=session(req);if(previous)sessions.delete(previous.key);
      const raw=randomBytes(32).toString('hex');sessions.set(digest(raw),{token:randomBytes(32).toString('hex'),expires:time+8*3600000});
      return res.set('Set-Cookie',cookie(raw,8*3600)).json({ok:true,accessToken:raw,expiresAt:time+8*3600000});
    },
    logout(req,res){const current=session(req);if(current)sessions.delete(current.key);res.set('Set-Cookie',cookie('',0)).json({ok:true});},
  };
}
