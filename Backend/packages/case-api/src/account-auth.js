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
  async function issue(db,user) {
    const token=crypto.randomBytes(32).toString('base64url');
    await db.execute('INSERT INTO platform_sessions(token_hash,user_id,expires_at) VALUES (?,?,?)',[sessionTokenHash(token),user.id,new Date(Date.now()+ttl)]);
    return {token,user:publicUser(user)};
  }
  return {
    async register(input) {
      const {email,password,name}=credentials(input,{registration:true});
      const hash=await passwordHash(password);
      try {return await transaction(async db=>{
        const id=crypto.randomUUID();
        const [saved]=await db.execute('INSERT INTO platform_users(public_id,email,password_hash,display_name) VALUES (?,?,?,?)',[id,email,hash,name]);
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
      const email='local-demo@ta-agent.example.invalid';
      let existing=await transaction(async db=>{
        const [[user]]=await db.execute('SELECT id,public_id,email,password_hash,display_name,status FROM platform_users WHERE email=?',[email]);
        if(!user)return null;
        if(user.status!=='ACTIVE'||user.display_name!=='模拟账户')throw fail('DEMO_UNAVAILABLE',409,'模拟账户暂时不可用');
        return issue(db,user);
      });
      if(existing)return existing;
      try {return await this.register({email,name:'模拟账户',password:crypto.randomBytes(32).toString('base64url')});}
      catch(error){if(error.code!=='ACCOUNT_EXISTS')throw error;return this.demo(input);}
    },
    async current(token) {return transaction(async db=>{
      const {user_id}=await authenticateSession(db,token);
      const [[user]]=await db.execute('SELECT public_id,email,display_name,password_hash FROM platform_users WHERE id=?',[user_id]);
      return {user:publicUser(user)};
    });},
    async password(token,input) {
      if(!input||Array.isArray(input)||Object.keys(input).length!==2||!['currentPassword','newPassword'].every(key=>Object.hasOwn(input,key))||typeof input.currentPassword!=='string'||input.currentPassword.length>128||typeof input.newPassword!=='string'||input.newPassword.length<8||input.newPassword.length>128)throw fail('INVALID_INPUT',400,'新密码须为 8–128 位');
      return transaction(async db=>{
        const {user_id}=await authenticateSession(db,token);
        const [[user]]=await db.execute('SELECT id,public_id,email,display_name,password_hash FROM platform_users WHERE id=? FOR UPDATE',[user_id]);
        if(user.password_hash.startsWith('scrypt$')&&!await passwordMatches(input.currentPassword,user.password_hash))throw fail('LOGIN_REJECTED',401,'当前密码不正确');
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
