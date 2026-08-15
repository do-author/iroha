/* iroha v2.40.32 - notification service worker */
const SW_VER='3.1.2';

self.addEventListener('install',event=>{
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(self.clients.claim());
});

const PUSH_CONTEXT_WAIT_MS=260;
const pendingContextChecks=new Map();

function normalizePushKind(v){
  const s=String(v||'').trim().toLowerCase().replace(/\s+/g,'_');
  if(['dm','direct_message','direct-message','directmessage'].includes(s)) return 'dm';
  if(['like','post_like','activity_like'].includes(s)) return 'like';
  if(['reply','post_reply','activity_reply'].includes(s)) return 'reply';
  if(s==='activity') return 'activity';
  return '';
}

function pushMeta(data,notificationData,tag){
  const d=(notificationData && typeof notificationData==='object') ? notificationData : {};
  const t=String(tag||'');

  let kind=normalizePushKind(
    d.kind ?? d.type ?? d.event ??
    data.kind ?? data.type ?? data.event ??
    d.notification_kind ?? d.activity_kind
  );

  let chatId=String(
    d.chat_id ?? d.chatId ??
    data.chat_id ?? data.chatId ??
    d.direct_chat_id ?? d.directChatId ??
    ''
  ).trim();

  let notificationId=String(
    d.notification_id ?? d.notificationId ??
    data.notification_id ?? data.notificationId ??
    d.note_id ?? d.noteId ??
    ''
  ).trim();

  if(!kind){
    if(/^dm(?:[:_-]|$)/i.test(t)) kind='dm';
    else if(/^like(?:[:_-]|$)/i.test(t)) kind='like';
    else if(/^reply(?:[:_-]|$)/i.test(t)) kind='reply';
  }

  if(!chatId){
    const m=t.match(/^dm[:_-](.+)$/i);
    if(m) chatId=String(m[1]||'').trim();
  }

  try{
    const u=new URL(String(d.url || data.url || ''),self.registration.scope);

    if(!chatId){
      chatId=String(
        u.searchParams.get('chat_id') ||
        u.searchParams.get('chatId') ||
        ''
      ).trim();
    }

    if(!notificationId){
      notificationId=String(
        u.searchParams.get('notification_id') ||
        u.searchParams.get('notificationId') ||
        ''
      ).trim();
    }
  }catch(_){}

  return {kind,chatId,notificationId};
}

function finishContextCheck(requestId,value){
  const p=pendingContextChecks.get(requestId);
  if(!p) return;

  pendingContextChecks.delete(requestId);
  clearTimeout(p.timer);
  p.resolve(!!value);
}

self.addEventListener('message',event=>{
  const msg=event.data||{};

  if(msg.type!=='iroha-push-context-result') return;

  const requestId=String(msg.requestId||'');
  const p=pendingContextChecks.get(requestId);
  if(!p) return;

  const sourceId=event.source?.id;
  if(sourceId && p.waiting.size && !p.waiting.has(sourceId)) return;
  if(sourceId) p.waiting.delete(sourceId);

  const sameChat=
    !!msg.visible &&
    !!p.chatId &&
    String(msg.activeChatId||'')===p.chatId;

  if(sameChat){
    finishContextCheck(requestId,true);
    return;
  }

  if(p.waiting.size===0){
    finishContextCheck(requestId,false);
  }
});

async function sameDmIsOpen(chatId,openClients){
  chatId=String(chatId||'');
  if(!chatId || !openClients.length) return false;

  const requestId=`pushctx:${Date.now()}:${Math.random().toString(36).slice(2)}`;

  return new Promise(resolve=>{
    const waiting=new Set(openClients.map(c=>c.id).filter(Boolean));
    const timer=setTimeout(
      ()=>finishContextCheck(requestId,false),
      PUSH_CONTEXT_WAIT_MS
    );

    pendingContextChecks.set(requestId,{resolve,timer,waiting,chatId});

    for(const c of openClients){
      try{
        c.postMessage({
          type:'iroha-push-context-check',
          requestId,
          chatId
        });
      }catch(_){
        if(c.id) waiting.delete(c.id);
      }
    }

    if(waiting.size===0){
      finishContextCheck(requestId,false);
    }
  });
}

function shownNotificationMeta(n){
  return pushMeta({},n?.data||{},n?.tag||'');
}

async function closeShownDmNotifications(chatId){
  chatId=String(chatId||'');
  if(!chatId) return;

  try{
    const shown=await self.registration.getNotifications();
    for(const n of shown){
      if(shownNotificationMeta(n).chatId===chatId){
        try{ n.close(); }catch(_){}
      }
    }
  }catch(_){}
}

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

  const inherited=
    data.data && typeof data.data==='object'
      ? {...data.data}
      : {};

  /* Edge Functionがdata直下へIDを載せても、data.dataへ載せても使える。 */
  [
    'kind','type','event',
    'chat_id','chatId','direct_chat_id','directChatId',
    'notification_id','notificationId','note_id','noteId',
    'notification_kind','activity_kind'
  ].forEach(k=>{
    if(inherited[k]===undefined && data[k]!==undefined){
      inherited[k]=data[k];
    }
  });

  const options={
    body:String(data.body||'新しい通知があります'),
    tag:String(data.tag||'iroha-push'),
    renotify:!!data.renotify,
    data:{
      url:String(data.url||inherited.url||'./'),
      ...inherited
    }
  };

  const meta=pushMeta(data,options.data,options.tag);

  /* 今後表示済み通知を正確に消せるよう、正規化したIDも保存する。 */
  if(meta.kind && !options.data.kind) options.data.kind=meta.kind;
  if(meta.chatId && !options.data.chat_id) options.data.chat_id=meta.chatId;
  if(meta.notificationId && !options.data.notification_id){
    options.data.notification_id=meta.notificationId;
  }

  const badge=Math.max(0,Number(data.badge)||0);

  event.waitUntil((async()=>{
    const open=await self.clients.matchAll({
      type:'window',
      includeUncontrolled:true
    });

    /* 同じDMを画面で開いて会話中なら、端末通知は最初から出さない。 */
    const suppressDm=
      meta.kind==='dm' &&
      !!meta.chatId &&
      await sameDmIsOpen(meta.chatId,open);

    if(suppressDm){
      /* そのDMの古い通知が残っていた場合も一緒に消す。 */
      await closeShownDmNotifications(meta.chatId);
    }else{
      const tasks=[];

      /* 閉じている時もホーム画面バッジを更新 */
      if('setAppBadge' in self.navigator){
        try{
          if(badge>0){
            tasks.push(self.navigator.setAppBadge(badge));
          }else if('clearAppBadge' in self.navigator){
            tasks.push(self.navigator.clearAppBadge());
          }
        }catch(_){}
      }

      tasks.push(
        self.registration.showNotification(
          title,
          options
        )
      );

      await Promise.all(tasks);
    }

    /* irohaを開いている場合は、表示/非表示に関係なく最新状態へ更新。 */
    for(const c of open){
      try{
        c.postMessage({
          type:'iroha-push',
          suppressed:suppressDm,
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
