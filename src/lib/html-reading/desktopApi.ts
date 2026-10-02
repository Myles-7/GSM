export interface MailStatus {
  success?: boolean; error?: string; busy?: boolean;
  credential?: { accountId: string; from: string; to: string; configured: boolean } | null;
  runs?: Array<{ id: string; accountId: string; kind: string; date: string; startedAt: string; status: string; error?: string }>;
}
export interface HtmlReadingApi {
  status(): Promise<MailStatus>;
  saveMail(input: {accountId:string;from:string;to:string;password:string}):Promise<MailStatus>;
  clearMail():Promise<MailStatus>;
  verify(account:string):Promise<{success:boolean;error?:string}>;
  configure(plan:{accountId:string;enabled:boolean;time:string}|null):Promise<MailStatus>;
  send(input:{accountId:string;requestId?:string;html:string;snapshotId:string;warnings?:string[]}):Promise<{success:boolean;status?:string;error?:string}>;
  failed(id:string,message:string):Promise<void>;
  onGenerate(listener:(request:{requestId:string;accountId:string})=>void):()=>void;
}
