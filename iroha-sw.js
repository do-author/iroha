/* iroha v2.40.33 - notification service worker */
const SW_VER='2.40.33';

const NOTIFY_DB='iroha-notification-prefs';
const NOTIFY_STORE='prefs';
const NOTIFY_KEY='device';

function openNotifyDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(NOTIFY_DB,1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(NOTIFY_STORE)) db.createObjectStore(NOTIFY_STORE);
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
async function readNotifyPrefs(){
  try{
    const db=await openNotifyDb();
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(NOTIFY_STORE,'readonly');
      const req=tx.objectStore(NOTIFY_STORE).get(NOTIFY_KEY);
      req.onsuccess=()=>resolve(req.result||{quiet:false,like:'all',reply:'all',dm:'all'});
      req.onerror=()=>reject(req.error);
    });
  }catch(_){
    return {quiet:false,like:'all',reply:'all',dm:'all'};
  }
}
async function writeNotifyPrefs(prefs){
  const clean={
    quiet:!!prefs?.quiet,
    like:['off','all','fav'].includes(prefs?.like)?prefs.like:'all',
    reply:['off','all','fav'].includes(prefs?.reply)?prefs.reply:'all',
    dm:['off','all','fav'].includes(prefs?.dm)?prefs.dm:'all'
  };
  const db=await openNotifyDb();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(NOTIFY_STORE,'readwrite');
    tx.objectStore(NOTIFY_STORE).put(clean,NOTIFY_KEY);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
}

self.addEventListener('message',event=>{
  if(event.data?.type!=='IROHA_NOTIFICATION_PREFS') return;
  event.waitUntil(writeNotifyPrefs(event.data.prefs||{}));
});

function pushAllowedByPrefs(data,prefs){
  if(prefs?.quiet) return false;
  const kind=String(data?.kind||'');
  if(!['like','reply','dm'].includes(kind)) return true;

  const mode=prefs?.[kind]||'all';
  if(mode==='off') return false;
  if(mode==='fav'){
    return data?.favorite===true || data?.actorFavorite===true;
  }
  return true;
}


self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push',event=>{
  let data={};
  try{
    data=event.data ? event.data.json() : {};
  }catch(_){
    try{ data={body:event.data?.text?.()||''}; }catch(__){ data={}; }
  }

  const title=String(data.title||'iroha');
  const options={
    body:String(data.body||'新しい通知があります'),
    tag:String(data.tag||'iroha-push'),
    renotify:!!data.renotify,
    data:{
      url:String(data.url||'./'),
      ...(data.data && typeof data.data==='object' ? data.data : {})
    }
  };

  event.waitUntil((async()=>{
    const prefs=await readNotifyPrefs();
    if(!pushAllowedByPrefs(data,prefs)) return;

    await self.registration.showNotification(title,options);
    if(self.navigator?.setAppBadge && Number.isFinite(Number(data.badge))){
      try{ await self.navigator.setAppBadge(Number(data.badge)); }catch(_){}
    }
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification?.data?.url||'./',self.location.origin).href;

  event.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of list){
      if('focus' in client){
        try{
          if('navigate' in client && client.url!==target) await client.navigate(target);
        }catch(_){}
        return client.focus();
      }
    }
    if(self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
