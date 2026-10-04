export interface MailStatus {
  success?: boolean; error?: string; busy?: boolean;
  credential?: { accountId: string; from: string; to: string; configured: boolean } | null;
  runs?: Array<{ id: string; accountId: string; kind: string; date: string; startedAt: string; generatedAt?: string; status: string; error?: string; phase?: string; progress?: string; retryCount?: number; retryAt?: string; completedAt?: string; hasAttachment?: boolean }>;
  storage?: {files:number;bytes:number;retentionDays:number};
}
export interface HtmlReadingApi {
  status(): Promise<MailStatus>;
  saveMail(input: {accountId:string;from:string;to:string;password:string}):Promise<MailStatus>;
  clearMail():Promise<MailStatus>;
  verify(account:string):Promise<{success:boolean;error?:string}>;
  configure(plan:{accountId:string;enabled:boolean;time:string;retryMode?:'safe'|'manual'|'generation';artifactRetentionDays?:number}|null):Promise<MailStatus>;
  send(input:{accountId:string;requestId?:string;html:string;snapshotId:string;generatedAt?:string;warnings?:string[];comparisonIndex?:Record<string,string>}):Promise<{success:boolean;status?:string;error?:string}>;
  progress?(id:string,message:string):Promise<void>;
  failed(id:string,message:string,reason?:{code?:string;retryable?:boolean}):Promise<void>;
  baseline?(account:string):Promise<{snapshotId?:string;index:Record<string,string>}>;
  resend?(account:string,id:string,confirmed?:boolean):Promise<{success:boolean;status?:string;error?:string}>;
  cleanup?():Promise<{success:boolean;removed?:number}>;
  preview?(html:string):Promise<{success:boolean;error?:string}>;
  onGenerate(listener:(request:{requestId:string;accountId:string})=>void):()=>void;
}
