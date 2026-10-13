import {demoEmail} from '../../platform-store/src/account-model-quotas.js';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { authenticateSession, sessionTokenHash, storeError } from '../../platform-store/src/index.js';

const scrypt=promisify(crypto.scrypt);
const ttl=7*24*60*60*1000;
const fail=(code,status,message)=>storeError(code,status,message);
const publicUser=row=>({id:row.public_id,name:row.display_name,email:row.email,needsPasswordSetup:Boolean(row.password_hash&&!row.password_hash.startsWith('scrypt$'))});
const emailOf=value=>typeof value==='string'?value.trim().toLowerCase():'';
function credentials(input,{registration=false}={}) {
  const keys=registration?['email','password','name']:['email','password'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==keys.length||!keys.every(key=>Object.hasOwn(input,key)))throw fail('INVALID_INPUT',400,'请填写邮箱和密码');
  const email=emailOf(input.email);
  if(email.length>190||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw fail('INVALID_INPUT',400,'请填写有效邮箱');
  if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)throw fail('INVALID_INPUT',400,'密码须为 8–128 位');
  const name=registration&&typeof input.name==='string'?input.name.trim():'';
  if(registration&&(!name||name.length>80))throw fail('INVALID_INPUT',400,'姓名须为 1–80 个字符');
  return {email,password:input.password,name};
}
async function passwordHash(password) {
  const salt=crypto.randomBytes(16);
  const derived=await scrypt(password,salt,64,{N:16384,r:8,p:1});
  return `scrypt$16384$8$1$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}
async function passwordMatches(password,encoded) {
  const [algorithm,n,r,p,salt,hash]=String(encoded).split('$');
  if(algorithm!=='scrypt'||n!=='16384'||r!=='8'||p!=='1')return false;
  const expected=Buffer.from(hash??'','base64');
  if(expected.length!==64)return false;
  const actual=Buffer.from(await scrypt(password,Buffer.from(salt,'base64'),64,{N:16384,r:8,p:1}));
  return crypto.timingSafeEqual(expected,actual);
}
export function accountCookie(token,{secure=false}={}) {
  return `case_session=${encodeURIComponent(token??'')}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?ttl/1000:0}${secure?'; Secure':''}`;
}
export function createAccountAuth({transaction,initializeWorkspace,allowDemo=false}) {
  let dummyHash;
  async function profile(db,user) {
    const [[avatar]]=await db.execute('SELECT avatar_data FROM platform_user_avatars WHERE user_id=?',[user.id]);
    return {...publicUser(user),avatar:avatar?.avatar_data??null};
  }
  async function issue(db,user) {
    const token=crypto.randomBytes(32).toString('base64url');
    await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[sessionTokenHash(token),user.id,new Date(Date.now()+ttl)]);
    return {token,user:await profile(db,user)};
  }
  return {
    async register(input,{demo=false}={}) {
      const {email,password,name}=credentials(input,{registration:true});
      if(email===demoEmail&&!demo)throw fail('INVALID_INPUT',400,'此邮箱为演示账户保留，请使用其他邮箱');
      const hash=await passwordHash(password);
      try {return await transaction(async db=>{
        const id=crypto.randomUUID();
        const [saved]=await db.execute('INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,?)',[id,email,hash,name]);
        if(demo)await db.execute('INSERT INTO account_demo_users(user_id) VALUES (?)',[saved.insertId]);
        const [workspace]=await db.execute('INSERT INTO workspaces(public_id,owner_user_id) VALUES (?,?)',[crypto.randomUUID(),saved.insertId]);
        if(initializeWorkspace)await initializeWorkspace(db,workspace.insertId);
        return issue(db,{id:saved.insertId,public_id:id,display_name:name,email});
      });} catch(error) {
        if(error.code==='ER_DUP_ENTRY')throw fail('ACCOUNT_EXISTS',409,'该邮箱已注册，请登录');
        throw error;
      }
    },
    async login(input) {
      const {email,password}=credentials(input);
      return transaction(async db=>{
        const [[user]]=await db.execute('SELECT id,public_id,email,password_hash,display_name,status FROM platform_users WHERE email=?',[email]);
        dummyHash??=passwordHash(crypto.randomBytes(24).toString('hex'));
        const valid=await passwordMatches(password,user?.password_hash??await dummyHash);
        if(!user||!valid||user.status!=='ACTIVE')throw fail('LOGIN_REJECTED',401,'邮箱或密码不正确');
        return issue(db,user);
      });
    },
    async demo(input) {
      if(!allowDemo)throw fail('NOT_FOUND',404,'模拟账户未启用');
      if(!input||Array.isArray(input)||Object.keys(input).length)throw fail('INVALID_INPUT',400,'请求格式不正确');
      const email=demoEmail;
      let existing=await transaction(async db=>{
        const [[user]]=await db.execute('SELECT u.id,u.public_id,u.email,u.password_hash,u.display_name,u.status,d.user_id IS NOT NULL AS is_demo FROM platform_users u LEFT JOIN account_demo_users d ON d.user_id=u.id WHERE u.email=?',[email]);
        if(!user)return null;
        if(user.status!=='ACTIVE'||user.display_name!=='模拟账户'||Number(user.is_demo)!==1)throw fail('DEMO_UNAVAILABLE',409,'模拟账户暂时不可用');
        return issue(db,user);
      });
      if(existing)return existing;
      try {return await this.register({email,name:'模拟账户',password:crypto.randomBytes(32).toString('base64url')},{demo:true});}
      catch(error){if(error.code!=='ACCOUNT_EXISTS')throw error;return this.demo(input);}
    },
    async current(token) {return transaction(async db=>{
      const {user_id}=await authenticateSession(db,token);
      const [[user]]=await db.execute('SELECT id,public_id,email,display_name,password_hash FROM platform_users WHERE id=?',[user_id]);
      return {user:await profile(db,user)};
    });},
    async avatar(token,input) {
      if(!input||Array.isArray(input)||Object.keys(input).length!==1||!Object.hasOwn(input,'avatar'))throw fail('INVALID_INPUT',400,'头像请求格式不正确');
      const data=input.avatar;
      if(data!==null){
        if(typeof data!=='string'||data.length>350000||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw fail('INVALID_AVATAR',400,'请上传有效图片');
        const bytes=Buffer.from(data.slice(22),'base64');
        if(bytes.length<33||bytes.length>256*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||bytes.toString('ascii',12,16)!=='IHDR'||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)throw fail('INVALID_AVATAR',400,'头像尺寸或内容无效');
      }
      return transaction(async db=>{
        const {user_id}=await authenticateSession(db,token);
        if(data===null)await db.execute('DELETE FROM platform_user_avatars WHERE user_id=?',[user_id]);
        else await db.execute('INSERT INTO platform_user_avatars(user_id,avatar_data) VALUES (?,?) ON DUPLICATE KEY UPDATE avatar_data=VALUES(avatar_data)',[user_id,data]);
        const [[user]]=await db.execute('SELECT id,public_id,email,display_name,password_hash FROM platform_users WHERE id=?',[user_id]);
        return {user:await profile(db,user)};
      });
    },
    async password(token,input) {
      if(!input||Array.isArray(input)||Object.keys(input).length!==2||!['currentPassword','newPassword'].every(key=>Object.hasOwn(input,key))||typeof input.currentPassword!=='string'||input.currentPassword.length>128||typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)throw fail('INVALID_INPUT',400,'新密码须为 8–128 位');
      return transaction(async db=>{
        const {user_id}=await authenticateSession(db,token);
        const [[user]]=await db.execute('SELECT id,public_id,email,display_name,password_hash FROM platform_users WHERE id=? FOR UPDATE',[user_id]);
        if(user.password_hash!==''&&!await passwordMatches(input.currentPassword,user.password_hash))throw fail('LOGIN_REJECTED',401,'当前密码不正确');
        const hash=await passwordHash(input.newPassword);
        await db.execute('UPDATE platform_users SET password_hash=? WHERE id=?',[hash,user_id]);
        await db.execute('DELETE FROM platform_sessions WHERE user_id=?',[user_id]);
        return issue(db,{...user,password_hash:hash});
      });
    },
    async logout(token) {return transaction(async db=>{
      if(typeof token==='string'&&/^[A-Za-z0-9_-]{32,128}$/.test(token))await db.execute('DELETE FROM platform_sessions WHERE token_hash=?',[sessionTokenHash(token)]);
      return {signedOut:true};
    });}
  };
}
