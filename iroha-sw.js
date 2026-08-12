/* iroha v2.40.32 - notification service worker */
const SW_VER='3.1.0';

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
    await self.registration.showNotification(title,options);

    /* An open tab should refresh rather than wait for the next poll. */
    const open=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of open){ try{ c.postMessage({type:'iroha-push',data:options.data}); }catch(_){} }

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
