/* iroha v2.40.32 - notification service worker */
const SW_VER='3.1.1';

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
    try{
      data={body:event.data?.text?.()||''};
    }catch(__){
      data={};
    }
  }

  const title=String(data.title||'iroha');

  const options={
    body:String(data.body||'新しい通知があります'),
    tag:String(data.tag||'iroha-push'),
    renotify:!!data.renotify,
    data:{
      url:String(data.url||'./'),
      ...(data.data && typeof data.data==='object'
        ? data.data
        : {})
    }
  };

  const badge=Math.max(0,Number(data.badge)||0);

  event.waitUntil((async()=>{
    const tasks=[];

    /* 閉じている時もホーム画面バッジを更新 */
    if('setAppBadge' in self.navigator){
      try{
        if(badge>0){
          tasks.push(
            self.navigator.setAppBadge(badge)
          );
        }else if('clearAppBadge' in self.navigator){
          tasks.push(
            self.navigator.clearAppBadge()
          );
        }
      }catch(_){}
    }

    /* Push通知を表示 */
    tasks.push(
      self.registration.showNotification(
        title,
        options
      )
    );

    await Promise.all(tasks);

    /* irohaを開いている場合は画面にも通知 */
    const open=await self.clients.matchAll({
      type:'window',
      includeUncontrolled:true
    });

    for(const c of open){
      try{
        c.postMessage({
          type:'iroha-push',
          data:options.data
        });
      }catch(_){}
    }
  })());
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  
  const target=new URL(event.notification?.data?.url||'./',self.registration.scope).href;

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
