// 댓글 키워드 → DM 가이드 자동 발송 (OAAO). GitHub Actions가 10분마다 실행합니다.
// 최근 7일 게시물의 댓글 중 그 날짜 폴더 dm.json의 키워드가 들어간 댓글에
//   1) 인스타 "댓글에 DM으로 답하기"(private reply)로 가이드 링크를 보내고
//   2) 댓글에 공개 답글을 단다. 우리 계정이 이미 답글을 단 댓글은 건너뛴다(중복 발송 방지).
// 키는 환경변수 IG_ACCESS_TOKEN, IG_USER_ID에서만 읽습니다. 공개 저장소이므로 로그에 사용자 이름·댓글 내용을 남기지 않습니다.
// 사용: node scripts/dm-reply.mjs [--dry-run]
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dry=process.argv.includes('--dry-run');
const token=process.env.IG_ACCESS_TOKEN, userId=process.env.IG_USER_ID;
if(!token||!userId)throw Error('IG_ACCESS_TOKEN, IG_USER_ID 환경변수가 필요합니다.');
const api='https://graph.instagram.com/v21.0';
const DAY=86400000, since=Date.now()-7*DAY;

async function call(method,path,params={}){
  const body=new URLSearchParams({...params,access_token:token});
  const res=await fetch(method==='GET'?`${api}${path}?${body}`:`${api}${path}`,method==='GET'?{}:{method,body});
  const json=await res.json();
  if(!res.ok||json.error){const e=json.error||{};const err=Error(`${e.code||res.status}${e.error_subcode?'/'+e.error_subcode:''}: ${e.message||'오류'}`);err.code=e.code;throw err;}
  return json;
}
async function all(path,params){const out=[];let page=await call('GET',path,params);
  while(page){out.push(...(page.data||[]));if(!page.paging?.next)break;page=await (await fetch(page.paging.next)).json();if(page.error)break;}
  return out;}
const norm=s=>String(s||'').replace(/\s+/g,'').toLowerCase();
const kstDate=t=>new Date(Date.parse(t)+9*3600000).toISOString().slice(0,10);

const me=await call('GET','/me',{fields:'username'});
const media=(await call('GET',`/${userId}/media`,{fields:'id,timestamp',limit:'25'})).data.filter(m=>Date.parse(m.timestamp)>=since);
let sent=0, skipped=0, failed=0;
for(const m of media){
  const date=kstDate(m.timestamp), file=resolve(root,date,'dm.json');
  if(!existsSync(file))continue;
  const dm=JSON.parse(await readFile(file,'utf8'));
  const comments=await all(`/${m.id}/comments`,{fields:'id,text,username,timestamp,replies{username}',limit:'50'});
  for(const c of comments){
    if(c.username===me.username||Date.parse(c.timestamp)<since||!norm(c.text).includes(norm(dm.keyword)))continue;
    if((c.replies?.data||[]).some(r=>r.username===me.username)){skipped++;continue;}
    if(dry){console.log(`[점검] ${date} 댓글 ${c.id}: 발송 대상`);continue;}
    try{
      await call('POST',`/${userId}/messages`,{recipient:JSON.stringify({comment_id:c.id}),message:JSON.stringify({text:dm.message})});
      await call('POST',`/${c.id}/replies`,{message:dm.reply});
      sent++;console.log(`${date} 댓글 ${c.id}: DM 발송 + 답글`);
    }catch(e){failed++;console.log(`${date} 댓글 ${c.id}: 실패 ${e.message}`);}
  }
}
console.log(`최근 7일 게시물 ${media.length}개 확인 · 발송 ${sent} · 이미 처리 ${skipped} · 실패 ${failed}`);
if(failed&&!sent)process.exitCode=1;
