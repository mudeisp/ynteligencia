// Minimal trust-only wire client for disposable native PostgreSQL tests. No deps,
// password support, remote hosts, production database names or credential logging.
import net from 'node:net';
export async function connect(user='postgres',database='orulo_v9_test'){
 if(process.env.ORULO_SYNTHETIC_PG!=='true'||process.env.PGHOST!=='127.0.0.1'||process.env.PGDATABASE!=='orulo_v9_test'||
 !['postgres','service_role','anon','authenticated','orulo_webhook_writer','orulo_provenance_reader'].includes(user)||!['postgres','orulo_v9_test'].includes(database))throw Error('ISOLATED_LOCAL_V9_DATABASE_REQUIRED');
 const socket=net.createConnection({host:'127.0.0.1',port:Number(process.env.PGPORT)});let bytes=Buffer.alloc(0),pending,columns=[],rows=[],failure;
 const initial=new Promise((resolve,reject)=>{pending={resolve,reject};});
 socket.on('error',e=>pending?.reject(e));
 socket.on('data',chunk=>{bytes=Buffer.concat([bytes,chunk]);while(bytes.length>=5){const n=bytes.readInt32BE(1);if(bytes.length<n+1)return;const type=String.fromCharCode(bytes[0]),b=bytes.subarray(5,n+1);bytes=bytes.subarray(n+1);
  if(type==='R'&&b.readInt32BE(0)!==0){pending?.reject(Error('TRUST_LOCAL_CLUSTER_REQUIRED'));socket.destroy();return;}
  if(type==='T'){columns=[];let o=2;for(let i=0;i<b.readInt16BE(0);i++){const z=b.indexOf(0,o);columns.push(b.toString('utf8',o,z));o=z+19;}}
  if(type==='D'){let o=2;const row={};for(let i=0;i<b.readInt16BE(0);i++){const len=b.readInt32BE(o);o+=4;row[columns[i]]=len===-1?null:b.toString('utf8',o,o+len);if(len>=0)o+=len;}rows.push(row);}
  if(type==='E'){let o=0;const e={};while(b[o]){const k=String.fromCharCode(b[o++]),z=b.indexOf(0,o);e[k]=b.toString('utf8',o,z);o=z+1;}failure=Object.assign(Error(e.M),{code:e.C});}
  if(type==='Z'&&pending){const p=pending;pending=null;if(failure)p.reject(failure);else p.resolve(rows);failure=null;rows=[];}
 }});
 await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
 const params=Buffer.from(`user\0${user}\0database\0${database}\0application_name\0orulo_v9_synthetic_test\0\0`),header=Buffer.alloc(8);header.writeInt32BE(params.length+8);header.writeInt32BE(196608,4);socket.write(Buffer.concat([header,params]));await initial;
 return{async query(sql){if(pending)throw Error('SERIAL_TEST_QUERIES_ONLY');const body=Buffer.from(sql+'\0'),h=Buffer.alloc(5);h[0]=81;h.writeInt32BE(body.length+4,1);const promise=new Promise((resolve,reject)=>{pending={resolve,reject};});socket.write(Buffer.concat([h,body]));return promise;},close(){const b=Buffer.alloc(5);b[0]=88;b.writeInt32BE(4,1);socket.end(b);}};
}
